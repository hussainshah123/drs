/**
 * Screen capture source.
 *
 * Wraps mediaDevices.getDisplayMedia(), which on Android drives the system
 * MediaProjection consent dialog. react-native-webrtc runs its own foreground
 * service of type mediaProjection (MediaProjectionService, merged from the
 * library manifest) for the lifetime of the capture. One capture stream is
 * shared across every participant's peer connection; the first viewer starts it,
 * the last one to leave stops it.
 */
import {Platform} from 'react-native';
import {mediaDevices, type MediaStream, type MediaStreamTrack} from 'react-native-webrtc';
import {log} from '../core/log';
import {showBroadcastPicker} from './iosPicker';

export class ScreenShare {
  private stream: MediaStream | null = null;
  private refCount = 0;
  private starting: Promise<MediaStream> | null = null;

  /** active is true while the screen is being captured. */
  get active(): boolean {
    return this.stream != null;
  }

  /**
   * acquire returns the shared capture stream, starting it (and the foreground
   * service + MediaProjection prompt) on first use. Each caller must release().
   */
  async acquire(): Promise<MediaStream> {
    this.refCount += 1;
    if (this.stream) {
      return this.stream;
    }
    if (this.starting) {
      return this.starting;
    }
    this.starting = this.begin();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async begin(): Promise<MediaStream> {
    if (Platform.OS === 'ios') {
      // Present the ReplayKit broadcast picker so the user starts the extension.
      log.info('screen', 'presenting iOS broadcast picker');
      showBroadcastPicker();
    } else {
      log.info('screen', 'requesting screen capture (MediaProjection)');
    }
    const stream = (await (mediaDevices as any).getDisplayMedia()) as MediaStream;
    this.stream = stream;
    stream.getTracks().forEach((t: MediaStreamTrack) => {
      (t as any).addEventListener?.('ended', () => {
        log.warn('screen', 'capture track ended by system/user');
        this.forceStop();
      });
    });
    log.info('screen', 'screen capture started');
    return stream;
  }

  /** release drops one reference; the capture stops when the last one goes. */
  release(): void {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount === 0) {
      this.forceStop();
    }
  }

  private forceStop(): void {
    this.refCount = 0;
    if (this.stream) {
      this.stream.getTracks().forEach((t: MediaStreamTrack) => {
        try {
          t.stop();
        } catch {}
      });
      this.stream = null;
    }
    log.info('screen', 'screen capture stopped');
  }
}
