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
 *   {"t":"clipboard_set","text":"hello"}     // write operator clipboard to device
 *   {"t":"clipboard_get"}                    // device replies {"t":"clipboard","text":..}
 *
 * File push (operator -> device), chunked over the same channel. `data` is a
 * slice of the whole file's base64 string; concatenating the slices in order
 * reproduces that base64, which the device decodes and saves to Downloads:
 *   {"t":"file_begin","id":"f1","name":"a.pdf","mime":"application/pdf","size":1234}
 *   {"t":"file_chunk","id":"f1","data":"<base64-slice>"}
 *   {"t":"file_end","id":"f1"}               // device replies {"t":"file_saved",id,path} | {"t":"file_error",id,error}
 *
 * A handler may produce a reply for the operator (e.g. clipboard contents, a
 * file-saved ack); it is delivered through the optional `reply` callback, which
 * the controller wires to the peer's control channel.
 */
import {RemoteControl} from '../native/remoteControl';
import {Clipboard} from '../native/clipboard';
import {DeviceData} from '../native/deviceData';
import {log} from '../core/log';

type Reply = (data: string) => void;

/** In-flight operator->device file transfers, keyed by transfer id. */
type Incoming = {name: string; mime: string; size: number; b64: string};
const incoming = new Map<string, Incoming>();
const MAX_FILE_BYTES = 64 * 1024 * 1024; // cap reassembly at 64 MiB

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

export async function handleControlMessage(raw: string, reply?: Reply): Promise<void> {
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
      case 'clipboard_set':
        if (typeof ev.text === 'string') {
          await Clipboard.setText(ev.text);
        }
        break;
      case 'clipboard_get': {
        const text = await Clipboard.getText();
        reply?.(JSON.stringify({t: 'clipboard', text}));
        break;
      }
      case 'file_begin': {
        const id = String(ev.id || '');
        if (id) {
          incoming.set(id, {
            name: String(ev.name || 'drs-file'),
            mime: String(ev.mime || 'application/octet-stream'),
            size: Number(ev.size) || 0,
            b64: '',
          });
        }
        break;
      }
      case 'file_chunk': {
        const f = incoming.get(String(ev.id || ''));
        if (f && typeof ev.data === 'string') {
          f.b64 += ev.data;
          // Rough guard: base64 is ~4/3 of bytes; drop runaway transfers.
          if (f.b64.length > MAX_FILE_BYTES * 1.4) {
            incoming.delete(String(ev.id));
            reply?.(JSON.stringify({t: 'file_error', id: ev.id, error: 'file too large'}));
          }
        }
        break;
      }
      case 'file_end': {
        const id = String(ev.id || '');
        const f = incoming.get(id);
        incoming.delete(id);
        if (!f) {
          reply?.(JSON.stringify({t: 'file_error', id, error: 'unknown transfer'}));
          break;
        }
        try {
          const path = await DeviceData.saveToDownloads(f.name, f.b64, f.mime);
          await DeviceData.notify('File received', `${f.name} saved to Downloads`);
          reply?.(JSON.stringify({t: 'file_saved', id, path}));
          log.info('input', `file saved: ${f.name} -> ${path}`);
        } catch (e: any) {
          reply?.(JSON.stringify({t: 'file_error', id, error: e?.message || String(e)}));
          log.warn('input', `file save failed: ${e?.message || e}`);
        }
        break;
      }
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
