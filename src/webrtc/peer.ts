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
import { log } from '../core/log';
import { signMessageBytes } from '../core/crypto';
import { RemoteControl } from '../native/remoteControl';
import {
  bodyKey,
  decodeSession,
  encodeSession,
  type SessionMsg,
} from '../proto/session';

export type IceServer = {
  urls: string[];
  username?: string;
  credential?: string;
};

/** Identity the agent signs into its AgentHello (docs session-protocol §1.5). */
export type HelloConfig = {
  deviceId: string;
  agentVersion: string;
  permissions: number;
  /** base64 tweetnacl secret key (the enrolled Ed25519 identity). */
  secretKey: string;
};

export type PeerCallbacks = {
  onLocalIce: (
    cand: {
      candidate: string;
      sdpMid: string | null;
      sdpMLineIndex: number | null;
    } | null,
  ) => void;
  /** Legacy JSON control channel (kept for older viewers). */
  onControlData: (data: string) => void;
  /** Decoded in-session InputEvent (drs.session.v1), viewer → agent. */
  onInput: (input: SessionMsg) => void;
  /** Decoded in-session Control (drs.session.v1), viewer → agent. */
  onControl: (control: SessionMsg) => void;
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
  private screenSender: any = null;
  private screenTrack: MediaStreamTrack | null = null;
  private screenPaused = false;
  private adaptiveTimer: ReturnType<typeof setInterval> | null = null;
  // Starts at 1, not 0: a brief window at full (configured) resolution before
  // the first correction is exactly what reads as "starts smooth, then lags"
  // — begin with one step of safety margin already applied and only relax it
  // once the stream has proven itself stable.
  private adaptiveScaleIdx = 1;
  private adaptiveHealthyStreak = 0;
  // Geometric ladder of additional encoded-resolution downscale, stacked on
  // top of the capture-time resolutionScale: each step is applied via
  // RTCRtpEncodingParameters.scaleResolutionDownBy (live, no capture restart).
  // ~1.78x area reduction per step; floor is 1/9 area (3.0), still usable.
  private static readonly ADAPTIVE_SCALE_STEPS = [1, 1.33, 1.78, 2.37, 3];
  private static readonly ADAPTIVE_INTERVAL_MS = 2500;

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
        this.startAdaptiveQuality();
      } else if (st === 'failed') {
        this.cb.onFailed();
        this.stopAdaptiveQuality();
      } else if (st === 'disconnected' || st === 'closed') {
        this.stopAdaptiveQuality();
      }
    };
    pc.ondatachannel = (ev: any) => {
      const ch = ev.channel;
      log.info(
        'peer',
        `data channel "${ch.label}" from participant ${this.participantId}`,
      );
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
        ch.onmessage = (m: any) =>
          log.debug(
            'peer',
            `data(${ch.label}): ${String(m.data).slice(0, 80)}`,
          );
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
    log.info(
      'peer',
      `sent agent_hello (fp=${fp.slice(0, 20)}…, perms=${
        this.hello.permissions
      })`,
    );
  }

  /** sendSession encodes and sends a SessionMessage on the drs.session channel. */
  private sendSession(msg: SessionMsg): void {
    const ch = this.sessionChannel;
    if (!ch || ch.readyState !== 'open') {
      return;
    }
    try {
      const bytes = encodeSession(msg);
      const buf = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
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
      bytes = new Uint8Array(
        (data as any).buffer,
        (data as any).byteOffset,
        (data as any).byteLength,
      );
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
      this.cb.onControl(msg.control);
    }
  }

  /** Sends a warning notice to the participant over the in-session channel. */
  sendNotice(code: string, message: string): void {
    this.sendSession({
      seq: ++this.seq,
      notice: {level: 2, code, message},
    });
  }

  /**
   * addScreen attaches the screen track to the connection. Call it AFTER
   * setRemoteDescription so we can bind the track to the operator's recvonly
   * video transceiver via replaceTrack (reliable in react-native-webrtc) and
   * flip its direction to sendonly — addTrack alone does not always reuse the
   * offered transceiver, which would leave the operator with no video.
   */
  async addScreen(
    stream: MediaStream,
    paused = false,
    fps?: number,
    resolutionScale?: number,
  ): Promise<void> {
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
      log.warn('peer', 'no video track in the capture stream');
      return;
    }
    log.info(
      'peer',
      `screen track: id=${(videoTrack as any).id} enabled=${
        videoTrack.enabled
      } state=${(videoTrack as any).readyState}`,
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
      this.screenSender = vtx.sender;
      this.screenTrack = videoTrack;
      try {
        vtx.direction = 'sendrecv';
      } catch {}
      await this.selectVideoCodec(vtx, videoTrack);
      log.info(
        'peer',
        `screen bound to video transceiver for participant ${this.participantId}`,
      );
    } else {
      try {
        this.screenSender = this.pc.addTrack(videoTrack, stream);
        this.screenTrack = videoTrack;
        log.info(
          'peer',
          `screen attached via addTrack for participant ${this.participantId}`,
        );
      } catch (e: any) {
        log.warn('peer', `addTrack failed: ${e?.message || e}`);
      }
    }
    await this.applySenderEncoding(fps, resolutionScale);
    if (paused) {
      await this.setScreenPaused(true);
    }
  }

  /**
   * Tells the encoder to hold frame rate steady and drop resolution instead,
   * under CPU/bandwidth pressure (WebRTC's default, "maintain-resolution", is
   * the opposite — it drops frames first, which reads as lag on a capable
   * device).
   *
   * The bitrate ceiling scales with both fps and resolutionScale² (pixel
   * count), not fps alone: the outbound screen codec is forced to software
   * VP8 (preferVp8 above), and an earlier version of this that scaled bitrate
   * with fps alone — up to 8Mbps at 60fps, full resolution, with no live
   * correction — overloaded the phone's CPU badly enough to starve WebRTC's
   * own connection keepalives, dropping the session into a reconnect loop
   * ("unavailable" on the viewer). fps is still held fixed and the bitrate
   * baseline raised instead (low bitrate at any resolution looks blocky —
   * VP8 needs real bits per pixel to look like scrcpy's hardware H.264, not
   * fewer pixels): the adaptiveQualityTick/qualityLimitationReason loop below
   * is what makes raising this safe — it pulls scaleResolutionDownBy back
   * down live on a device/network that genuinely can't sustain it, instead of
   * everyone paying a permanent, static tax for the worst case.
   */
  private async applySenderEncoding(
    fps?: number,
    resolutionScale = 1,
  ): Promise<void> {
    const sender: any = this.screenSender;
    if (!sender?.getParameters || !sender?.setParameters) {
      return;
    }
    try {
      const params = sender.getParameters();
      params.degradationPreference = 'maintain-framerate';
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{ active: true }];
      }
      // Start with the adaptive controller's initial safety-margin step
      // already applied (see adaptiveScaleIdx), not at full sharpness — the
      // first correction should be invisible, not felt as a mid-stream stutter.
      params.encodings[0].scaleResolutionDownBy =
        Peer.ADAPTIVE_SCALE_STEPS[this.adaptiveScaleIdx];
      if (fps) {
        params.encodings[0].maxFramerate = fps;
        const scale = Math.max(0.1, Math.min(1, resolutionScale));
        // ~4Mbps baseline for 1080p30 VP8 (scrcpy's own default is 8Mbps —
        // this stays under that since VP8 is software-encoded here, not
        // hardware), scaled by frame rate and by area (scale²), clamped to a
        // firm ceiling regardless of inputs.
        const target = 4_000_000 * (fps / 30) * scale * scale;
        params.encodings[0].maxBitrate = Math.round(
          Math.min(6_000_000, Math.max(1_000_000, target)),
        );
      }
      await sender.setParameters(params);
      log.info(
        'peer',
        `sender encoding: maxFramerate=${
          params.encodings[0]?.maxFramerate ?? 'default'
        } maxBitrate=${
          params.encodings[0]?.maxBitrate ?? 'default'
        } scaleResolutionDownBy=${
          params.encodings[0]?.scaleResolutionDownBy ?? 1
        } degradationPreference=maintain-framerate`,
      );
    } catch (e: any) {
      log.warn('peer', `setParameters failed: ${e?.message || e}`);
    }
  }

  /**
   * Adaptive quality: every ADAPTIVE_INTERVAL_MS, reads the outbound video
   * RTP's `qualityLimitationReason` — a standard webrtc-stats field ('cpu',
   * 'bandwidth', 'other', or 'none') that says, from WebRTC's own internal
   * measurement, *why* the encoder isn't running at full resolution right
   * now. This is a real signal from the actual device and the actual network,
   * not a guess: step the encoded resolution down (via scaleResolutionDownBy,
   * live — no capture restart, no re-prompt) only when it is genuinely
   * struggling, and cautiously back up once it has been clean for a few
   * checks in a row. AppConfig's captureFps/captureResolutionScale remain the
   * starting point; this only narrows further when that starting point turns
   * out to be too ambitious for this specific phone or connection.
   */
  private startAdaptiveQuality(): void {
    if (this.adaptiveTimer || this.closed) {
      return;
    }
    this.adaptiveTimer = setInterval(() => {
      void this.adaptiveQualityTick();
    }, Peer.ADAPTIVE_INTERVAL_MS);
  }

  private stopAdaptiveQuality(): void {
    if (this.adaptiveTimer) {
      clearInterval(this.adaptiveTimer);
      this.adaptiveTimer = null;
    }
  }

  private async adaptiveQualityTick(): Promise<void> {
    if (this.closed || !this.screenSender?.getParameters) {
      return;
    }
    try {
      const stats = await this.pc.getStats();
      let reason: string | undefined;
      let fractionLost: number | undefined;
      let framesEncoded: number | undefined;
      stats.forEach((s: any) => {
        if (s.type === 'outbound-rtp' && (s.kind === 'video' || s.mediaType === 'video')) {
          reason = s.qualityLimitationReason;
          framesEncoded = s.framesEncoded;
        }
        // RTCP receiver reports surface here (sender-side view of loss the
        // viewer is actually seeing) — a second, independent signal in case
        // qualityLimitationReason doesn't flag this particular kind of
        // trouble (e.g. a bursty Wi-Fi link reported as 'other' or 'none').
        if (s.type === 'remote-inbound-rtp' && (s.kind === 'video' || s.mediaType === 'video')) {
          fractionLost = s.fractionLost;
        }
      });
      // Runtime safety net for the per-device H.264 decision: the static
      // capability check (RemoteControl.supportsHardwareH264) filters out the
      // known size-alignment failures, but a genuine driver bug could still
      // silently encode 0 frames despite reporting support. If that happens,
      // stop trusting H.264 on this device for the rest of this app session
      // and tear this peer down — the operator side already retries on its
      // own (schedulePeerReconnect), and the retry will pick VP8 instead.
      if (this.usingH264) {
        if ((framesEncoded ?? 0) === 0) {
          this.zeroFrameTicks++;
          if (this.zeroFrameTicks >= 2) {
            log.error(
              'peer',
              'hardware H.264 produced 0 frames on this device — falling back to software VP8 for the rest of this session',
            );
            Peer.h264RuntimeFailed = true;
            this.stopAdaptiveQuality();
            this.cb.onFailed();
            return;
          }
        } else {
          this.zeroFrameTicks = 0;
        }
      }
      const steps = Peer.ADAPTIVE_SCALE_STEPS;
      const lossy = typeof fractionLost === 'number' && fractionLost > 0.05;
      if (reason === 'cpu' || reason === 'bandwidth' || lossy) {
        this.adaptiveHealthyStreak = 0;
        if (this.adaptiveScaleIdx < steps.length - 1) {
          this.adaptiveScaleIdx++;
          await this.applyAdaptiveScale(lossy && reason !== 'cpu' && reason !== 'bandwidth' ? 'packet loss' : reason!);
        }
      } else if (reason === 'none') {
        this.adaptiveHealthyStreak++;
        // Require ~7.5s of clean encoding before trying a step back up, and
        // only one step at a time, so it can't oscillate against a step-down.
        if (this.adaptiveHealthyStreak >= 3 && this.adaptiveScaleIdx > 0) {
          this.adaptiveScaleIdx--;
          this.adaptiveHealthyStreak = 0;
          await this.applyAdaptiveScale('recovered');
        }
      }
    } catch (e: any) {
      log.warn('peer', `adaptive quality tick failed: ${e?.message || e}`);
    }
  }

  private async applyAdaptiveScale(reason: string): Promise<void> {
    const sender: any = this.screenSender;
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{ active: true }];
      }
      const scale = Peer.ADAPTIVE_SCALE_STEPS[this.adaptiveScaleIdx];
      params.encodings[0].scaleResolutionDownBy = scale;
      await sender.setParameters(params);
      log.info(
        'peer',
        `adaptive quality: ${reason} → scaleResolutionDownBy=${scale} (step ${
          this.adaptiveScaleIdx
        }/${Peer.ADAPTIVE_SCALE_STEPS.length - 1})`,
      );
    } catch (e: any) {
      log.warn('peer', `adaptive scale apply failed: ${e?.message || e}`);
    }
  }

  /** Detaches/re-attaches the sender while preserving the live capture track. */
  async setScreenPaused(paused: boolean): Promise<void> {
    if (
      !this.screenSender?.replaceTrack ||
      !this.screenTrack ||
      this.screenPaused === paused
    ) {
      return;
    }
    await this.screenSender.replaceTrack(paused ? null : this.screenTrack);
    this.screenPaused = paused;
    log.info(
      'peer',
      `screen sender ${paused ? 'paused' : 'resumed'} for participant ${
        this.participantId
      }`,
    );
  }

  // Per-device hardware-H.264 decision, cached for the life of the process so
  // repeat connections (and other Peer instances) don't re-run the native
  // capability check for a size already answered. Keyed by "WxH" since a
  // device can be asked for different capture sizes (captureResolutionScale,
  // orientation). h264RuntimeFailed is a hard kill-switch: if H.264 was ever
  // selected and genuinely produced 0 frames on THIS device despite passing
  // the static capability check (a real driver bug, not just a size-alignment
  // issue), every later connection this session falls back to VP8 — no
  // per-device manual config, this is what "every phone decides for itself,
  // automatically, and safely" actually requires for a product used across a
  // fleet of unknown devices.
  private static h264CapabilityCache = new Map<string, boolean>();
  private static h264RuntimeFailed = false;
  private usingH264 = false;
  private zeroFrameTicks = 0;

  /**
   * Decides VP8 vs hardware H.264 for THIS connection, per-device: queries
   * RemoteControl.supportsHardwareH264() for the actual captured size (not a
   * hardcoded device list), defaulting to the universally-safe VP8 on any
   * failure, uncertainty, or a prior runtime failure this session.
   */
  private async selectVideoCodec(vtx: any, videoTrack: MediaStreamTrack): Promise<void> {
    let preferH264 = false;
    if (!Peer.h264RuntimeFailed) {
      try {
        const settings: any = (videoTrack as any).getSettings?.() || {};
        const w = Math.round(settings.width || 0);
        const h = Math.round(settings.height || 0);
        if (w > 0 && h > 0) {
          const key = `${w}x${h}`;
          const cached = Peer.h264CapabilityCache.get(key);
          if (cached !== undefined) {
            preferH264 = cached;
          } else {
            preferH264 = await RemoteControl.supportsHardwareH264(w, h);
            Peer.h264CapabilityCache.set(key, preferH264);
            log.info('peer', `hardware H.264 capability for ${key}: ${preferH264}`);
          }
        }
      } catch (e: any) {
        log.warn('peer', `H.264 capability check failed, using software VP8: ${e?.message || e}`);
        preferH264 = false;
      }
    }
    this.usingH264 = preferH264;
    try {
      const caps = (RTCRtpReceiver as any).getCapabilities?.('video');
      if (!caps?.codecs || !vtx?.setCodecPreferences) {
        return;
      }
      const re = preferH264 ? /h264/i : /vp8/i;
      const primary = caps.codecs.filter((c: any) => re.test(c.mimeType));
      const rest = caps.codecs.filter((c: any) => !re.test(c.mimeType));
      if (primary.length) {
        vtx.setCodecPreferences([...primary, ...rest]);
        log.info(
          'peer',
          `codec preference set: ${preferH264 ? 'H.264 (hardware)' : 'VP8 (software)'} first`,
        );
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
  async answer(
    offerSdp: string,
    stream: MediaStream | null,
    screenPaused = false,
    fps?: number,
    resolutionScale?: number,
  ): Promise<string> {
    await this.pc.setRemoteDescription(
      new RTCSessionDescription({ type: 'offer', sdp: offerSdp }),
    );
    this.remoteSet = true;
    if (stream) {
      await this.addScreen(stream, screenPaused, fps, resolutionScale);
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
      `answer created (m=video:${hasVideo}, sends:${sendsVideo}, fp=${this.answerFingerprint.slice(
        0,
        16,
      )}…)`,
    );
    return sdp;
  }

  /** addRemoteIce adds a trickled candidate from the participant. */
  async addRemoteIce(
    candidate: string,
    sdpMid: string,
    sdpMLineIndex: number,
  ): Promise<void> {
    if (!candidate) {
      return; // end-of-candidates marker
    }
    const ice = new RTCIceCandidate({ candidate, sdpMid, sdpMLineIndex });
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
          if (
            s.type === 'outbound-rtp' &&
            (s.kind === 'video' || s.mediaType === 'video')
          ) {
            encoded = s.framesEncoded || 0;
            pkts = s.packetsSent || 0;
            w = s.frameWidth || 0;
            h = s.frameHeight || 0;
          }
        });
        log.info(
          'peer',
          `outbound video ${w}x${h}: encoded ${encoded}, packetsSent ${pkts}`,
        );
      } catch (e: any) {
        log.warn('peer', `sender stats failed: ${e?.message || e}`);
      }
    }
  }

  /** selectedPair returns the nominated local/remote candidate types for audit. */
  async selectedPair(): Promise<{ local: string; remote: string } | null> {
    try {
      const stats = await this.pc.getStats();
      let pair: any = null;
      stats.forEach((r: any) => {
        if (
          r.type === 'candidate-pair' &&
          (r.nominated || r.selected) &&
          r.state === 'succeeded'
        ) {
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
      return { local, remote };
    } catch {
      return null;
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.stopAdaptiveQuality();
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
