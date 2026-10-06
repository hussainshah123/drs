package com.drs

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.drs.remote.RemoteControlPackage
import com.oney.WebRTCModule.WebRTCModuleOptions

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Local package for the remote-control AccessibilityService bridge.
          add(RemoteControlPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Required for screen capture on Android 10+: react-native-webrtc only starts
    // the mediaProjection foreground service when this is enabled. Without it,
    // ScreenCapturerAndroid.startCapture throws a SecurityException on Android 14+
    // (no FGS of type mediaProjection) and the capture delivers 0 frames.
    WebRTCModuleOptions.getInstance().enableMediaProjectionService = true
    loadReactNative(this)
  }
}
