/**
 * Device identity crypto.
 *
 * The agent proves its identity to the API with an Ed25519 key pair generated
 * at enrollment (docs/flow.md §3). The 32-byte public key is registered with
 * POST /agent/enroll; every 15 minutes the agent signs a server nonce with the
 * private key to obtain a fresh device JWT (GET/POST /agent/token).
 *
 * tweetnacl's sign primitive is Ed25519, wire-compatible with Go's crypto/ed25519.
 * `react-native-get-random-values` must be imported once at app start so
 * nacl.randomBytes has a secure CSPRNG.
 */
import nacl from 'tweetnacl';
import {encodeBase64, decodeBase64, decodeUTF8} from 'tweetnacl-util';

export type KeyPair = {
  /** base64 of the 32-byte Ed25519 public key (sent at enroll). */
  publicKey: string;
  /** base64 of the 64-byte tweetnacl secret key (kept in the keystore). */
  secretKey: string;
};

/** generateKeyPair creates a fresh Ed25519 identity. */
export function generateKeyPair(): KeyPair {
  const kp = nacl.sign.keyPair();
  return {
    publicKey: encodeBase64(kp.publicKey),
    secretKey: encodeBase64(kp.secretKey),
  };
}

/**
 * signNonce signs the UTF-8 bytes of a challenge nonce and returns the
 * detached signature as base64, matching ed25519.Sign([]byte(nonce)) on the API.
 */
export function signNonce(nonce: string, secretKeyB64: string): string {
  const secret = decodeBase64(secretKeyB64);
  const sig = nacl.sign.detached(decodeUTF8(nonce), secret);
  return encodeBase64(sig);
}

/** randomUUID returns a RFC-4122 v4 UUID from the secure RNG. */
export function randomUUID(): string {
  const b = nacl.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}

export {encodeBase64, decodeBase64};
