/**
 * Runtime protobuf codec for the DRS signalling protocol.
 *
 * We parse the embedded .proto with protobufjs reflection (no codegen) and
 * expose:
 *   - encode/decode for SignalMessage (the only top-level wire type)
 *   - typed enum constants that mirror the proto
 *   - small helpers to build the frames the agent sends
 *
 * On the wire each WebSocket binary frame is exactly one SignalMessage, matching
 * the gateway (subprotocol "drs.signal.v1").
 */
// Full build (not /light): we need protobuf.parse(), which only the full build
// exports. The .proto is parsed at runtime, so no code generation is required.
import protobuf from 'protobufjs';
import {SIGNAL_PROTO} from './signal.proto';

const root = protobuf.parse(SIGNAL_PROTO, {keepCase: true}).root;

export const SignalMessage = root.lookupType('drs.signal.v1.SignalMessage');

/** PROTOCOL_VERSION the gateway speaks; sent in Register. */
export const PROTOCOL_VERSION = '1.1';

// Enum mirrors (numeric values match the proto).
export const Platform = {
  UNSPECIFIED: 0,
  WINDOWS: 1,
  MACOS: 2,
  LINUX: 3,
  ANDROID: 4,
  IOS: 5,
} as const;

export const ClientType = {
  UNSPECIFIED: 0,
  PORTAL: 1,
  MOBILE_PORTAL: 2,
  GUEST_WEB: 3,
  AGENT: 4,
} as const;

export const ControlMode = {
  UNSPECIFIED: 0,
  FULL: 1,
  VIEW_STEALTH: 2,
  INPUT_LOCK: 3,
  ANNOTATE: 4,
  PARALLEL: 5,
  BACKSTAGE: 6,
  CAMERA: 7,
} as const;

export const Transport = {
  UNSPECIFIED: 0,
  WEBRTC_P2P: 1,
  RELAY: 2,
  SFU: 3,
  BRIDGE: 4,
} as const;

export const MessageStatus = {
  UNSPECIFIED: 0,
  DELIVERED: 1,
  READ: 2,
  ACKNOWLEDGED: 3,
  DISMISSED: 4,
} as const;

export const CommandAckState = {
  UNSPECIFIED: 0,
  RECEIVED: 1,
  RUNNING: 2,
  REJECTED: 3,
  DUPLICATE: 4,
} as const;

export const CommandStatus = {
  UNSPECIFIED: 0,
  SUCCEEDED: 1,
  FAILED: 2,
  TIMEOUT: 3,
  CANCELLED: 4,
  EXPIRED: 5,
} as const;

/** A decoded SignalMessage, with camelCase-less (keepCase) field names. */
export type SignalMsg = {[k: string]: any};

/** nowTimestamp returns a {seconds, nanos} Timestamp for the current time. */
export function nowTimestamp(): {seconds: number; nanos: number} {
  const ms = Date.now();
  return {seconds: Math.floor(ms / 1000), nanos: (ms % 1000) * 1e6};
}

/** encode serialises a SignalMessage payload object to bytes for the wire. */
export function encode(msg: SignalMsg): Uint8Array {
  const err = SignalMessage.verify(msg);
  if (err) {
    throw new Error(`signal encode: ${err}`);
  }
  return SignalMessage.encode(SignalMessage.create(msg)).finish();
}

/** decode parses one wire frame into a SignalMessage object. */
export function decode(data: Uint8Array): SignalMsg {
  return SignalMessage.toObject(SignalMessage.decode(data), {
    longs: Number,
    enums: Number,
    bytes: Uint8Array,
    defaults: false,
    arrays: true,
    objects: true,
  });
}

/** payloadKey returns the set field name in the `payload` oneof, or null. */
export function payloadKey(msg: SignalMsg): string | null {
  const keys = [
    'register',
    'registered',
    'error',
    'token_refresh',
    'heartbeat',
    'presence_update',
    'inventory_report',
    'telemetry',
    'presence_subscribe',
    'session_offer',
    'session_answer',
    'ice_candidate',
    'transport_report',
    'participant_join',
    'participant_leave',
    'participant_role_change',
    'permission_grant',
    'consent_request',
    'consent_response',
    'rekey_request',
    'session_ended',
    'command',
    'command_ack',
    'command_result',
    'command_cancel',
    'message',
    'message_ack',
    'credential_delivery',
    'credential_delivery_ack',
  ];
  for (const k of keys) {
    if (msg[k] !== undefined && msg[k] !== null) {
      return k;
    }
  }
  return null;
}
