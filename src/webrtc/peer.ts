/**
 * One WebRTC peer connection per participant. The agent is always the answerer:
 * the operator/portal sends the SDP offer (with a recvonly video m-line for the
 * screen and a "control" data channel), the agent attaches its screen track and
 * answers. Screen/input/chat travel end-to-end here; signalling (SDP/ICE) is
 * relayed through the gateway via SignalClient.
 *
 * Mirrors the answerer logic in tools/fakeagent/agent/agent.go, extended to send
 * a real screen track and to receive remote input on the control channel.
 */
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  RTCRtpReceiver,
  type MediaStream,
  type MediaStreamTrack,
} from 'react-native-webrtc';
import {log} from '../core/log';
import {signMessageBytes} from '../core/crypto';
import {bodyKey, decodeSession, encodeSession, type SessionMsg} from '../proto/session';

export type IceServer = {urls: string[]; username?: string; credential?: string};

/** Identity the agent signs into its AgentHello (docs session-protocol §1.5). */
export type HelloConfig = {
  deviceId: string;
  agentVersion: string;
  permissions: number;
  /** base64 tweetnacl secret key (the enrolled Ed25519 identity). */
  secretKey: string;
};

export type PeerCallbacks = {
  onLocalIce: (cand: {candidate: string; sdpMid: string | null; sdpMLineIndex: number | null} | null) => void;
  /** Legacy JSON control channel (kept for older viewers). */
  onControlData: (data: string) => void;
  /** Decoded in-session InputEvent (drs.session.v1), viewer → agent. */
  onInput: (input: SessionMsg) => void;
  onConnected: () => void;
  onFailed: () => void;
};

export class Peer {
  readonly participantId: number;
  readonly sessionId: string;
  private pc: RTCPeerConnection;
  private remoteSet = false;
  private pendingRemoteIce: RTCIceCandidate[] = [];
  private controlChannel: any = null;
  private sessionChannel: any = null; // "drs.session" (ordered, reliable)
  private answerFingerprint = ''; // a=fingerprint of our SDP answer
  private seq = 0;
  private closed = false;

  constructor(
    participantId: number,
    sessionId: string,
    iceServers: IceServer[],
    forceRelay: boolean,
    private hello: HelloConfig,
    private cb: PeerCallbacks,
  ) {
    this.participantId = participantId;
    this.sessionId = sessionId;
    this.pc = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy: forceRelay ? 'relay' : 'all',
      bundlePolicy: 'max-bundle',
    });
    this.wire();
  }

  private wire() {
    const pc: any = this.pc;
    pc.onicecandidate = (ev: any) => {
      if (this.closed) {
        return;
      }
      if (ev.candidate) {
        this.cb.onLocalIce({
          candidate: ev.candidate.candidate,
          sdpMid: ev.candidate.sdpMid ?? null,
          sdpMLineIndex: ev.candidate.sdpMLineIndex ?? null,
        });
      } else {
        this.cb.onLocalIce(null); // end-of-candidates
      }
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      log.info('peer', `participant ${this.participantId} connection ${st}`);
      if (st === 'connected') {
        this.cb.onConnected();
      } else if (st === 'failed') {
        this.cb.onFailed();
      }
    };
    pc.ondatachannel = (ev: any) => {
      const ch = ev.channel;
      log.info('peer', `data channel "${ch.label}" from participant ${this.participantId}`);
      if (ch.label === 'drs.session') {
        // The in-session channel: the agent must identify itself with a signed
        // AgentHello the moment it opens, or the viewer drops the session after
        // ~10s ("the agent did not identify itself").
        this.sessionChannel = ch;
        try {
          ch.binaryType = 'arraybuffer';
        } catch {}
        ch.onopen = () => this.sendAgentHello();
        ch.onmessage = (m: any) => this.onSessionData(m.data);
      } else if (ch.label === 'drs.input.move') {
        try {
          ch.binaryType = 'arraybuffer';
        } catch {}
        ch.onmessage = (m: any) => this.onSessionData(m.data);
      } else if (ch.label === 'control' || ch.label === 'input') {
        // Legacy JSON control channel (older viewers).
        this.controlChannel = ch;
        ch.onmessage = (m: any) => this.cb.onControlData(String(m.data));
      } else {
        ch.onmessage = (m: any) => log.debug('peer', `data(${ch.label}): ${String(m.data).slice(0, 80)}`);
      }
    };
  }

  /**
   * sendAgentHello binds this WebRTC connection to the device identity: it signs
   * the hello payload with the enrolled Ed25519 key and includes the DTLS
   * fingerprint of our SDP answer, so the viewer can verify the stream is really
   * from this device (docs/architecture.md §1.5 step 7).
   */
  private sendAgentHello(): void {
    const ch = this.sessionChannel;
    if (!ch || ch.readyState !== 'open') {
      return;
    }
    const sid = this.sessionId;
    const pid = this.participantId;
    const did = this.hello.deviceId;
    const fp = this.answerFingerprint;
    const payload = `drs-agent-hello-v1\n${sid}\n${pid}\n${did}\n${fp}`;
    let signature: Uint8Array;
    try {
      signature = signMessageBytes(payload, this.hello.secretKey);
    } catch (e: any) {
      log.error('peer', `agent_hello sign failed: ${e?.message || e}`);
      return;
    }
    const msg: SessionMsg = {
      seq: ++this.seq,
      agent_hello: {
        device_id: did,
        session_id: sid,
        participant_id: pid,
        dtls_fingerprint: fp,
        signature,
        agent_version: this.hello.agentVersion,
        permissions: this.hello.permissions,
      },
    };
    this.sendSession(msg);
    log.info('peer', `sent agent_hello (fp=${fp.slice(0, 20)}…, perms=${this.hello.permissions})`);
  }

  /** sendSession encodes and sends a SessionMessage on the drs.session channel. */
  private sendSession(msg: SessionMsg): void {
    const ch = this.sessionChannel;
    if (!ch || ch.readyState !== 'open') {
      return;
    }
    try {
      const bytes = encodeSession(msg);
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      ch.send(buf);
    } catch (e: any) {
      log.warn('peer', `session send failed: ${e?.message || e}`);
    }
  }

  /** onSessionData decodes an inbound SessionMessage and routes input/control. */
  private onSessionData(data: any): void {
    let bytes: Uint8Array;
    if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else if (ArrayBuffer.isView(data)) {
      bytes = new Uint8Array((data as any).buffer, (data as any).byteOffset, (data as any).byteLength);
    } else {
      return; // unexpected text frame
    }
    let msg: SessionMsg;
    try {
      msg = decodeSession(bytes);
    } catch {
      return;
    }
    const key = bodyKey(msg);
    if (key === 'input') {
      this.cb.onInput(msg.input);
    } else if (key === 'control') {
      // request_keyframe: force an IDR by renegotiating is heavy; the browser
      // usually recovers via RTCP PLI automatically, so we just log it here.
      log.debug('peer', `control: ${JSON.stringify(msg.control)}`);
    }
  }

  /**
   * addScreen attaches the screen track to the connection. Call it AFTER
   * setRemoteDescription so we can bind the track to the operator's recvonly
   * video transceiver via replaceTrack (reliable in react-native-webrtc) and
   * flip its direction to sendonly — addTrack alone does not always reuse the
   * offered transceiver, which would leave the operator with no video.
   */
  async addScreen(stream: MediaStream): Promise<void> {
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
      log.warn('peer', 'no video track in the capture stream');
      return;
    }
    log.info(
      'peer',
      `screen track: id=${(videoTrack as any).id} enabled=${videoTrack.enabled} state=${(videoTrack as any).readyState}`,
    );
    // Bind to the operator's recvonly video transceiver (this path connects
    // reliably in react-native-webrtc). Set it sendrecv so the sender transmits.
    const pc: any = this.pc;
    const txs = pc.getTransceivers ? pc.getTransceivers() : [];
    const vtx = txs.find((t: any) => {
      const k = t?.receiver?.track?.kind || t?._kind || t?.kind;
      return k === 'video';
    });
    if (vtx?.sender?.replaceTrack) {
      await vtx.sender.replaceTrack(videoTrack);
      try {
        vtx.direction = 'sendrecv';
      } catch {}
      // Prefer VP8 for the outbound screen. On some devices (seen on Infinix /
      // Android with non-16-multiple screen widths) the hardware H.264 encoder
      // produces 0 frames for screencast; VP8's software encoder is reliable at
      // any resolution and every browser viewer decodes it.
      this.preferVp8(vtx);
      log.info('peer', `screen bound to video transceiver for participant ${this.participantId}`);
    } else {
      try {
        this.pc.addTrack(videoTrack, stream);
        log.info('peer', `screen attached via addTrack for participant ${this.participantId}`);
      } catch (e: any) {
        log.warn('peer', `addTrack failed: ${e?.message || e}`);
      }
    }
  }

  /**
   * preferVp8 reorders the transceiver's codec preferences so VP8 is first,
   * making the agent encode VP8 regardless of what the offer listed first.
   * Best-effort: if the API is unavailable it leaves the default order.
   */
  private preferVp8(vtx: any): void {
    try {
      const caps = (RTCRtpReceiver as any).getCapabilities?.('video');
      if (!caps?.codecs || !vtx?.setCodecPreferences) {
        return;
      }
      const vp8 = caps.codecs.filter((c: any) => /vp8/i.test(c.mimeType));
      const rest = caps.codecs.filter((c: any) => !/vp8/i.test(c.mimeType));
      if (vp8.length) {
        vtx.setCodecPreferences([...vp8, ...rest]);
        log.info('peer', 'codec preference set: VP8 first');
      }
    } catch (e: any) {
      log.warn('peer', `setCodecPreferences failed: ${e?.message || e}`);
    }
  }

  /**
   * answer applies the remote offer, attaches the screen track, and returns the
   * local answer SDP. The track is added AFTER setRemoteDescription so it binds
   * to the operator's recvonly video transceiver instead of creating a new,
   * unmatched m-line (which would leave the operator with no video).
   */
  async answer(offerSdp: string, stream: MediaStream | null): Promise<string> {
    await this.pc.setRemoteDescription(
      new RTCSessionDescription({type: 'offer', sdp: offerSdp}),
    );
    this.remoteSet = true;
    if (stream) {
      await this.addScreen(stream);
    }
    await this.flushRemoteIce();
    const ans = await this.pc.createAnswer();
    await this.pc.setLocalDescription(ans);
    const sdp = (this.pc.localDescription as any)?.sdp || (ans as any).sdp;
    // The DTLS fingerprint of our answer, signed into AgentHello so the viewer
    // can prove the media really terminates at this device (not a relay MITM).
    this.answerFingerprint = extractFingerprint(sdp);
    const hasVideo = /m=video/.test(sdp || '');
    const sendsVideo = /a=(sendrecv|sendonly)/.test(sdp || '');
    log.info(
      'peer',
      `answer created (m=video:${hasVideo}, sends:${sendsVideo}, fp=${this.answerFingerprint.slice(0, 16)}…)`,
    );
    return sdp;
  }

  /** addRemoteIce adds a trickled candidate from the participant. */
  async addRemoteIce(candidate: string, sdpMid: string, sdpMLineIndex: number): Promise<void> {
    if (!candidate) {
      return; // end-of-candidates marker
    }
    const ice = new RTCIceCandidate({candidate, sdpMid, sdpMLineIndex});
    if (!this.remoteSet) {
      this.pendingRemoteIce.push(ice);
      return;
    }
    try {
      await this.pc.addIceCandidate(ice);
    } catch (e: any) {
      log.warn('peer', `addIceCandidate failed: ${e?.message || e}`);
    }
  }

  private async flushRemoteIce() {
    const pend = this.pendingRemoteIce;
    this.pendingRemoteIce = [];
    for (const ice of pend) {
      try {
        await this.pc.addIceCandidate(ice);
      } catch {}
    }
  }

  /** sendControl sends a message back over the control channel if open. */
  sendControl(data: string): void {
    if (this.controlChannel && this.controlChannel.readyState === 'open') {
      try {
        this.controlChannel.send(data);
      } catch {}
    }
  }

  /**
   * logSenderStats polls the outbound video RTP a few times and logs whether the
   * agent is actually encoding and sending frames. framesEncoded == 0 means the
   * screen-capture track is not feeding the encoder (capture/encoder problem),
   * which shows up on the operator as "no video frames arriving".
   */
  async logSenderStats(): Promise<void> {
    for (let i = 0; i < 6 && !this.closed; i++) {
      await new Promise<void>(r => setTimeout(() => r(), 2000));
      try {
        const stats = await this.pc.getStats();
        let encoded = 0;
        let pkts = 0;
        let w = 0;
        let h = 0;
        stats.forEach((s: any) => {
          if (s.type === 'outbound-rtp' && (s.kind === 'video' || s.mediaType === 'video')) {
            encoded = s.framesEncoded || 0;
            pkts = s.packetsSent || 0;
            w = s.frameWidth || 0;
            h = s.frameHeight || 0;
          }
        });
        log.info('peer', `outbound video ${w}x${h}: encoded ${encoded}, packetsSent ${pkts}`);
      } catch (e: any) {
        log.warn('peer', `sender stats failed: ${e?.message || e}`);
      }
    }
  }

  /** selectedPair returns the nominated local/remote candidate types for audit. */
  async selectedPair(): Promise<{local: string; remote: string} | null> {
    try {
      const stats = await this.pc.getStats();
      let pair: any = null;
      stats.forEach((r: any) => {
        if (r.type === 'candidate-pair' && (r.nominated || r.selected) && r.state === 'succeeded') {
          pair = r;
        }
      });
      if (!pair) {
        return null;
      }
      let local = '';
      let remote = '';
      stats.forEach((r: any) => {
        if (r.id === pair.localCandidateId) {
          local = r.candidateType;
        }
        if (r.id === pair.remoteCandidateId) {
          remote = r.candidateType;
        }
      });
      return {local, remote};
    } catch {
      return null;
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      this.controlChannel?.close?.();
    } catch {}
    try {
      this.sessionChannel?.close?.();
    } catch {}
    try {
      this.pc.close();
    } catch {}
  }
}

/**
 * extractFingerprint returns the a=fingerprint value of an SDP, e.g.
 * "sha-256 AB:CD:…" — the exact text the AgentHello must sign. Prefers a
 * session-level line, else the first media-level one.
 */
function extractFingerprint(sdp: string): string {
  const m = (sdp || '').match(/^a=fingerprint:(.+)$/im);
  return m ? m[1].trim() : '';
}
