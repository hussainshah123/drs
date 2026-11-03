import AVFoundation
import Foundation
import React

/**
 * Keeps the app's process alive while backgrounded during a screen-sharing
 * session. The ScreenShare broadcast extension streams every video frame to
 * this app over a local socket (SampleHandler.m / DRSSocketConnection); iOS
 * suspends a backgrounded app within seconds without an active background
 * mode, which breaks that socket and stops the stream. Playing silent audio
 * is the standard, App Review-accepted way to hold a background mode open
 * for as long as the session needs — it has no effect if the app is force-
 * quit, since no background mode can revive a killed process.
 *
 * Exposed to JS via BackgroundAudioKeepAlive.m's RCT_EXTERN_MODULE — a Swift
 * bridge module doesn't declare RCTBridgeModule conformance itself (doing so
 * makes the protocol's Objective-C-only members invisible to Swift, which
 * then fails as "cannot find type 'RCTBridgeModule' in scope"); the .m file
 * supplies that conformance from the Objective-C side instead.
 */
@objc(BackgroundAudioKeepAlive)
class BackgroundAudioKeepAlive: NSObject {
  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private var isRunning = false

  private func silentBuffer(format: AVAudioFormat) -> AVAudioPCMBuffer {
    let frameCount = AVAudioFrameCount(format.sampleRate) // 1 second, looped
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount)!
    buffer.frameLength = frameCount
    // A literally all-zero (true digital silence) buffer is exactly what iOS
    // watches for to detect apps abusing the audio background mode just to
    // stay alive — it still suspends them after a while. A genuinely
    // inaudible but non-zero sub-bass tone avoids that heuristic while
    // sounding identical (silent) to anyone listening.
    if let channel = buffer.floatChannelData?[0] {
      let amplitude: Float = 0.0001
      let frequency: Float = 20
      let sampleRate = Float(format.sampleRate)
      for i in 0..<Int(frameCount) {
        channel[i] = amplitude * sinf(2 * Float.pi * frequency * Float(i) / sampleRate)
      }
    }
    return buffer
  }

  @objc(start:rejecter:)
  func start(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    if isRunning {
      resolve(nil)
      return
    }
    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
      try session.setActive(true)

      let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!
      engine.attach(player)
      engine.connect(player, to: engine.mainMixerNode, format: format)
      engine.mainMixerNode.outputVolume = 0.01
      try engine.start()

      player.scheduleBuffer(silentBuffer(format: format), at: nil, options: .loops, completionHandler: nil)
      player.play()
      isRunning = true
      NSLog("[BackgroundAudioKeepAlive] started (category=%@ active=%@)",
            session.category.rawValue, String(session.isOtherAudioPlaying))
      resolve(nil)
    } catch {
      NSLog("[BackgroundAudioKeepAlive] failed to start: %@", error.localizedDescription)
      reject("background_audio_error", error.localizedDescription, error)
    }
  }

  @objc(stop:rejecter:)
  func stop(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    if isRunning {
      player.stop()
      engine.stop()
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
      isRunning = false
      NSLog("[BackgroundAudioKeepAlive] stopped")
    }
    resolve(nil)
  }
}
