/**
 * Persistence.
 *
 * - Non-secret config (API base URL, ICE servers) lives in AsyncStorage.
 * - The device identity (ids, gateway URL, Ed25519 key pair) is sensitive and
 *   lives in the OS keystore via react-native-keychain. The private key never
 *   leaves the device.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import type {KeyPair} from './crypto';

const CONFIG_KEY = 'drs.config.v1';
const IDENTITY_SERVICE = 'drs.identity.v1';

export type AppConfig = {
  /** REST API base, e.g. http://10.0.2.2:8080 (no trailing slash). */
  apiBaseUrl: string;
  /** Optional gateway WS override; normally taken from enroll/token responses. */
  gatewayUrlOverride?: string;
  /** ICE servers for the agent's peer connections. */
  iceServers: {urls: string[]; username?: string; credential?: string}[];
  /** Force relay (TURN only) candidates. */
  forceRelay: boolean;
  /** Unattended devices answer sessions without prompting the end user. */
  autoAcceptConsent: boolean;
};

export const DEFAULT_CONFIG: AppConfig = {
  // Deployed backend. For local dev use http://10.0.2.2:8080 (Android emulator).
  apiBaseUrl: 'https://api.2-25-114-216.nip.io',
  iceServers: [{urls: ['stun:stun.l.google.com:19302']}],
  forceRelay: false,
  autoAcceptConsent: true,
};

export type Identity = {
  deviceId: string;
  tenantId: string;
  gatewayUrl: string;
  deviceUuid: string;
  keyPair: KeyPair;
};

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await AsyncStorage.getItem(CONFIG_KEY);
    if (!raw) {
      return {...DEFAULT_CONFIG};
    }
    return {...DEFAULT_CONFIG, ...JSON.parse(raw)};
  } catch {
    return {...DEFAULT_CONFIG};
  }
}

export async function saveConfig(cfg: AppConfig): Promise<void> {
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

export async function loadIdentity(): Promise<Identity | null> {
  try {
    const creds = await Keychain.getGenericPassword({service: IDENTITY_SERVICE});
    if (!creds) {
      return null;
    }
    return JSON.parse(creds.password) as Identity;
  } catch {
    return null;
  }
}

export async function saveIdentity(id: Identity): Promise<void> {
  await Keychain.setGenericPassword('device', JSON.stringify(id), {
    service: IDENTITY_SERVICE,
  });
}

export async function clearIdentity(): Promise<void> {
  await Keychain.resetGenericPassword({service: IDENTITY_SERVICE});
}
