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
  type MediaStream,
  type MediaStreamTrack,
} from 'react-native-webrtc';
import {log} from '../core/log';

export type IceServer = {urls: string[]; username?: string; credential?: string};

export type PeerCallbacks = {
  onLocalIce: (cand: {candidate: string; sdpMid: string | null; sdpMLineIndex: number | null} | null) => void;
  onControlData: (data: string) => void;
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
  private closed = false;

  constructor(
    participantId: number,
    sessionId: string,
    iceServers: IceServer[],
    forceRelay: boolean,
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
      if (ch.label === 'control' || ch.label === 'input') {
        this.controlChannel = ch;
        ch.onmessage = (m: any) => this.cb.onControlData(String(m.data));
      } else {
        // chat or other channels: echo-free, just log for now.
        ch.onmessage = (m: any) => log.debug('peer', `data(${ch.label}): ${String(m.data).slice(0, 80)}`);
      }
    };
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
    const hasVideo = /m=video/.test(sdp || '');
    const sendsVideo = /a=(sendrecv|sendonly)/.test(sdp || '');
    log.info('peer', `answer created (m=video:${hasVideo}, sends:${sendsVideo})`);
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
      this.pc.close();
    } catch {}
  }
}
