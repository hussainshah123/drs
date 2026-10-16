/**
 * Signalling client — the agent half of the DRS signalling protocol
 * (docs/gateway.md), ported from tools/fakeagent/agent/agent.go.
 *
 * Responsibilities:
 *   - Open the gateway WebSocket (subprotocol "drs.signal.v1", binary frames).
 *   - Send Register with the device JWT, handle Registered.
 *   - Heartbeat at the interval the gateway sets; refresh the token before expiry.
 *   - Reconnect with exponential backoff; stop when replaced by a newer client.
 *   - Decode inbound SignalMessages and hand them to the orchestrator via events;
 *     provide typed send helpers for the WebRTC and control layers.
 *
 * It owns no WebRTC or OS state; the orchestrator (agent/controller) wires it to
 * screen capture and input injection.
 */
import {
  ClientType,
  Platform as PlatformEnum,
  PROTOCOL_VERSION,
  decode,
  encode,
  nowTimestamp,
  payloadKey,
  type SignalMsg,
} from '../proto/signal';
import {log} from '../core/log';
import type {DeviceToken} from '../core/token';

export type SignalEvents = {
  onRegistered?: (deviceId: string, inventoryRequested: boolean) => void;
  onSessionOffer?: (offer: SignalMsg) => void;
  onIceCandidate?: (cand: SignalMsg) => void;
  onParticipantJoin?: (join: SignalMsg) => void;
  onParticipantLeave?: (leave: SignalMsg) => void;
  onParticipantRoleChange?: (change: SignalMsg) => void;
  onPermissionGrant?: (grant: SignalMsg) => void;
  onConsentRequest?: (req: SignalMsg) => void;
  onSessionEnded?: (ended: SignalMsg) => void;
  onRekeyRequest?: (req: SignalMsg) => void;
  onCommand?: (cmd: SignalMsg) => void;
  onCommandCancel?: (cancel: SignalMsg) => void;
  onMessage?: (msg: SignalMsg) => void;
  onCredentialDelivery?: (del: SignalMsg) => void;
  onGatewayError?: (code: string, message: string) => void;
  onStatusChange?: (status: SignalStatus) => void;
};

export type SignalStatus =
  | 'idle'
  | 'connecting'
  | 'registered'
  | 'reconnecting'
  | 'fatal'
  | 'closed';

export type AgentStateInput = {
  hostname: string;
  lastUser: string;
  osVersion: string;
  agentVersion: string;
  macAddresses?: string[];
};

const SUBPROTOCOL = 'drs.signal.v1';

export class SignalClient {
  private ws: WebSocket | null = null;
  private seq = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1000;
  private stopped = false;
  private connecting = false;
  private status: SignalStatus = 'idle';
  private activeSessions = new Set<string>();
  private startedAt = Date.now();

  constructor(
    private getToken: () => Promise<DeviceToken>,
    private agentState: AgentStateInput,
    private events: SignalEvents,
  ) {}

  /** start opens the connection and keeps it up until stop(). */
  start(): void {
    if (!this.stopped && (this.connecting || this.ws || this.reconnectTimer)) {
      return;
    }
    this.stopped = false;
    this.backoff = 1000;
    void this.connect();
  }

  /** stop closes the connection for good. */
  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connecting = false;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close(1000, 'client stop');
      } catch {}
    }
    this.setStatus('closed');
  }

  getStatus(): SignalStatus {
    return this.status;
  }

  addSession(id: string): void {
    this.activeSessions.add(id);
  }
  removeSession(id: string): void {
    this.activeSessions.delete(id);
  }

  private setStatus(s: SignalStatus) {
    if (this.status !== s) {
      this.status = s;
      this.events.onStatusChange?.(s);
    }
  }

  private clearTimers() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connecting || this.ws) {
      return;
    }
    this.connecting = true;
    this.setStatus(this.backoff > 1000 ? 'reconnecting' : 'connecting');
    let tok: DeviceToken;
    try {
      tok = await this.getToken();
    } catch (e: any) {
      this.connecting = false;
      log.error('signal', `token fetch failed: ${e?.message || e}`);
      this.scheduleReconnect();
      return;
    }
    this.connecting = false;
    // The token fetch is async; if stop() ran meanwhile, do not open a socket
    // (it would duplicate a newer connection and trigger a 4004 ping-pong).
    if (this.stopped) {
      return;
    }

    const url = toWs(tok.gatewayUrl);
    log.info('signal', `connecting ${url}`);
    let ws: WebSocket;
    try {
      // The gateway rejects device tokens that arrive with an Origin header
      // ("not accepted from browsers"). React Native's WebSocket auto-adds an
      // Origin derived from the URL unless we supply one, so we pass an empty
      // origin to suppress the default and register as a native agent.
      ws = new (WebSocket as any)(url, SUBPROTOCOL, {headers: {origin: ''}});
    } catch (e: any) {
      log.error('signal', `websocket open failed: ${e?.message || e}`);
      this.scheduleReconnect();
      return;
    }
    (ws as any).binaryType = 'arraybuffer';
    this.ws = ws;
    this.seq = 0;

    ws.onopen = () => {
      if (this.ws !== ws || this.stopped) {
        return;
      }
      log.info('signal', 'socket open, sending Register');
      this.sendRegister(tok.token);
      this.scheduleRefresh(tok.expiresAt);
    };
    ws.onmessage = ev => {
      if (this.ws === ws && !this.stopped) {
        this.onMessage(ev.data);
      }
    };
    ws.onerror = (ev: any) => {
      if (this.ws !== ws || this.stopped) {
        return;
      }
      log.warn('signal', `socket error: ${ev?.message || 'error'}`);
    };
    ws.onclose = (ev: any) => {
      if (this.ws !== ws) {
        return;
      }
      this.ws = null;
      this.onClose(ev?.code ?? 1006, ev?.reason ?? '');
    };
  }

  private scheduleReconnect() {
    this.clearTimers();
    this.ws = null;
    if (this.stopped || this.reconnectTimer) {
      return;
    }
    this.setStatus('reconnecting');
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 30000);
    log.info('signal', `reconnecting in ${Math.round(wait / 1000)}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, wait);
  }

  private onClose(code: number, reason: string) {
    log.warn('signal', `socket closed ${code} ${reason || ''}`);
    this.clearTimers();
    if (this.stopped) {
      this.setStatus('closed');
      return;
    }
    // 4001 unauthenticated, 4003 forbidden: retrying cannot fix it.
    if (code === 4001 || code === 4003) {
      log.error('signal', `fatal close ${code}; stopping`);
      this.setStatus('fatal');
      this.stopped = true;
      return;
    }
    // 4004 means another connection for this device is already authoritative.
    // Reconnecting here lets stale app instances continually replace the
    // current connection, causing a 4004 ping-pong and interrupting sessions.
    if (code === 4004) {
      log.warn('signal', 'replaced by a newer connection; stopping this stale client');
      this.clearTimers();
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.stopped = true;
      this.setStatus('closed');
      return;
    }
    this.scheduleReconnect();
  }

  // -------------------------------------------------------------------------
  // Outbound
  // -------------------------------------------------------------------------

  /** rawSend writes one frame; it returns false when the socket is not open. */
  private rawSend(payload: SignalMsg): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) {
      return false;
    }
    this.seq += 1;
    const msg: SignalMsg = {seq: this.seq, sent_at: nowTimestamp(), ...payload};
    const outKey = payloadKey(payload);
    if (outKey && outKey !== 'heartbeat') {
      log.info('signal', `↑ send ${outKey} (seq ${this.seq})`);
    } else if (outKey === 'heartbeat') {
      log.debug('signal', `↑ heartbeat (seq ${this.seq})`);
    }
    try {
      const bytes = encode(msg);
      // Send the underlying ArrayBuffer slice as a binary frame.
      const buf = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      ws.send(buf as any);
      return true;
    } catch (e: any) {
      log.error('signal', `encode/send failed: ${e?.message || e}`);
      return false;
    }
  }

  private sendRegister(token: string) {
    this.rawSend({
      register: {
        device_token: token,
        protocol_version: PROTOCOL_VERSION,
        client: {
          type: ClientType.AGENT,
          version: this.agentState.agentVersion,
          platform: PlatformEnum.ANDROID,
          os_version: this.agentState.osVersion,
        },
        agent_state: {
          hostname: this.agentState.hostname,
          last_user: this.agentState.lastUser,
          mac_addresses: this.agentState.macAddresses || [],
        },
      },
    });
  }

  private sendHeartbeat() {
    this.rawSend({
      heartbeat: {
        last_user: this.agentState.lastUser,
        active_session_ids: Array.from(this.activeSessions),
        uptime_seconds: Math.floor((Date.now() - this.startedAt) / 1000),
      },
    });
  }

  sendTokenRefresh(token: string) {
    this.rawSend({token_refresh: {token}});
  }

  sendSessionAnswer(sessionId: string, toParticipantId: number, sdp: string) {
    this.rawSend({
      session_answer: {
        session_id: sessionId,
        to: {participant_id: toParticipantId},
        sdp,
      },
    });
  }

  sendIceCandidate(
    sessionId: string,
    toParticipantId: number,
    cand: {
      candidate: string;
      sdpMid?: string | null;
      sdpMLineIndex?: number | null;
    } | null,
  ) {
    this.rawSend({
      ice_candidate: {
        session_id: sessionId,
        to: {participant_id: toParticipantId},
        candidate: cand?.candidate || '',
        sdp_mid: cand?.sdpMid || '',
        sdp_mline_index: cand?.sdpMLineIndex || 0,
        end_of_candidates: !cand,
      },
    });
  }

  sendConsentResponse(requestId: string, granted: boolean, grantedPermissions = 0) {
    this.rawSend({
      consent_response: {
        request_id: requestId,
        granted,
        granted_permissions: grantedPermissions,
      },
    });
  }

  sendCommandAck(
    commandId: number,
    idempotencyKey: string,
    state: number,
    errorDetail = '',
  ) {
    this.rawSend({
      command_ack: {
        command_id: commandId,
        idempotency_key: idempotencyKey,
        state,
        error_detail: errorDetail,
      },
    });
  }

  sendCommandResult(result: {
    command_id: number;
    idempotency_key: string;
    status: number;
    exit_code?: number;
    output?: string;
    error_detail?: string;
  }) {
    this.rawSend({
      command_result: {
        exit_code: 0,
        output: '',
        error_detail: '',
        ...result,
        finished_at: nowTimestamp(),
      },
    });
  }

  /** sendMessageAck reports a message status; false means it was not sent. */
  sendMessageAck(messageId: number, status: number): boolean {
    return this.rawSend({message_ack: {message_id: messageId, status}});
  }

  /**
   * sendMessage sends a chat message from this device to its operators over the
   * signalling socket (SignalMessage.message_send). false means the socket was
   * not open, so the caller should surface a "not connected" error.
   */
  sendMessage(text: string): boolean {
    // TextEncoder is provided by src/polyfills.ts at runtime (Hermes lacks it).
    const bodyJson: Uint8Array = new (globalThis as any).TextEncoder().encode(
      JSON.stringify({text}),
    );
    return this.rawSend({message_send: {body_json: bodyJson}});
  }

  sendTransportReport(
    sessionId: string,
    transport: number,
    local: string,
    remote: string,
  ) {
    this.rawSend({
      transport_report: {
        session_id: sessionId,
        transport,
        local_candidate_type: local,
        remote_candidate_type: remote,
      },
    });
  }

  sendInventoryReport(inventoryVer: number, hardware: object, software: object[], services: object[]) {
    const enc = (o: unknown) => utf8Encode(JSON.stringify(o));
    this.rawSend({
      inventory_report: {
        inventory_ver: inventoryVer,
        hardware_json: enc(hardware),
        software_json: enc(software),
        services_json: enc(services),
        collected_at: nowTimestamp(),
      },
    });
  }

  sendCredentialDeliveryAck(deliveryId: string, delivered: boolean, errorDetail = '') {
    this.rawSend({
      credential_delivery_ack: {
        delivery_id: deliveryId,
        delivered,
        error_detail: errorDetail,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Inbound
  // -------------------------------------------------------------------------

  private onMessage(data: any) {
    let bytes: Uint8Array;
    if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else if (ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else {
      // Unexpected text frame; ignore.
      return;
    }
    let msg: SignalMsg;
    try {
      msg = decode(bytes);
    } catch (e: any) {
      log.warn('signal', `decode failed: ${e?.message || e}`);
      return;
    }
    const key = payloadKey(msg);
    if (!key) {
      return;
    }
    log.info('signal', `↓ recv ${key}${describeFrame(key, msg)}`);
    this.dispatch(key, msg);
  }

  private dispatch(key: string, msg: SignalMsg) {
    const e = this.events;
    switch (key) {
      case 'registered': {
        const r = msg.registered;
        const deviceId = r?.agent?.device_id || '';
        const invReq = !!r?.agent?.inventory_requested;
        this.backoff = 1000;
        this.setStatus('registered');
        log.info('signal', `registered as device ${deviceId}`);
        this.startHeartbeat(r?.heartbeat_interval_seconds || 30);
        e.onRegistered?.(deviceId, invReq);
        break;
      }
      case 'session_offer':
        e.onSessionOffer?.(msg.session_offer);
        break;
      case 'ice_candidate':
        e.onIceCandidate?.(msg.ice_candidate);
        break;
      case 'participant_join':
        e.onParticipantJoin?.(msg.participant_join);
        break;
      case 'participant_leave':
        e.onParticipantLeave?.(msg.participant_leave);
        break;
      case 'participant_role_change':
        e.onParticipantRoleChange?.(msg.participant_role_change);
        break;
      case 'permission_grant':
        e.onPermissionGrant?.(msg.permission_grant);
        break;
      case 'consent_request':
        e.onConsentRequest?.(msg.consent_request);
        break;
      case 'session_ended':
        e.onSessionEnded?.(msg.session_ended);
        break;
      case 'rekey_request':
        e.onRekeyRequest?.(msg.rekey_request);
        break;
      case 'command':
        e.onCommand?.(msg.command);
        break;
      case 'command_cancel':
        e.onCommandCancel?.(msg.command_cancel);
        break;
      case 'message':
        e.onMessage?.(msg.message);
        break;
      case 'credential_delivery':
        e.onCredentialDelivery?.(msg.credential_delivery);
        break;
      case 'error':
        log.warn('signal', `gateway error ${msg.error?.code}: ${msg.error?.message}`);
        e.onGatewayError?.(msg.error?.code || '', msg.error?.message || '');
        break;
      default:
        break;
    }
  }

  private startHeartbeat(intervalSeconds: number) {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    const every = Math.max(intervalSeconds, 5) * 1000;
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), every);
  }

  private scheduleRefresh(expiresAt: number) {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    const wait = Math.max(expiresAt - Date.now() - 60000, 1000);
    this.refreshTimer = setTimeout(async () => {
      if (this.stopped) {
        return;
      }
      try {
        const tok = await this.getToken();
        if (this.stopped) {
          return;
        }
        this.sendTokenRefresh(tok.token);
        this.scheduleRefresh(tok.expiresAt);
        log.info('signal', 'token refreshed');
      } catch (e: any) {
        if (this.stopped) {
          return;
        }
        log.warn('signal', `token refresh failed: ${e?.message || e}`);
        this.scheduleRefresh(Date.now() + 60000);
      }
    }, wait);
  }
}

/** describeFrame adds a short human-readable detail for an inbound frame. */
function describeFrame(key: string, msg: SignalMsg): string {
  switch (key) {
    case 'participant_join':
      return `  — ${msg.participant_join?.participant?.display_name || '?'} joined`;
    case 'participant_leave':
      return `  — participant ${msg.participant_leave?.participant_id} left`;
    case 'session_offer':
      return `  — from participant ${msg.session_offer?.from?.participant_id}`;
    case 'consent_request':
      return `  — ${msg.consent_request?.participant?.display_name || '?'} requests access`;
    case 'session_ended':
      return `  — ${msg.session_ended?.reason || ''}`;
    case 'command':
      return `  — kind ${msg.command?.kind}`;
    case 'message':
      return `  — id ${msg.message?.message_id} kind ${msg.message?.kind}`;
    case 'error':
      return `  — ${msg.error?.code}: ${msg.error?.message}`;
    default:
      return '';
  }
}

/** toWs converts an http(s) base or ws(s) URL to a gateway /ws WebSocket URL. */
export function toWs(gatewayUrl: string): string {
  let u = gatewayUrl.trim();
  if (u.startsWith('http://')) {
    u = 'ws://' + u.slice(7);
  } else if (u.startsWith('https://')) {
    u = 'wss://' + u.slice(8);
  }
  // If the caller gave only an origin (no path), default to the gateway's /ws.
  const m = u.match(/^(wss?:\/\/[^/]+)(\/[^?]*)?/);
  if (m) {
    const path = m[2] || '';
    if (path === '' || path === '/') {
      u = m[1] + '/ws';
    }
  }
  return u;
}

/** utf8Encode encodes a string to UTF-8 bytes without relying on Buffer/TextEncoder. */
function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff) {
      c = 0x10000 + ((c & 0x3ff) << 10) + (s.charCodeAt(++i) & 0x3ff);
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return new Uint8Array(out);
}
