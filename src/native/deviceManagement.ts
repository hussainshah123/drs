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
};
