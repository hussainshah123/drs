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
import type { KeyPair } from './crypto';

const CONFIG_KEY = 'drs.config.v1';
const IDENTITY_SERVICE = 'drs.identity.v1';

export type AppConfig = {
  /** REST API base, e.g. http://10.0.2.2:8080 (no trailing slash). */
  apiBaseUrl: string;
  /** Optional gateway WS override; normally taken from enroll/token responses. */
  gatewayUrlOverride?: string;
  /** ICE servers for the agent's peer connections. */
  iceServers: { urls: string[]; username?: string; credential?: string }[];
  /** Force relay (TURN only) candidates. */
  forceRelay: boolean;
  /**
   * Requested MediaProjection screen-capture frame rate (Android only), via the
   * patched react-native-webrtc (patches/react-native-webrtc+*.patch — upstream
   * hardcodes 30). Clamped natively to [1, 60]; also applied as the outbound
   * RTP sender's maxFramerate with degradationPreference "maintain-framerate"
   * (src/webrtc/peer.ts) so the encoder drops resolution before frame rate
   * under load, instead of the reverse.
   *
   * Kept at the stock 30 by default: the outbound screen codec is forced to
   * software VP8 (see peer.ts preferVp8), and pushing both fps and bitrate up
   * together (tried at 60fps/8Mbps) overloaded the phone's CPU badly enough to
   * starve WebRTC's own connection keepalives — the session dropped and
   * reconnected in a loop, which is what showed up as "unavailable" on the
   * viewer. captureResolutionScale is the safer lever: it cuts per-frame
   * encode cost directly, so raise fps only after lowering resolution, and
   * only in small steps while watching for reconnects.
   */
  captureFps: number;
  /**
   * Scales MediaProjection's captured width/height before encoding (Android
   * only; native "resolutionScale" constraint, clamped to [0, 1] in
   * react-native-webrtc). 1 = device-native resolution. Lowering this reduces
   * encode cost roughly with the square of the scale.
   *
   * 0.85 (≈72% of the pixels) trades some of the earlier, very conservative
   * safety margin (0.6 ≈ 36%) for sharpness, now that peer.ts's adaptive
   * controller (qualityLimitationReason + packet-loss driven) can pull this
   * back down live if a specific device/network genuinely can't sustain it —
   * static tuning alone was trading pixelation for stability with no way to
   * have both; the live controller is what lets this default sit higher.
   * It also still starts one step below this (scaleResolutionDownBy, see
   * peer.ts) and only relaxes to the full value once proven stable.
   */
  captureResolutionScale: number;
  /** Unattended devices answer sessions without prompting the end user. */
  autoAcceptConsent: boolean;
  /**
   * Keep the screen capture alive between sessions so the operator can
   * reconnect without the device re-showing the system capture prompt, on
   * devices/OS versions where that's possible. On Android 14+ this does NOT
   * prevent the per-session prompt: the OS enforces a single-use
   * MediaProjection grant there regardless of app behavior (platform policy,
   * not a bug this app can work around) — the device owner will see one tap
   * per new session no matter what this setting is set to. On iOS, the user
   * must start ReplayKit and restart it if it ends. Turning this off reverts
   * to prompting per session on the platforms where it would otherwise help.
   */
  autoShareScreen: boolean;
  /**
   * On a Device Owner (MDM) install, apply the managed-agent profile at launch:
   * block uninstall, disable force-stop, and hide the launcher icon so the agent
   * runs invisibly. Ignored on non-owner devices. Hiding the icon only takes
   * effect when this is true AND the app is Device Owner.
   */
  managedHideIcon: boolean;
};

/**
 * Baked-in enrollment token for this Android build. The admin pre-provisions the
 * token so the agent can enroll itself on first launch without the end user
 * pasting anything (see EnrollScreen auto-enroll). Empty string = no default.
 * iOS builds leave this empty; the iOS token is entered by hand.
 */
export const DEFAULT_ENROLLMENT_TOKEN = 'drs_enr_PYV3WOJGPPBNMDBQ5S6JLITSS6';

export const DEFAULT_CONFIG: AppConfig = {
  // Deployed backend. For local dev use http://10.0.2.2:8080 (Android emulator).
  apiBaseUrl: 'https://api.2-25-114-216.nip.io',
  iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
  forceRelay: false,
  captureFps: 30,
  captureResolutionScale: 0.85,
  autoAcceptConsent: true,
  autoShareScreen: true,
  managedHideIcon: true,
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
      return { ...DEFAULT_CONFIG };
    }
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(cfg: AppConfig): Promise<void> {
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

export async function loadIdentity(): Promise<Identity | null> {
  try {
    const creds = await Keychain.getGenericPassword({
      service: IDENTITY_SERVICE,
    });
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
  await Keychain.resetGenericPassword({ service: IDENTITY_SERVICE });
}
