package com.drs.remote

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.input.InputManager
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import android.provider.Settings
import android.text.TextUtils
import android.util.Log
import android.view.InputDevice
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

    private val inputLockMonitor = Any()
    private val blockedInputDevices = linkedSetOf<Int>()

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

    /**
     * Checks, for THIS device, whether its real hardware H.264 encoder can
     * actually handle the given capture size — without encoding a single
     * frame. This is the per-device "is scrcpy-style hardware encoding safe
     * here" answer: some devices' hardware AVC encoders reject sizes that
     * aren't aligned to their macroblock/stride requirements (a common root
     * cause of "0 frames encoded" for screencast on arbitrary screen
     * resolutions) — MediaCodecInfo.VideoCapabilities.isSizeSupported() is the
     * same check the OS itself uses, so trusting it is safer than a hardcoded
     * device list, and it means every device decides for itself. The JS layer
     * (peer.ts) uses this to choose the outbound codec per connection, with
     * software VP8 as the universal fallback when this returns false or the
     * check itself fails for any reason.
     */
    @ReactMethod
    fun supportsHardwareH264(width: Int, height: Int, promise: Promise) {
        try {
            promise.resolve(hasHardwareH264For(width, height))
        } catch (e: Exception) {
            Log.w("DrsRemoteControl", "hardware H264 capability check failed", e)
            promise.resolve(false)
        }
    }

    private fun hasHardwareH264For(width: Int, height: Int): Boolean {
        if (width <= 0 || height <= 0) {
            return false
        }
        val mimeType = "video/avc"
        val codecList = MediaCodecList(MediaCodecList.REGULAR_CODECS)
        for (info in codecList.codecInfos) {
            if (!info.isEncoder || !isHardwareAccelerated(info)) {
                continue
            }
            if (!info.supportedTypes.any { it.equals(mimeType, ignoreCase = true) }) {
                continue
            }
            try {
                val video = info.getCapabilitiesForType(mimeType).videoCapabilities
                if (video != null && video.isSizeSupported(width, height)) {
                    return true
                }
            } catch (e: Exception) {
                // This codec rejected these params outright — keep checking
                // the rest; a device can expose more than one AVC encoder.
            }
        }
        return false
    }

    private fun isHardwareAccelerated(info: MediaCodecInfo): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return info.isHardwareAccelerated
        }
        // Pre-Q has no isHardwareAccelerated() API: software codecs are
        // namespaced OMX.google.* (and, on newer Android, c2.android.*).
        val name = info.name.lowercase()
        return !(name.startsWith("omx.google.") || name.startsWith("c2.android."))
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

    /**
     * Live touch tracking (API 26+): starts a real touch at this position that
     * stays down until touchUp/touchCancel. Resolves false pre-API 26 or on
     * failure — the JS layer falls back to tap/swipe (record-then-replay) in
     * that case.
     */
    @ReactMethod
    fun touchDown(x: Double, y: Double, promise: Promise) {
        promise.resolve(service()?.touchDown(x, y) ?: false)
    }

    @ReactMethod
    fun touchMove(x: Double, y: Double, promise: Promise) {
        promise.resolve(service()?.touchMove(x, y) ?: false)
    }

    @ReactMethod
    fun touchUp(x: Double, y: Double, promise: Promise) {
        promise.resolve(service()?.touchUp(x, y) ?: false)
    }

    @ReactMethod
    fun touchCancel(promise: Promise) {
        service()?.touchCancel()
        promise.resolve(null)
    }

    @ReactMethod
    fun globalAction(action: String, promise: Promise) {
        promise.resolve(service()?.globalAction(action) ?: false)
    }

    @ReactMethod
    fun inputText(text: String, promise: Promise) {
        promise.resolve(service()?.inputText(text) ?: false)
    }

    /**
     * Disables physical touchscreen, keyboard, and mouse devices. Android only
     * grants DISABLE_INPUT_DEVICE to privileged/system apps; AccessibilityService
     * gestures injected by the operator remain separate from physical devices.
     */
    @ReactMethod
    fun setLocalInputBlocked(blocked: Boolean, promise: Promise) {
        try {
            promise.resolve(setPhysicalInputBlocked(blocked))
        } catch (e: Exception) {
            Log.w("DrsRemoteControl", "physical input blocking failed", e)
            promise.resolve(false)
        }
    }

    private fun setPhysicalInputBlocked(blocked: Boolean): Boolean =
        synchronized(inputLockMonitor) {
            val permission = "android.permission.DISABLE_INPUT_DEVICE"
            if (reactCtx.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
                return@synchronized false
            }
            val manager = reactCtx.getSystemService(Context.INPUT_SERVICE) ?: return@synchronized false
            try {
                val managerClass = InputManager::class.java
                val intClass = Int::class.javaPrimitiveType!!
                val idsMethod = managerClass.getMethod("getInputDeviceIds")
                val deviceMethod = managerClass.getMethod("getInputDevice", intClass)
                val enabledMethod = managerClass.getMethod("isInputDeviceEnabled", intClass)
                val disableMethod = managerClass.getMethod("disableInputDevice", intClass)
                val enableMethod = managerClass.getMethod("enableInputDevice", intClass)
                val ids = idsMethod.invoke(manager) as? IntArray ?: return@synchronized false

                if (blocked) {
                    if (blockedInputDevices.isNotEmpty()) return@synchronized true
                    val sources = InputDevice.SOURCE_TOUCHSCREEN or
                        InputDevice.SOURCE_KEYBOARD or InputDevice.SOURCE_MOUSE
                    val candidates = ids.filter { id ->
                        val device = deviceMethod.invoke(manager, id) as? InputDevice
                        device != null && !device.isVirtual && device.sources and sources != 0 &&
                            enabledMethod.invoke(manager, id) == true
                    }
                    if (candidates.isEmpty()) return@synchronized false
                    try {
                        candidates.forEach { id ->
                            disableMethod.invoke(manager, id)
                            blockedInputDevices.add(id)
                            check(enabledMethod.invoke(manager, id) == false)
                        }
                        true
                    } catch (e: Exception) {
                        restoreInputDevices(manager, ids, enableMethod, enabledMethod)
                        Log.w("DrsRemoteControl", "could not disable all physical input devices", e)
                        false
                    }
                } else {
                    restoreInputDevices(manager, ids, enableMethod, enabledMethod)
                    blockedInputDevices.isEmpty()
                }
            } catch (e: Exception) {
                Log.w("DrsRemoteControl", "privileged input-device API is unavailable", e)
                false
            }
        }

    private fun restoreInputDevices(
        manager: Any,
        connectedIds: IntArray,
        enableMethod: java.lang.reflect.Method,
        enabledMethod: java.lang.reflect.Method,
    ) {
        blockedInputDevices.toList().forEach { id ->
            if (id !in connectedIds) {
                blockedInputDevices.remove(id)
                return@forEach
            }
            try {
                enableMethod.invoke(manager, id)
                if (enabledMethod.invoke(manager, id) == true) {
                    blockedInputDevices.remove(id)
                }
            } catch (e: Exception) {
                Log.w("DrsRemoteControl", "could not restore physical input device $id", e)
            }
        }
    }

    override fun invalidate() {
        setPhysicalInputBlocked(false)
        super.invalidate()
    }
}
