/**
 * Permission model.
 *
 * The agent needs several kinds of access. Some are normal runtime permissions
 * we can request at launch (notifications on Android 13+). Two are deliberate
 * OS security gates that CANNOT be auto-granted and must be turned on by the
 * device owner in system settings — Android MediaProjection (screen capture,
 * prompted per session) and the AccessibilityService (remote control). On iOS,
 * screen capture is a ReplayKit broadcast the user starts from the system
 * picker, and third-party input injection is not permitted at all.
 *
 * This module reports readiness so the UI can walk the owner through enabling
 * everything once.
 */
import {PermissionsAndroid, Platform} from 'react-native';
import {RemoteControl} from '../native/remoteControl';
import {log} from './log';

export type PermissionState = {
  notifications: boolean;
  /** Android AccessibilityService for remote control (Android only). */
  remoteControl: boolean;
  /** Whether this platform can inject remote input at all. */
  remoteControlSupported: boolean;
};

/** requestStartupPermissions asks for every runtime permission we can, at launch. */
export async function requestStartupPermissions(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  try {
    const toRequest: string[] = [];
    // POST_NOTIFICATIONS is required on Android 13+ for the screen-share
    // foreground-service notification.
    if (Number(Platform.Version) >= 33) {
      toRequest.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }
    if (toRequest.length > 0) {
      const res = await PermissionsAndroid.requestMultiple(toRequest as any);
      log.info('perm', `runtime permissions: ${JSON.stringify(res)}`);
    }
  } catch (e: any) {
    log.warn('perm', `request failed: ${e?.message || e}`);
  }
}

export async function checkNotifications(): Promise<boolean> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) {
    return true;
  }
  try {
    return await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS as any,
    );
  } catch {
    return false;
  }
}

export async function getPermissionState(): Promise<PermissionState> {
  const remoteControlSupported = Platform.OS === 'android' && RemoteControl.available();
  const [notifications, remoteControl] = await Promise.all([
    checkNotifications(),
    remoteControlSupported ? RemoteControl.isAccessibilityEnabled() : Promise.resolve(false),
  ]);
  return {notifications, remoteControl, remoteControlSupported};
}
