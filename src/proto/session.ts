/**
 * Runtime protobuf codec for the in-session protocol (drs.session.v1). Parses the
 * embedded .proto with protobufjs reflection and exposes encode/decode for
 * SessionMessage plus small enum mirrors and a body-field helper.
 */
import protobuf from 'protobufjs';
import {SESSION_PROTO} from './session.proto';

const root = protobuf.parse(SESSION_PROTO, {keepCase: true}).root;

export const SessionMessage = root.lookupType('drs.session.v1.SessionMessage');

export const Button = {
  UNSPECIFIED: 0,
  LEFT: 1,
  RIGHT: 2,
  MIDDLE: 3,
  BACK: 4,
  FORWARD: 5,
} as const;

export type SessionMsg = {[k: string]: any};

/** encode serialises a SessionMessage object to bytes for a data channel. */
export function encodeSession(msg: SessionMsg): Uint8Array {
  const err = SessionMessage.verify(msg);
  if (err) {
    throw new Error(`session encode: ${err}`);
  }
  return SessionMessage.encode(SessionMessage.create(msg)).finish();
}

/** decode parses one data-channel frame into a SessionMessage object. */
export function decodeSession(data: Uint8Array): SessionMsg {
  return SessionMessage.toObject(SessionMessage.decode(data), {
    longs: Number,
    enums: Number,
    bytes: Uint8Array,
    defaults: false,
    arrays: true,
    objects: true,
  });
}

/** bodyKey returns the set field name in the `body` oneof, or null. */
export function bodyKey(msg: SessionMsg): string | null {
  const keys = [
    'agent_hello',
    'display_layout',
    'cursor',
    'cursor_shape',
    'stats',
    'notice',
    'permissions',
    'input',
    'control',
  ];
  for (const k of keys) {
    if (msg[k] !== undefined && msg[k] !== null) {
      return k;
    }
  }
  return null;
}
