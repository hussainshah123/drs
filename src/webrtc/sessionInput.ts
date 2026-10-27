/**
 * Translates drs.session.v1 InputEvents (the viewer's mouse/keyboard, binary
 * protobuf) into Android AccessibilityService gestures. Coordinates are
 * normalized [0,1] over the streamed display, which the native layer scales
 * to the screen.
 *
 * Mouse-down starts a LIVE touch (RemoteControl.touchDown/Move/Up, API 26+):
 * the phone tracks the operator's mouse in real time, the same way a finger
 * would, instead of waiting for mouse-up and then replaying the whole
 * gesture at once — that record-then-replay shape is what made dragging and
 * scrolling feel delayed. On a pre-API-26 device (or if touchDown ever fails)
 * this falls back to the old behaviour: record the path, then fire a single
 * tap/long-press/swipe on release.
 *
 * State is per participant (peer) so concurrent viewers do not interfere at
 * this layer — the phone's one physical touchscreen is still shared, same as
 * before.
 */
import {RemoteControl} from '../native/remoteControl';
import {Button, type SessionMsg} from '../proto/session';
import {log} from '../core/log';

type Down = {
  x: number;
  y: number;
  t: number;
  lastX: number;
  lastY: number;
  live: boolean;
};
const downs = new Map<number, Down>();

// A few USB HID usages (page 0x07) mapped to Android global actions.
const HID_TO_ACTION: Record<number, string> = {
  0x29: 'GLOBAL_ACTION_BACK', // Escape
  0x4a: 'GLOBAL_ACTION_HOME', // Home key
};

function clamp01(n: unknown): number {
  const v = typeof n === 'number' ? n : 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** applyInputEvent applies one decoded InputEvent for participant pid. */
export async function applyInputEvent(pid: number, input: SessionMsg): Promise<void> {
  try {
    if (input.pointer_button) {
      await pointerButton(pid, input.pointer_button);
    } else if (input.pointer_move) {
      const x = clamp01(input.pointer_move.x);
      const y = clamp01(input.pointer_move.y);
      const d = downs.get(pid);
      if (d) {
        d.lastX = x;
        d.lastY = y;
        if (d.live) {
          // Real-time: the touch tracks the mouse as it moves, not after.
          await RemoteControl.touchMove(x, y);
        }
      }
    } else if (input.key) {
      const k = input.key;
      const action = HID_TO_ACTION[Number(k.hid_usage)];
      if (action && k.down) {
        await RemoteControl.globalAction(action);
      }
    }
  } catch (e: any) {
    log.warn('input', `session input failed: ${e?.message || e}`);
  }
}

async function pointerButton(pid: number, b: SessionMsg): Promise<void> {
  const x = clamp01(b.x);
  const y = clamp01(b.y);
  const button = Number(b.button);
  if (button === Button.LEFT) {
    if (b.down) {
      const live = await RemoteControl.touchDown(x, y);
      downs.set(pid, {x, y, t: Date.now(), lastX: x, lastY: y, live});
      return;
    }
    const d = downs.get(pid);
    downs.delete(pid);
    if (d?.live) {
      // Already tracked live the whole way — just lift the finger.
      await RemoteControl.touchUp(d.lastX, d.lastY);
      return;
    }
    // Fallback path (pre-API 26, or touchDown failed): replay once on release.
    const fromX = d ? d.x : x;
    const fromY = d ? d.y : y;
    const toX = d ? d.lastX : x;
    const toY = d ? d.lastY : y;
    const held = d ? Date.now() - d.t : 0;
    const dist = Math.hypot(toX - fromX, toY - fromY);
    if (dist < 0.02 && held < 400) {
      await RemoteControl.tap(fromX, fromY);
    } else if (dist < 0.02) {
      await RemoteControl.longPress(fromX, fromY, Math.min(held, 2000));
    } else {
      await RemoteControl.swipe(fromX, fromY, toX, toY, Math.max(80, Math.min(held, 1500)));
    }
  } else if (button === Button.RIGHT && !b.down) {
    // Right-click → Back, a natural Android mapping.
    await RemoteControl.globalAction('GLOBAL_ACTION_BACK');
  }
}

/** forget clears any in-flight gesture state for a participant that left. */
export function forgetInput(pid: number): void {
  const d = downs.get(pid);
  downs.delete(pid);
  if (d?.live) {
    void RemoteControl.touchCancel();
  }
}
