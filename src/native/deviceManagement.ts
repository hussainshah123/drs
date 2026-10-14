/**
 * Bridge to the native Android DeviceManagementModule (DevicePolicyManager / DPC).
 *
 * This is the mobile parallel of the Windows agent's management operations. The
 * powerful operations (reboot, wipe) only succeed when the app is the active
 * Device Owner — which requires enterprise provisioning. Every method degrades
 * gracefully (resolves false / rejects) when the app is not admin/owner so the
 * command handler can report the correct status.
 *
 * Android-only: on iOS there is no equivalent third-party management surface, so
 * the native module is absent and every method is a safe no-op.
 */
import {NativeModules, Platform} from 'react-native';

type DeviceManagementNative = {
  getStatus(): Promise<{adminActive: boolean; deviceOwner: boolean}>;
  openDeviceAdminSettings(): Promise<void>;
  lockNow(): Promise<boolean>;
  reboot(): Promise<boolean>;
  wipeDevice(external: boolean): Promise<boolean>;
  setCameraDisabled(disabled: boolean): Promise<boolean>;
  grantRuntimePermissions(): Promise<number>;
  setLauncherIconHidden(hidden: boolean): Promise<boolean>;
  setUninstallBlocked(blocked: boolean): Promise<boolean>;
  setUserControlDisabled(disabled: boolean): Promise<boolean>;
  applyManagedAgentPolicy(hideIcon: boolean): Promise<ManagedPolicyResult>;
  startAgentService(): Promise<boolean>;
  stopAgentService(): Promise<boolean>;
  launchAgentActivity(): Promise<boolean>;
};

export type ManagedPolicyResult = {
  deviceOwner: boolean;
  uninstallBlocked?: boolean;
  forceStopDisabled?: boolean;
  iconHidden?: boolean;
};

const Native = (NativeModules.DeviceManagementModule || null) as DeviceManagementNative | null;

export type DeviceOwnerStatus = {adminActive: boolean; deviceOwner: boolean};

export const DeviceManagement = {
  available(): boolean {
    return Platform.OS === 'android' && Native != null;
  },
  async getStatus(): Promise<DeviceOwnerStatus> {
    if (!Native) {
      return {adminActive: false, deviceOwner: false};
    }
    try {
      return await Native.getStatus();
    } catch {
      return {adminActive: false, deviceOwner: false};
    }
  },
  openDeviceAdminSettings(): Promise<void> {
    return Native ? Native.openDeviceAdminSettings() : Promise.resolve();
  },
  lockNow(): Promise<boolean> {
    return Native ? Native.lockNow() : Promise.resolve(false);
  },
  reboot(): Promise<boolean> {
    return Native ? Native.reboot() : Promise.reject(new Error('device management unavailable'));
  },
  wipeDevice(external: boolean): Promise<boolean> {
    return Native
      ? Native.wipeDevice(external)
      : Promise.reject(new Error('device management unavailable'));
  },
  setCameraDisabled(disabled: boolean): Promise<boolean> {
    return Native ? Native.setCameraDisabled(disabled) : Promise.resolve(false);
  },
  /**
   * Silently grants the app's own runtime permissions when it is Device Owner
   * (camera, mic, location, notifications…). Resolves the count granted, or 0 on
   * a device where the app is not owner (the normal prompts then apply).
   */
  grantRuntimePermissions(): Promise<number> {
    return Native ? Native.grantRuntimePermissions() : Promise.resolve(0);
  },
  /** Hides/shows the launcher icon (disables the launcher alias). */
  setLauncherIconHidden(hidden: boolean): Promise<boolean> {
    return Native ? Native.setLauncherIconHidden(hidden) : Promise.resolve(false);
  },
  /** Blocks the user uninstalling the app (Device Owner only). */
  setUninstallBlocked(blocked: boolean): Promise<boolean> {
    return Native ? Native.setUninstallBlocked(blocked) : Promise.resolve(false);
  },
  /** Stops the user force-stopping the app (Device Owner, Android 11+). */
  setUserControlDisabled(disabled: boolean): Promise<boolean> {
    return Native ? Native.setUserControlDisabled(disabled) : Promise.resolve(false);
  },
  /**
   * Applies the full managed-agent profile at once (block uninstall, disable
   * force-stop, optionally hide the launcher icon). No-op fields on non-owner
   * devices. Returns what was actually applied.
   */
  applyManagedAgentPolicy(hideIcon: boolean): Promise<ManagedPolicyResult> {
    return Native
      ? Native.applyManagedAgentPolicy(hideIcon)
      : Promise.resolve({deviceOwner: false});
  },
  /** Starts the background keep-alive foreground service (device stays online). */
  startAgentService(): Promise<boolean> {
    return Native ? Native.startAgentService() : Promise.resolve(false);
  },
  /** Stops the background keep-alive service. */
  stopAgentService(): Promise<boolean> {
    return Native ? Native.stopAgentService() : Promise.resolve(false);
  },
  /**
   * Brings the agent's Activity to the foreground. Needed before screen capture
   * on a hidden/background agent — MediaProjection requires a resumed Activity.
   */
  launchAgentActivity(): Promise<boolean> {
    return Native ? Native.launchAgentActivity() : Promise.resolve(false);
  },
};
