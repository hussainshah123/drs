/**
 * Agent controller — the brain that ties the signalling client, WebRTC peers,
 * screen capture, remote input and the device command queue together.
 *
 * Lifecycle per remote session:
 *   1. Operator's ParticipantJoin arrives → record their grant (permissions) and
 *      the session's control mode.
 *   2. (Attended or when required) ConsentRequest arrives → prompt the end user
 *      (or auto-accept per settings) → ConsentResponse.
 *   3. Operator sends a SessionOffer → the agent acquires the screen capture,
 *      attaches the track, answers, and trickles ICE.
 *   4. The operator's "control" data channel carries input events; the agent
 *      injects them through the AccessibilityService only when the participant
 *      holds control_input.
 *   5. ParticipantLeave / SessionEnded → tear down the peer; release the screen
 *      when the last viewer is gone.
 *
 * UI observes state via subscribe(); it never talks to the gateway directly.
 */
import {Api} from '../core/api';
import {log} from '../core/log';
import {makeTokenProvider} from '../core/token';
import type {AppConfig, Identity} from '../core/storage';
import {
  SignalClient,
  type AgentStateInput,
  type SignalStatus,
  type SignalEvents,
} from '../signal/client';
import {
  CommandAckState,
  CommandStatus,
  ControlMode,
  MessageStatus,
  type SignalMsg,
} from '../proto/signal';
import {Peer} from '../webrtc/peer';
import {ScreenShare} from '../webrtc/screenShare';
import {handleControlMessage} from '../webrtc/inputHandler';
import {RemoteControl} from '../native/remoteControl';
import {Cap, can} from './capabilities';

export type PendingConsent = {
  requestId: string;
  sessionId: string;
  participantName: string;
  tenantName: string;
  requestedPermissions: number;
  expiresAt: number;
};

export type ParticipantView = {
  participantId: number;
  name: string;
  permissions: number;
  controlAllowed: boolean;
  connected: boolean;
};

export type ControllerState = {
  signal: SignalStatus;
  deviceId: string;
  screenActive: boolean;
  /** The owner has pre-started screen sharing so sessions reuse it. */
  sharing: boolean;
  accessibilityEnabled: boolean;
  participants: ParticipantView[];
  pendingConsent: PendingConsent | null;
};

type SessionMeta = {controlMode: number};

export class AgentController {
  private signal: SignalClient;
  private screen = new ScreenShare();
  private screenHeld = false;
  private peers = new Map<number, Peer>();
  private perms = new Map<number, number>(); // participantId -> permission bitmask
  private names = new Map<number, string>();
  private connected = new Set<number>();
  private sessionOf = new Map<number, string>(); // participantId -> sessionId
  private sessions = new Map<string, SessionMeta>();
  private state: ControllerState;
  private listeners = new Set<(s: ControllerState) => void>();

  constructor(
    private config: AppConfig,
    private identity: Identity,
    private agentInfo: AgentStateInput,
    private autoAcceptConsent: boolean,
  ) {
    const api = new Api(config.apiBaseUrl);
    const baseProvider = makeTokenProvider(api, identity);
    // A gateway override in settings wins over the URL the API returns.
    const tokenProvider = async () => {
      const t = await baseProvider();
      return config.gatewayUrlOverride
        ? {...t, gatewayUrl: config.gatewayUrlOverride}
        : t;
    };

    this.state = {
      signal: 'idle',
      deviceId: identity.deviceId,
      screenActive: false,
      sharing: false,
      accessibilityEnabled: false,
      participants: [],
      pendingConsent: null,
    };

    const events: SignalEvents = {
      onStatusChange: s => this.patch({signal: s}),
      onRegistered: (deviceId, invReq) => this.onRegistered(deviceId, invReq),
      onParticipantJoin: j => this.onParticipantJoin(j),
      onParticipantLeave: l => this.onParticipantLeave(l),
      onParticipantRoleChange: c => this.onRoleChange(c),
      onPermissionGrant: g => this.onPermissionGrant(g),
      onSessionOffer: o => void this.onSessionOffer(o),
      onIceCandidate: c => void this.onIceCandidate(c),
      onConsentRequest: r => this.onConsentRequest(r),
      onSessionEnded: e => this.onSessionEnded(e),
      onRekeyRequest: r => log.info('ctrl', `rekey requested: ${r?.reason || ''}`),
      onCommand: c => void this.onCommand(c),
      onMessage: m => this.onMessage(m),
      onGatewayError: (code, msg) => log.warn('ctrl', `gateway error ${code}: ${msg}`),
    };

    this.signal = new SignalClient(tokenProvider, agentInfo, events);
  }

  // -------------------------------------------------------------------------
  // Public API for the UI
  // -------------------------------------------------------------------------

  start(): void {
    log.info('ctrl', 'starting agent');
    this.signal.start();
    void this.refreshAccessibility();
  }

  stop(): void {
    log.info('ctrl', 'stopping agent');
    this.signal.stop();
    this.teardownAll();
  }

  subscribe(fn: (s: ControllerState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  getState(): ControllerState {
    return this.state;
  }

  async refreshAccessibility(): Promise<void> {
    const enabled = await RemoteControl.isAccessibilityEnabled();
    this.patch({accessibilityEnabled: enabled});
  }

  /**
   * startSharing captures the screen now and HOLDS it, so that when an operator
   * connects later the agent reuses this capture instead of prompting again.
   * The owner taps this once (with the app open) and grants the prompt; the
   * MediaProjection foreground service then keeps the capture alive even when the
   * app is backgrounded. Returns null on success or an error message.
   */
  async startSharing(): Promise<string | null> {
    if (this.screenHeld) {
      return null;
    }
    try {
      log.info('ctrl', 'starting screen sharing (grant the prompt on the device)');
      await this.screen.acquire(); // held reference; not released until stopSharing
      this.screenHeld = true;
      this.patch({sharing: true, screenActive: this.screen.active});
      log.info('ctrl', 'screen sharing active — operators can now view this device');
      return null;
    } catch (e: any) {
      const msg =
        e?.name === 'NotAllowedError'
          ? 'Screen capture was denied. Tap "Start now" on the prompt (keep this app open).'
          : e?.message || String(e);
      log.error('ctrl', `start sharing failed: ${msg}`);
      return msg;
    }
  }

  /** stopSharing releases the held capture (sessions will prompt again). */
  stopSharing(): void {
    if (this.screenHeld) {
      this.screen.release();
      this.screenHeld = false;
      log.info('ctrl', 'screen sharing stopped');
      this.patch({sharing: false, screenActive: this.screen.active});
    }
  }

  respondConsent(granted: boolean): void {
    const c = this.state.pendingConsent;
    if (!c) {
      return;
    }
    this.signal.sendConsentResponse(c.requestId, granted, 0);
    log.info('ctrl', `consent ${granted ? 'granted' : 'denied'} for ${c.participantName}`);
    this.patch({pendingConsent: null});
  }

  // -------------------------------------------------------------------------
  // Signalling handlers
  // -------------------------------------------------------------------------

  private onRegistered(deviceId: string, inventoryRequested: boolean) {
    this.patch({deviceId});
    if (inventoryRequested) {
      this.signal.sendInventoryReport(
        1,
        {
          platform: 'android',
          os_version: this.agentInfo.osVersion,
          hostname: this.agentInfo.hostname,
        },
        [],
        [],
      );
    }
  }

  private onParticipantJoin(j: SignalMsg) {
    const p = j?.participant;
    if (!p) {
      return;
    }
    const pid = Number(p.participant_id);
    this.perms.set(pid, Number(p.permissions) || 0);
    this.names.set(pid, p.display_name || `participant ${pid}`);
    if (j.session_id) {
      this.sessionOf.set(pid, j.session_id);
    }
    const s = j?.session;
    if (s?.session_id) {
      this.sessions.set(s.session_id, {controlMode: Number(s.control_mode) || 0});
    }
    log.info('ctrl', `participant joined: ${this.names.get(pid)} perms=${this.perms.get(pid)}`);
    this.publishParticipants();
  }

  private onRoleChange(c: SignalMsg) {
    const pid = Number(c.participant_id);
    if (c.permissions !== undefined) {
      this.perms.set(pid, Number(c.permissions) || 0);
    }
    this.publishParticipants();
  }

  private onPermissionGrant(g: SignalMsg) {
    const pid = Number(g.participant_id);
    this.perms.set(pid, Number(g.permissions) || 0);
    log.info('ctrl', `permissions updated for ${pid}: ${this.perms.get(pid)}`);
    this.publishParticipants();
  }

  private onConsentRequest(r: SignalMsg) {
    const p = r?.participant;
    const consent: PendingConsent = {
      requestId: r.request_id,
      sessionId: r.session_id,
      participantName: p?.display_name || 'A technician',
      tenantName: r.tenant_name || '',
      requestedPermissions: Number(r.requested_permissions) || 0,
      expiresAt: Date.now() + (Number(r.timeout_seconds) || 30) * 1000,
    };
    if (this.autoAcceptConsent) {
      log.info('ctrl', `auto-accepting consent for ${consent.participantName}`);
      this.signal.sendConsentResponse(consent.requestId, true, 0);
      return;
    }
    this.patch({pendingConsent: consent});
  }

  private async onSessionOffer(o: SignalMsg) {
    const pid = Number(o?.from?.participant_id);
    const sessionId = o?.session_id;
    if (!pid || !sessionId) {
      return;
    }
    log.info('ctrl', `session offer from participant ${pid}`);

    // A new offer (reconnect / ICE restart) replaces any existing peer.
    this.closePeer(pid);
    this.sessionOf.set(pid, sessionId);
    this.signal.addSession(sessionId);

    const peer = new Peer(pid, sessionId, this.config.iceServers, this.config.forceRelay, {
      onLocalIce: cand =>
        this.signal.sendIceCandidate(
          sessionId,
          pid,
          cand
            ? {
                candidate: cand.candidate,
                sdpMid: cand.sdpMid,
                sdpMLineIndex: cand.sdpMLineIndex,
              }
            : null,
        ),
      onControlData: data => this.onControlData(pid, data),
      onConnected: () => this.onPeerConnected(pid),
      onFailed: () => log.warn('ctrl', `peer ${pid} failed`),
    });
    this.peers.set(pid, peer);

    try {
      log.info('ctrl', 'acquiring screen capture for the session');
      const stream = await this.screen.acquire();
      this.patch({screenActive: this.screen.active});
      // The track is attached inside answer(), after setRemoteDescription.
      const answerSdp = await peer.answer(o.sdp, stream);
      this.signal.sendSessionAnswer(sessionId, pid, answerSdp);
      log.info('ctrl', `answered participant ${pid}`);
    } catch (e: any) {
      if (e?.name === 'NotAllowedError') {
        log.error(
          'ctrl',
          'screen capture denied — keep this app in the foreground and tap "Start now" when the prompt appears',
        );
      } else {
        log.error('ctrl', `failed to answer ${pid}: ${e?.message || e}`);
      }
      this.closePeer(pid);
    }
  }

  private async onIceCandidate(c: SignalMsg) {
    const pid = Number(c?.from?.participant_id);
    const peer = this.peers.get(pid);
    if (!peer) {
      return;
    }
    if (c.end_of_candidates) {
      return;
    }
    await peer.addRemoteIce(c.candidate || '', c.sdp_mid || '', Number(c.sdp_mline_index) || 0);
  }

  private onControlData(pid: number, data: string) {
    const perm = this.perms.get(pid) || 0;
    const sessionId = this.sessionOf.get(pid);
    const mode = sessionId ? this.sessions.get(sessionId)?.controlMode : undefined;
    const modeAllowsInput =
      mode === undefined ||
      mode === ControlMode.FULL ||
      mode === ControlMode.PARALLEL ||
      mode === ControlMode.BACKSTAGE;
    if (!can(perm, Cap.CONTROL_INPUT) || !modeAllowsInput) {
      return; // view-only participant: ignore input
    }
    void handleControlMessage(data);
  }

  private async onPeerConnected(pid: number) {
    this.connected.add(pid);
    this.publishParticipants();
    const peer = this.peers.get(pid);
    const sessionId = this.sessionOf.get(pid);
    if (peer && sessionId) {
      const pair = await peer.selectedPair();
      if (pair) {
        const relay = pair.local === 'relay' || pair.remote === 'relay';
        const name = this.names.get(pid) || `participant ${pid}`;
        log.info(
          'ctrl',
          `screen now streaming to ${name} via ${relay ? 'TURN relay' : 'direct P2P'} (${pair.local}/${pair.remote})`,
        );
        // Note: TransportReport is a participant→gateway message; the gateway
        // rejects it from agents, so we only log the path here.
      }
      // Confirm the agent is actually encoding + sending screen frames.
      void peer.logSenderStats();
    }
  }

  private onParticipantLeave(l: SignalMsg) {
    const pid = Number(l.participant_id);
    log.info('ctrl', `participant ${pid} left (${l.reason})`);
    this.closePeer(pid);
    this.perms.delete(pid);
    this.names.delete(pid);
    this.sessionOf.delete(pid);
    this.publishParticipants();
  }

  private onSessionEnded(e: SignalMsg) {
    const sessionId = e?.session_id;
    log.info('ctrl', `session ${sessionId} ended: ${e?.reason || ''}`);
    for (const [pid, sid] of Array.from(this.sessionOf.entries())) {
      if (sid === sessionId) {
        this.closePeer(pid);
        this.perms.delete(pid);
        this.names.delete(pid);
        this.sessionOf.delete(pid);
      }
    }
    if (sessionId) {
      this.sessions.delete(sessionId);
      this.signal.removeSession(sessionId);
    }
    this.publishParticipants();
  }

  private onMessage(m: SignalMsg) {
    log.info('ctrl', `message ${m.message_id} received`);
    this.signal.sendMessageAck(Number(m.message_id), MessageStatus.DELIVERED);
  }

  private async onCommand(c: SignalMsg) {
    const id = Number(c.command_id);
    const key = c.idempotency_key || '';
    const kind = Number(c.kind);
    log.info('ctrl', `command ${id} kind=${kind}`);
    this.signal.sendCommandAck(id, key, CommandAckState.RUNNING);

    // COMMAND_KIND_LOCK (8) and COMMAND_KIND_MDM_LOCK (23): lock the screen.
    if (kind === 8 || kind === 23) {
      const ok = await RemoteControl.globalAction('GLOBAL_ACTION_LOCK_SCREEN');
      this.signal.sendCommandResult({
        command_id: id,
        idempotency_key: key,
        status: ok ? CommandStatus.SUCCEEDED : CommandStatus.FAILED,
        output: ok ? 'screen locked' : 'accessibility service not enabled',
      });
      return;
    }
    // COMMAND_KIND_REFRESH_INFO (3): resend inventory.
    if (kind === 3) {
      this.signal.sendInventoryReport(
        1,
        {platform: 'android', os_version: this.agentInfo.osVersion, hostname: this.agentInfo.hostname},
        [],
        [],
      );
      this.signal.sendCommandResult({
        command_id: id,
        idempotency_key: key,
        status: CommandStatus.SUCCEEDED,
        output: 'inventory refreshed',
      });
      return;
    }
    // Everything else is not supported on the Android agent (yet).
    this.signal.sendCommandResult({
      command_id: id,
      idempotency_key: key,
      status: CommandStatus.FAILED,
      error_detail: `command kind ${kind} not supported on android agent`,
    });
  }

  // -------------------------------------------------------------------------
  // Teardown + state publishing
  // -------------------------------------------------------------------------

  private closePeer(pid: number) {
    const peer = this.peers.get(pid);
    if (peer) {
      peer.close();
      this.peers.delete(pid);
      this.screen.release();
    }
    this.connected.delete(pid);
    this.patch({screenActive: this.screen.active});
  }

  private teardownAll() {
    for (const peer of this.peers.values()) {
      peer.close();
    }
    this.peers.clear();
    this.connected.clear();
    this.perms.clear();
    this.names.clear();
    this.sessionOf.clear();
    this.sessions.clear();
    // Fully release the screen, including any held sharing reference.
    this.screenHeld = false;
    while (this.screen.active) {
      this.screen.release();
    }
    this.patch({screenActive: false, sharing: false, participants: []});
  }

  private publishParticipants() {
    const participants: ParticipantView[] = [];
    for (const [pid, name] of this.names.entries()) {
      const perm = this.perms.get(pid) || 0;
      participants.push({
        participantId: pid,
        name,
        permissions: perm,
        controlAllowed: can(perm, Cap.CONTROL_INPUT),
        connected: this.connected.has(pid),
      });
    }
    this.patch({participants});
  }

  private patch(p: Partial<ControllerState>) {
    this.state = {...this.state, ...p};
    this.listeners.forEach(l => l(this.state));
  }
}
