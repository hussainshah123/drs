/**
 * Device JWT provider.
 *
 * Mirrors fakeagent's ChallengeToken: GET /agent/token for a nonce, sign it
 * with the device key, POST it back for a 15-minute JWT. Used to connect the
 * gateway and to refresh before expiry (SignalMessage.TokenRefresh).
 */
import {Api} from './api';
import {signNonce} from './crypto';
import type {Identity} from './storage';

export type DeviceToken = {
  token: string;
  expiresAt: number; // epoch ms
  gatewayUrl: string;
};

export function makeTokenProvider(
  api: Api,
  identity: Identity,
): () => Promise<DeviceToken> {
  return async () => {
    const ch = await api.challenge(identity.deviceId);
    const sig = signNonce(ch.nonce, identity.keyPair.secretKey);
    const res = await api.token(identity.deviceId, ch.nonce, sig);
    return {
      token: res.token,
      expiresAt: Date.now() + res.expires_in * 1000,
      gatewayUrl: res.gateway_url || identity.gatewayUrl,
    };
  };
}
