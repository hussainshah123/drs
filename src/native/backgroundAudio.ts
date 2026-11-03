/**
 * Bridge to the native iOS BackgroundAudioKeepAlive module. Started/stopped
 * alongside screen sharing: the ScreenShare broadcast extension streams
 * frames to this app over a local socket for the whole session, and iOS
 * suspends a backgrounded app within seconds without an active background
 * mode, cutting that socket. A silent audio session is what legally holds
 * the background mode open for as long as sharing runs. Android has its own
 * foreground-service mechanism (deviceManagement.ts) and doesn't need this;
 * on iOS without the native module (shouldn't happen) both are no-ops.
 */
import {NativeModules, Platform} from 'react-native';

type BackgroundAudioNative = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

const Native = (NativeModules.BackgroundAudioKeepAlive || null) as BackgroundAudioNative | null;

export const BackgroundAudio = {
  available(): boolean {
    return Platform.OS === 'ios' && Native != null;
  },
  start(): Promise<void> {
    return Platform.OS === 'ios' && Native ? Native.start() : Promise.resolve();
  },
  stop(): Promise<void> {
    return Platform.OS === 'ios' && Native ? Native.stop() : Promise.resolve();
  },
};
