package com.drs.remote

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers the agent's native modules with React Native (added in
 * MainApplication): remote-control input (AccessibilityService), device
 * management (DevicePolicyManager / DPC), and clipboard sync.
 */
class RemoteControlPackage : ReactPackage {
    override fun createNativeModules(
        reactContext: ReactApplicationContext,
    ): List<NativeModule> = listOf(
        RemoteControlModule(reactContext),
        DeviceManagementModule(reactContext),
        ClipboardModule(reactContext),
        DeviceDataModule(reactContext),
    )

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<*, *>> = emptyList()
}
