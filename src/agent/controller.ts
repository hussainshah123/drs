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
import {Api, ApiError, type ApiMessage} from '../core/api';
import {log} from '../core/log';
import {makeTokenProvider, type DeviceToken} from '../core/token';
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
  MessageKind,
  MessageStatus,
  type SignalMsg,
} from '../proto/signal';
import * as Inbox from '../messages/store';
import type {InboxKind, InboxStatus} from '../messages/store';
import {pushNotif} from '../notifications/store';
import {Peer} from '../webrtc/peer';
import {ScreenShare} from '../webrtc/screenShare';
import {handleControlMessage} from '../webrtc/inputHandler';
import {applyInputEvent, forgetInput} from '../webrtc/sessionInput';
import type {SessionMsg} from '../proto/session';
import {RemoteControl} from '../native/remoteControl';
import {DeviceManagement, type DeviceOwnerStatus} from '../native/deviceManagement';
import {DeviceData} from '../native/deviceData';
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
  /** DPC status: whether the app is a device admin / the Device Owner. */
  deviceAdminActive: boolean;
  deviceOwner: boolean;
  participants: ParticipantView[];
  pendingConsent: PendingConsent | null;
};

type SessionMeta = {controlMode: number};

/** Command kinds (mirror of CommandKind in the proto) the Android agent acts on. */
const CmdKind = {
  REFRESH_INFO: 3,
  REBOOT: 5,
  SHUTDOWN: 7,
  LOCK: 8,
  LOGOFF: 9,
  MDM_WIPE: 17,
  MDM_SELECTIVE_WIPE: 18,
  MDM_LOCK: 23,
  MDM_LOCATE: 24,
} as const;

const MESSAGE_KINDS: Record<number, InboxKind> = {
  [MessageKind.CHAT]: 'chat',
  [MessageKind.BANNER]: 'banner',
  [MessageKind.TRAY]: 'tray',
  [MessageKind.FULLSCREEN]: 'fullscreen',
};

const ACK_STATUS: Record<InboxStatus, number> = {
  delivered: MessageStatus.DELIVERED,
  read: MessageStatus.READ,
  acknowledged: MessageStatus.ACKNOWLEDGED,
  dismissed: MessageStatus.DISMISSED,
};

/**
 * messageText reads the display text from a message's body_json: {"text": …}
 * for chat and plain sends. A template body without text is shown raw, like
 * the desktop agents do.
 */
function messageText(bodyJson: unknown): string {
  let raw = '';
  try {
    const TD = (globalThis as any).TextDecoder;
    raw =
      bodyJson instanceof Uint8Array && TD
        ? new TD().decode(bodyJson)
        : typeof bodyJson === 'string'
        ? bodyJson
        : '';
  } catch {}
  if (!raw) {
    return 'New message';
  }
  try {
    return bodyText(JSON.parse(raw), raw);
  } catch {
    return raw; // plain-text body
  }
}

/** bodyText picks the display text out of a decoded message body. */
function bodyText(body: any, raw = JSON.stringify(body ?? {})): string {
  const text = body?.text ?? body?.body ?? body?.message;
  return typeof text === 'string' && text ? text : raw;
}

const HISTORY_STATUS: Record<ApiMessage['status'], InboxStatus | null> = {
  queued: null,
  expired: null,
  delivered: 'delivered',
  read: 'read',
  acknowledged: 'acknowledged',
  dismissed: 'dismissed',
};

/** historyRow maps a GET /v1/agent/messages row onto the inbox. */
function historyRow(m: ApiMessage): Inbox.HistoryRow {
  // sender_type 'agent' means this device sent it back to the operator.
  const outgoing = m.sender_type === 'agent';
  return {
    id: m.id,
    kind: m.kind,
    sender: outgoing ? 'You' : m.sender_name || 'Support',
    text: bodyText(m.body),
    templateId: m.template_id || undefined,
    receivedAt: Date.parse(m.created_at) || Date.now(),
    expiresAt: m.expires_at ? Date.parse(m.expires_at) : undefined,
    serverStatus: HISTORY_STATUS[m.status],
    expired: m.status === 'expired',
    outgoing,
  };
}

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
  private api: Api;
  private deviceToken: () => Promise<DeviceToken>;
  private cachedToken: DeviceToken | null = null;
  private historyUnsupported = false;

  constructor(
    private config: AppConfig,
    private identity: Identity,
    private agentInfo: AgentStateInput,
    private autoAcceptConsent: boolean,
  ) {
    const api = new Api(config.apiBaseUrl);
    const baseProvider = makeTokenProvider(api, identity);
    this.api = api;
    this.deviceToken = baseProvider;
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
      deviceAdminActive: false,
      deviceOwner: false,
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
      onCredentialDelivery: d => this.onCredentialDelivery(d),
      onMessage: m => void this.onMessage(m),
      onGatewayError: (code, msg) => log.warn('ctrl', `gateway error ${code}: ${msg}`),
    };

    this.signal = new SignalClient(tokenProvider, agentInfo, events);

    // When capture fully stops (last viewer left, or the system ended it), drop
    // the persistent hold so the next session re-establishes it (and, if the OS
    // interrupted it, re-prompts once) instead of silently staying off.
    this.screen.onStopped = () => {
      if (this.screenHeld || this.state.sharing || this.state.screenActive) {
        this.screenHeld = false;
        this.patch({sharing: false, screenActive: false});
      }
    };
  }

  // -------------------------------------------------------------------------
  // Public API for the UI
  // -------------------------------------------------------------------------

  start(): void {
    log.info('ctrl', 'starting agent');
    this.signal.start();
    void this.refreshAccessibility();
    void this.refreshDeviceAdmin();
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

  /** Refreshes the DPC status (device admin / Device Owner) into the state. */
  async refreshDeviceAdmin(): Promise<void> {
    const s: DeviceOwnerStatus = await DeviceManagement.getStatus();
    this.patch({deviceAdminActive: s.adminActive, deviceOwner: s.deviceOwner});
  }

  /** Opens the system "add device admin" screen (dev / non-owner devices). */
  openDeviceAdminSettings(): Promise<void> {
    return DeviceManagement.openDeviceAdminSettings();
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
    void this.flushMessageAcks();
    void this.refreshHistory();
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

    const peer = new Peer(
      pid,
      sessionId,
      this.config.iceServers,
      this.config.forceRelay,
      {
        deviceId: this.identity.deviceId,
        agentVersion: this.agentInfo.agentVersion,
        permissions: this.perms.get(pid) || 0,
        secretKey: this.identity.keyPair.secretKey,
      },
      {
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
        onInput: input => this.onSessionInput(pid, input),
        onConnected: () => this.onPeerConnected(pid),
        onFailed: () => log.warn('ctrl', `peer ${pid} failed`),
      },
    );
    this.peers.set(pid, peer);

    try {
      // Screen capture (MediaProjection) needs a resumed Activity. A hidden /
      // background agent has none, so bring MainActivity to the foreground first
      // (a Device Owner may start it from the background) and give it a moment to
      // resume before capturing. Skipped once a capture is already held.
      if (!this.screen.active) {
        await DeviceManagement.launchAgentActivity();
        await new Promise<void>(resolve => setTimeout(() => resolve(), 800));
      }
      log.info('ctrl', 'acquiring screen capture for the session');
      const stream = await this.screen.acquire();
      // One-time-permission behaviour: keep the capture alive after this session
      // so later connections reuse it instead of re-prompting. The owner only
      // ever approves the system prompt on this first connection.
      if (this.config.autoShareScreen && !this.screenHeld) {
        await this.screen.acquire(); // extra retained reference, no new prompt
        this.screenHeld = true;
        log.info('ctrl', 'holding screen capture for future sessions (one-time grant)');
      }
      this.patch({screenActive: this.screen.active, sharing: this.screenHeld});
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
    const peer = this.peers.get(pid);
    void handleControlMessage(data, reply => peer?.sendControl(reply));
  }

  /** onSessionInput applies a decoded drs.session InputEvent, if the participant
   * holds control_input and the mode allows input. */
  private onSessionInput(pid: number, input: SessionMsg) {
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
    void applyInputEvent(pid, input);
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

  /**
   * onMessage handles an out-of-session message (docs/gateway.md C6). The
   * gateway redelivers every still-queued message on each connect, so it is
   * deduped on message_id; a redelivery only re-sends the current status.
   */
  private async onMessage(m: SignalMsg) {
    const id = String(m?.message_id ?? '');
    if (!id || id === '0') {
      return;
    }
    await Inbox.loadInbox();
    const kind = MESSAGE_KINDS[Number(m.kind)] || 'chat';
    const sender = m.sender_name ? String(m.sender_name) : 'Support';
    const text = messageText(m.body_json);
    const expiresAt =
      m.expires_at?.seconds !== undefined ? Number(m.expires_at.seconds) * 1000 : undefined;

    const isNew = Inbox.receive({
      id,
      kind,
      sender,
      text,
      templateId: m.template_id || undefined,
      receivedAt: Date.now(),
      expiresAt,
    });
    if (!isNew) {
      log.info('ctrl', `message ${id} redelivered`);
      this.syncMessage(id);
      return;
    }
    log.info('ctrl', `message ${id} (${kind}) from ${sender}`);
    this.syncMessage(id);

    void DeviceData.notify(sender, text);
    pushNotif({
      id: `msg_${id}`,
      kind: 'message',
      title: kind === 'chat' ? `Message from ${sender}` : sender,
      body: text,
      ts: Date.now(),
    });
  }

  /**
   * updateMessage records what the person at the device did with a message
   * (read, acknowledged, dismissed) and reports it to the operator.
   */
  updateMessage(id: string, status: 'read' | 'acknowledged' | 'dismissed'): void {
    if (Inbox.advance(id, status)) {
      this.syncMessage(id);
    }
  }

  /** syncMessage sends a message's status if the gateway has not been told it yet. */
  private syncMessage(id: string) {
    const msg = Inbox.getInboxMessage(id);
    if (!msg || msg.synced === msg.status) {
      return;
    }
    if (this.signal.sendMessageAck(Number(id), ACK_STATUS[msg.status])) {
      Inbox.markSynced(id, msg.status);
    }
  }

  /**
   * refreshHistory loads the newest page of this device's message history
   * (GET /v1/agent/messages) so messages sent before this install, or that
   * the device missed, appear in the inbox.
   */
  async refreshHistory(): Promise<void> {
    await this.loadHistory(undefined);
  }

  /** loadOlderHistory loads the next older page, if there is one. */
  async loadOlderHistory(): Promise<void> {
    const {cursor} = Inbox.getHistoryState();
    if (cursor) {
      await this.loadHistory(cursor);
    }
  }

  private async loadHistory(cursor: string | undefined) {
    // An API without GET /v1/agent/messages (older deploy) is asked once per run.
    if (Inbox.getHistoryState().loading || this.historyUnsupported) {
      return;
    }
    Inbox.setHistoryState({loading: true, error: null});
    try {
      await Inbox.loadInbox();
      const page = await this.api.messages(await this.jwt(), cursor);
      Inbox.mergeHistory(page.data.map(historyRow));
      // A refresh only moves the cursor before the first load; after that the
      // older pages already reached stay reachable.
      const prev = Inbox.getHistoryState().cursor;
      Inbox.setHistoryState({
        loading: false,
        cursor: cursor || prev === undefined ? page.next_cursor : prev,
      });
      // Rows the server still holds as queued need their delivered ack.
      void this.flushMessageAcks();
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 404 && e.message === 'no such endpoint') {
        this.historyUnsupported = true;
        log.warn('ctrl', 'message history is not available on this server; showing live messages only');
        Inbox.setHistoryState({loading: false, cursor: null, error: null});
        return;
      }
      log.warn('ctrl', `message history failed: ${e?.message || e}`);
      Inbox.setHistoryState({loading: false, error: 'Could not load message history'});
    }
  }

  /**
   * sendToOperator sends a chat message from this device to its operators over
   * the signalling socket (SignalMessage.message_send) and echoes it into the
   * inbox as an outgoing bubble. The gateway assigns the real id and persists
   * it; the echo is reconciled when history next loads. Throws if the socket is
   * not connected so the UI can surface it.
   */
  async sendToOperator(text: string): Promise<void> {
    const body = text.trim();
    if (!body) {
      return;
    }
    if (!this.signal.sendMessage(body)) {
      throw new Error('Not connected — your message will send once you are back online.');
    }
    await Inbox.loadInbox();
    Inbox.addOutgoing({kind: 'chat', sender: 'You', text: body, receivedAt: Date.now()});
  }

  /** jwt returns a device JWT for the agent API, reusing one with time left. */
  private async jwt(): Promise<string> {
    const t = this.cachedToken;
    if (t && t.expiresAt - Date.now() > 120000) {
      return t.token;
    }
    this.cachedToken = await this.deviceToken();
    return this.cachedToken.token;
  }

  /** flushMessageAcks re-sends statuses that changed while the socket was down. */
  private async flushMessageAcks() {
    await Inbox.loadInbox();
    for (const msg of Inbox.unsynced()) {
      this.syncMessage(msg.id);
    }
  }

  private async onCommand(c: SignalMsg) {
    const id = Number(c.command_id);
    const key = c.idempotency_key || '';
    const kind = Number(c.kind);
    log.info('ctrl', `command ${id} kind=${kind}`);
    this.signal.sendCommandAck(id, key, CommandAckState.RUNNING);

    const ok = (output: string) =>
      this.signal.sendCommandResult({
        command_id: id,
        idempotency_key: key,
        status: CommandStatus.SUCCEEDED,
        output,
      });
    const fail = (detail: string) =>
      this.signal.sendCommandResult({
        command_id: id,
        idempotency_key: key,
        status: CommandStatus.FAILED,
        error_detail: detail,
      });

    try {
      switch (kind) {
        case CmdKind.LOCK:
        case CmdKind.MDM_LOCK: {
          // Prefer the DevicePolicyManager lock (works without accessibility and
          // on a Device Owner); fall back to the accessibility global action.
          let locked = await DeviceManagement.lockNow();
          if (!locked) {
            locked = await RemoteControl.globalAction('GLOBAL_ACTION_LOCK_SCREEN');
          }
          locked
            ? ok('screen locked')
            : fail('cannot lock: enable device admin or the accessibility service');
          return;
        }
        case CmdKind.REBOOT: {
          await DeviceManagement.reboot();
          ok('reboot initiated');
          return;
        }
        case CmdKind.MDM_WIPE: {
          const external = this.parseBool(c.payload_json, 'external');
          await DeviceManagement.wipeDevice(external);
          ok('device wipe initiated');
          return;
        }
        case CmdKind.REFRESH_INFO: {
          await this.refreshDeviceAdmin();
          this.signal.sendInventoryReport(
            1,
            {platform: 'android', os_version: this.agentInfo.osVersion, hostname: this.agentInfo.hostname},
            [],
            [],
          );
          ok('inventory refreshed');
          return;
        }
        // Not applicable on Android (no user session logoff / power-off / work
        // profile to selectively wipe; locate needs location services not wired).
        case CmdKind.SHUTDOWN:
        case CmdKind.LOGOFF:
        case CmdKind.MDM_SELECTIVE_WIPE:
        case CmdKind.MDM_LOCATE:
          fail(`command kind ${kind} not applicable on android agent`);
          return;
        default:
          fail(`command kind ${kind} not supported on android agent`);
          return;
      }
    } catch (e: any) {
      fail(e?.message || String(e));
    }
  }

  /** parseBool reads a boolean field from a protobuf `bytes` payload_json blob. */
  private parseBool(payloadJson: unknown, field: string): boolean {
    try {
      if (!payloadJson) {
        return false;
      }
      // TextDecoder is installed as a global by src/polyfills (Hermes lacks it).
      const TD = (globalThis as any).TextDecoder;
      const text =
        payloadJson instanceof Uint8Array && TD
          ? new TD().decode(payloadJson)
          : String(payloadJson);
      const obj = JSON.parse(text);
      return obj?.[field] === true;
    } catch {
      return false;
    }
  }

  /**
   * Credential delivery (logon/UAC/run-as) is a Windows concept: Android has no
   * equivalent injection target for a sealed OS credential, so the agent acks the
   * delivery as not performed with a clear reason rather than leaving the
   * operator waiting. (The sealed blob is never unsealed here.)
   */
  private onCredentialDelivery(d: SignalMsg) {
    const deliveryId = d?.delivery_id || '';
    log.info('ctrl', `credential delivery ${deliveryId} — not applicable on android`);
    this.signal.sendCredentialDeliveryAck(
      deliveryId,
      false,
      'credential injection not applicable on android',
    );
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
    forgetInput(pid);
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
