/**
 * Enrollment: turn an enrollment token into a persisted device identity.
 *
 * Generates the Ed25519 key pair, registers the public key with POST
 * /agent/enroll, and stores {device_id, tenant_id, gateway_url, key pair} in the
 * keystore. After this the agent can fetch device JWTs and connect the gateway
 * (docs/flow.md §3).
 */
import {Platform} from 'react-native';
import {Api} from './api';
import {generateKeyPair, randomUUID} from './crypto';
import {AGENT_VERSION, defaultHostname, osVersion} from './deviceInfo';
import {log} from './log';
import {saveIdentity, type AppConfig, type Identity} from './storage';

export async function enrollDevice(
  config: AppConfig,
  enrollmentToken: string,
): Promise<Identity> {
  const api = new Api(config.apiBaseUrl);
  const keyPair = generateKeyPair();
  const deviceUuid = randomUUID();

  log.info('enroll', `enrolling device ${deviceUuid}`);
  const res = await api.enroll({
    enrollment_token: enrollmentToken.trim(),
    device_uuid: deviceUuid,
    public_key: keyPair.publicKey,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    hostname: defaultHostname(),
    os_version: osVersion(),
    agent_version: AGENT_VERSION,
    enrollment: 'unattended',
  });

  const identity: Identity = {
    deviceId: res.device_id,
    tenantId: res.tenant_id,
    gatewayUrl: res.gateway_url,
    deviceUuid,
    keyPair,
  };
  await saveIdentity(identity);
  log.info('enroll', `enrolled as device ${res.device_id} (tenant ${res.tenant_id})`);
  return identity;
}
