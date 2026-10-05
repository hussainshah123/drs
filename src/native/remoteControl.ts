/**
 * Bridge to the native Android remote-control module, which injects input via an
 * AccessibilityService (DrsAccessibilityService). Coordinates are normalized
 * (0..1) so the operator does not need the device resolution; the native side
 * scales them to the real display.
 *
 * All methods are no-ops / rejected when the AccessibilityService is not enabled;
 * the UI guides the user to enable it.
 */
import {NativeModules} from 'react-native';

type RemoteControlNative = {
  isAccessibilityEnabled(): Promise<boolean>;
  openAccessibilitySettings(): Promise<void>;
  getScreenMetrics(): Promise<{width: number; height: number; density: number}>;
  tap(x: number, y: number): Promise<boolean>;
  longPress(x: number, y: number, durationMs: number): Promise<boolean>;
  swipe(x1: number, y1: number, x2: number, y2: number, durationMs: number): Promise<boolean>;
  globalAction(action: string): Promise<boolean>;
  inputText(text: string): Promise<boolean>;
};

const Native = (NativeModules.RemoteControlModule || null) as RemoteControlNative | null;

export const RemoteControl = {
  available(): boolean {
    return Native != null;
  },
  async isAccessibilityEnabled(): Promise<boolean> {
    if (!Native) {
      return false;
    }
    try {
      return await Native.isAccessibilityEnabled();
    } catch {
      return false;
    }
  },
  openAccessibilitySettings(): Promise<void> {
    return Native ? Native.openAccessibilitySettings() : Promise.resolve();
  },
  getScreenMetrics() {
    return Native
      ? Native.getScreenMetrics()
      : Promise.resolve({width: 0, height: 0, density: 1});
  },
  tap(x: number, y: number) {
    return Native ? Native.tap(x, y) : Promise.resolve(false);
  },
  longPress(x: number, y: number, durationMs: number) {
    return Native ? Native.longPress(x, y, durationMs) : Promise.resolve(false);
  },
  swipe(x1: number, y1: number, x2: number, y2: number, durationMs: number) {
    return Native ? Native.swipe(x1, y1, x2, y2, durationMs) : Promise.resolve(false);
  },
  globalAction(action: string) {
    return Native ? Native.globalAction(action) : Promise.resolve(false);
  },
  inputText(text: string) {
    return Native ? Native.inputText(text) : Promise.resolve(false);
  },
};
