/**
 * Bridge to the native Android DeviceDataModule: persist a file the operator
 * pushed (over the WebRTC control channel) into Downloads, and show a local
 * notification for operator messages / delivered files.
 *
 * Android-only; on iOS the module is absent and both methods are safe no-ops.
 */
import {NativeModules} from 'react-native';

type DeviceDataNative = {
  saveToDownloads(name: string, base64: string, mime: string): Promise<string>;
  notify(title: string, body: string): Promise<boolean>;
};

const Native = (NativeModules.DeviceDataModule || null) as DeviceDataNative | null;

export const DeviceData = {
  available(): boolean {
    return Native != null;
  },
  saveToDownloads(name: string, base64: string, mime: string): Promise<string> {
    return Native
      ? Native.saveToDownloads(name, base64, mime)
      : Promise.reject(new Error('file save unavailable on this platform'));
  },
  notify(title: string, body: string): Promise<boolean> {
    return Native ? Native.notify(title, body) : Promise.resolve(false);
  },
};
