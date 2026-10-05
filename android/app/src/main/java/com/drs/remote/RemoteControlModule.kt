package com.drs.remote

import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.text.TextUtils
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap

/**
 * JS bridge to the AccessibilityService. All input methods resolve false when the
 * service is not enabled, so the JS layer can prompt the user. Coordinates are
 * normalized (0..1); the service scales them to the real display.
 */
class RemoteControlModule(private val reactCtx: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactCtx) {

    override fun getName(): String = "RemoteControlModule"

    private fun service(): DrsAccessibilityService? = DrsAccessibilityService.instance

    @ReactMethod
    fun isAccessibilityEnabled(promise: Promise) {
        promise.resolve(isServiceEnabled())
    }

    private fun isServiceEnabled(): Boolean {
        if (DrsAccessibilityService.instance != null) {
            return true
        }
        // Fall back to the settings flag in case the instance is not yet bound.
        val expected = "${reactCtx.packageName}/${DrsAccessibilityService::class.java.name}"
        val enabled = Settings.Secure.getString(
            reactCtx.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: return false
        val splitter = TextUtils.SimpleStringSplitter(':')
        splitter.setString(enabled)
        while (splitter.hasNext()) {
            if (splitter.next().equals(expected, ignoreCase = true)) {
                return true
            }
        }
        return false
    }

    @ReactMethod
    fun openAccessibilitySettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactCtx.startActivity(intent)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("settings_error", e)
        }
    }

    @ReactMethod
    fun getScreenMetrics(promise: Promise) {
        val svc = service()
        val map = WritableNativeMap()
        if (svc == null) {
            val dm = reactCtx.resources.displayMetrics
            map.putInt("width", dm.widthPixels)
            map.putInt("height", dm.heightPixels)
            map.putDouble("density", dm.density.toDouble())
        } else {
            val (w, h) = svc.screenSize()
            map.putInt("width", w)
            map.putInt("height", h)
            map.putDouble("density", svc.density().toDouble())
        }
        promise.resolve(map)
    }

    @ReactMethod
    fun tap(x: Double, y: Double, promise: Promise) {
        promise.resolve(service()?.tap(x, y) ?: false)
    }

    @ReactMethod
    fun longPress(x: Double, y: Double, durationMs: Double, promise: Promise) {
        promise.resolve(service()?.longPress(x, y, durationMs.toLong()) ?: false)
    }

    @ReactMethod
    fun swipe(x1: Double, y1: Double, x2: Double, y2: Double, durationMs: Double, promise: Promise) {
        promise.resolve(service()?.swipe(x1, y1, x2, y2, durationMs.toLong()) ?: false)
    }

    @ReactMethod
    fun globalAction(action: String, promise: Promise) {
        promise.resolve(service()?.globalAction(action) ?: false)
    }

    @ReactMethod
    fun inputText(text: String, promise: Promise) {
        promise.resolve(service()?.inputText(text) ?: false)
    }
}
