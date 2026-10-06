/**
 * Bridge to the native Android ClipboardModule for operator <-> device clipboard
 * sync over the control channel.
 *
 * Both operations are best-effort: Android 10+ blocks clipboard reads from the
 * background, so getText may return "" while the app is not focused. Writes are
 * usually allowed. On iOS the native module is absent and both are no-ops.
 */
import {NativeModules} from 'react-native';

type ClipboardNative = {
  setText(text: string): Promise<boolean>;
  getText(): Promise<string>;
};

const Native = (NativeModules.ClipboardModule || null) as ClipboardNative | null;

export const Clipboard = {
  available(): boolean {
    return Native != null;
  },
  setText(text: string): Promise<boolean> {
    return Native ? Native.setText(text) : Promise.resolve(false);
  },
  getText(): Promise<string> {
    return Native ? Native.getText() : Promise.resolve('');
  },
};
