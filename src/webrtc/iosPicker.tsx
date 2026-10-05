/**
 * iOS ReplayKit broadcast picker.
 *
 * On iOS, whole-device screen capture runs in a Broadcast Upload Extension that
 * the user starts from the system picker (RPSystemBroadcastPickerView). We
 * render react-native-webrtc's ScreenCapturePickerView once (hidden) and expose
 * showBroadcastPicker() so the capture flow can present it. getDisplayMedia()
 * then resolves when the extension begins delivering frames.
 *
 * On Android this component renders nothing.
 */
import React, {useEffect, useRef} from 'react';
import {findNodeHandle, NativeModules, Platform, View} from 'react-native';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import {ScreenCapturePickerView} from 'react-native-webrtc';

let trigger: (() => void) | null = null;

/** showBroadcastPicker presents the iOS system broadcast picker, if mounted. */
export function showBroadcastPicker(): void {
  if (Platform.OS === 'ios') {
    trigger?.();
  }
}

export function IosScreenPicker(): React.JSX.Element | null {
  const ref = useRef(null);

  useEffect(() => {
    if (Platform.OS !== 'ios') {
      return;
    }
    trigger = () => {
      const tag = findNodeHandle(ref.current);
      const mgr = (NativeModules as any).ScreenCapturePickerViewManager;
      if (tag != null && mgr?.show) {
        mgr.show(tag);
      }
    };
    return () => {
      trigger = null;
    };
  }, []);

  if (Platform.OS !== 'ios') {
    return null;
  }
  return (
    <View style={{width: 0, height: 0, position: 'absolute', opacity: 0}}>
      {/* @ts-ignore ScreenCapturePickerView has no exported prop types here */}
      <ScreenCapturePickerView ref={ref} />
    </View>
  );
}
