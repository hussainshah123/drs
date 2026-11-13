/**
 * Long-press "copy message". Android writes through the native
 * ClipboardModule (the app is in the foreground, so the write is allowed)
 * and confirms with a toast. iOS has no clipboard module here, so message
 * text is `selectable` there instead and the system's own Copy menu is used.
 */
import {Platform, ToastAndroid} from 'react-native';
import {Clipboard} from '../native/clipboard';
import {log} from '../core/log';

/** iOS: let the Text itself be selected; Android: copy on long press instead. */
export const SELECTABLE_TEXT = Platform.OS === 'ios';

export async function copyMessage(text: string): Promise<void> {
  if (Platform.OS !== 'android' || !text) {
    return;
  }
  let ok = false;
  try {
    ok = await Clipboard.setText(text);
  } catch (e: any) {
    log.warn('copy', `clipboard write failed: ${e?.message || e}`);
  }
  ToastAndroid.show(ok ? 'Message copied' : 'Could not copy the message', ToastAndroid.SHORT);
}
