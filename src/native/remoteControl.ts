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
  supportsHardwareH264(width: number, height: number): Promise<boolean>;
  tap(x: number, y: number): Promise<boolean>;
  longPress(x: number, y: number, durationMs: number): Promise<boolean>;
  swipe(x1: number, y1: number, x2: number, y2: number, durationMs: number): Promise<boolean>;
  touchDown(x: number, y: number): Promise<boolean>;
  touchMove(x: number, y: number): Promise<boolean>;
  touchUp(x: number, y: number): Promise<boolean>;
  touchCancel(): Promise<void>;
  globalAction(action: string): Promise<boolean>;
  inputText(text: string): Promise<boolean>;
  setLocalInputBlocked(blocked: boolean): Promise<boolean>;
  armCaptureConsentAutoAccept(): Promise<boolean>;
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
  /**
   * Per-device check: does this phone's real hardware H.264 encoder actually
   * support encoding at this exact size? Uses the OS's own
   * MediaCodecInfo.VideoCapabilities.isSizeSupported() — no frame is encoded,
   * nothing is captured. Defaults to false (the safe, universal fallback is
   * software VP8) when the native module is unavailable or the check itself
   * fails for any reason.
   */
  async supportsHardwareH264(width: number, height: number): Promise<boolean> {
    if (!Native || width <= 0 || height <= 0) {
      return false;
    }
    try {
      return await Native.supportsHardwareH264(Math.round(width), Math.round(height));
    } catch {
      return false;
    }
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
  /**
   * Live touch tracking (API 26+ on the device): the mouse's actual down,
   * move and up events are injected as one continuous real touch, so a drag
   * or scroll tracks the operator's mouse as it happens — not replayed only
   * after the mouse is released. Each resolves false on pre-API-26 devices
   * or any failure; sessionInput.ts falls back to tap/swipe in that case.
   */
  touchDown(x: number, y: number) {
    return Native ? Native.touchDown(x, y) : Promise.resolve(false);
  },
  touchMove(x: number, y: number) {
    return Native ? Native.touchMove(x, y) : Promise.resolve(false);
  },
  touchUp(x: number, y: number) {
    return Native ? Native.touchUp(x, y) : Promise.resolve(false);
  },
  touchCancel() {
    return Native ? Native.touchCancel() : Promise.resolve();
  },
  globalAction(action: string) {
    return Native ? Native.globalAction(action) : Promise.resolve(false);
  },
  inputText(text: string) {
    return Native ? Native.inputText(text) : Promise.resolve(false);
  },
  setLocalInputBlocked(blocked: boolean) {
    return Native ? Native.setLocalInputBlocked(blocked) : Promise.resolve(false);
  },
  /**
   * Arms a short window (see DrsAccessibilityService.armCaptureConsentAutoAccept)
   * in which the accessibility service auto-taps Android's own screen-capture
   * system dialog. Call immediately before getDisplayMedia() — resolves false
   * only when the accessibility service isn't running, in which case the
   * system dialog still appears and needs a manual tap, same as before this.
   */
  armCaptureConsentAutoAccept() {
    return Native ? Native.armCaptureConsentAutoAccept() : Promise.resolve(false);
  },
};
