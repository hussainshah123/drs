/**
 * Remote-input protocol over the WebRTC "control" data channel.
 *
 * The operator/desktop sends newline-free JSON messages with normalized
 * coordinates (0..1). The agent translates them into AccessibilityService
 * gestures via the native RemoteControl bridge. Input is only applied when the
 * participant's grant includes remote control (enforced by the controller, which
 * gates whether the handler runs at all).
 *
 * Event shapes:
 *   {"t":"tap","x":0.5,"y":0.5}
 *   {"t":"long","x":0.5,"y":0.5,"ms":600}
 *   {"t":"swipe","x1":..,"y1":..,"x2":..,"y2":..,"ms":250}
 *   {"t":"key","k":"back|home|recents|notifications|quick_settings|lock_screen|power_dialog"}
 *   {"t":"text","text":"hello"}
 */
import {RemoteControl} from '../native/remoteControl';
import {log} from '../core/log';

const KEY_TO_ACTION: Record<string, string> = {
  back: 'GLOBAL_ACTION_BACK',
  home: 'GLOBAL_ACTION_HOME',
  recents: 'GLOBAL_ACTION_RECENTS',
  notifications: 'GLOBAL_ACTION_NOTIFICATIONS',
  quick_settings: 'GLOBAL_ACTION_QUICK_SETTINGS',
  lock_screen: 'GLOBAL_ACTION_LOCK_SCREEN',
  power_dialog: 'GLOBAL_ACTION_POWER_DIALOG',
};

function clamp01(n: unknown): number {
  const v = typeof n === 'number' ? n : 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export async function handleControlMessage(raw: string): Promise<void> {
  let ev: any;
  try {
    ev = JSON.parse(raw);
  } catch {
    return;
  }
  if (!ev || typeof ev.t !== 'string') {
    return;
  }
  try {
    switch (ev.t) {
      case 'tap':
        await RemoteControl.tap(clamp01(ev.x), clamp01(ev.y));
        break;
      case 'long':
        await RemoteControl.longPress(clamp01(ev.x), clamp01(ev.y), clampMs(ev.ms, 600));
        break;
      case 'swipe':
        await RemoteControl.swipe(
          clamp01(ev.x1),
          clamp01(ev.y1),
          clamp01(ev.x2),
          clamp01(ev.y2),
          clampMs(ev.ms, 250),
        );
        break;
      case 'key': {
        const action = KEY_TO_ACTION[String(ev.k)];
        if (action) {
          await RemoteControl.globalAction(action);
        }
        break;
      }
      case 'text':
        if (typeof ev.text === 'string') {
          await RemoteControl.inputText(ev.text);
        }
        break;
      default:
        break;
    }
  } catch (e: any) {
    log.warn('input', `apply failed: ${e?.message || e}`);
  }
}

function clampMs(ms: unknown, def: number): number {
  const v = typeof ms === 'number' ? ms : def;
  return Math.max(20, Math.min(10000, v));
}
