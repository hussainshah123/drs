package com.drs.remote

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap

/**
 * JS bridge to Android DevicePolicyManager — the DPC / device-owner management
 * surface, parallel to the Windows agent's management operations.
 *
 * Powerful operations (reboot, wipe) are honoured by the OS only when this app is
 * the active Device Owner, which requires enterprise provisioning. On a device
 * where the app is neither admin nor owner, every operation resolves/rejects
 * cleanly so the JS layer (and the server command handler) can report the right
 * status instead of crashing.
 */
class DeviceManagementModule(private val reactCtx: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactCtx) {

    override fun getName(): String = "DeviceManagementModule"

    private fun dpm(): DevicePolicyManager =
        reactCtx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

    private fun admin() = DrsDeviceAdminReceiver.component(reactCtx)

    private fun isAdminActive(): Boolean = dpm().isAdminActive(admin())

    private fun isOwner(): Boolean =
        try {
            dpm().isDeviceOwnerApp(reactCtx.packageName)
        } catch (e: Exception) {
            false
        }

    // -------------------------------------------------------------------------
    // Status
    // -------------------------------------------------------------------------

    @ReactMethod
    fun getStatus(promise: Promise) {
        val map = WritableNativeMap()
        map.putBoolean("adminActive", isAdminActive())
        map.putBoolean("deviceOwner", isOwner())
        promise.resolve(map)
    }

    /** Opens the "add device admin" system screen (for dev / non-owner devices). */
    @ReactMethod
    fun openDeviceAdminSettings(promise: Promise) {
        try {
            val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
                putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, admin())
                putExtra(
                    DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                    "Desktop Remote needs device admin to lock and manage this company device.",
                )
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactCtx.startActivity(intent)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("settings_error", e)
        }
    }

    // -------------------------------------------------------------------------
    // Operations
    // -------------------------------------------------------------------------

    /** Locks the device immediately. Works for device admin or device owner. */
    @ReactMethod
    fun lockNow(promise: Promise) {
        if (!isAdminActive()) {
            promise.resolve(false)
            return
        }
        try {
            dpm().lockNow()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("lock_failed", e)
        }
    }

    /** Reboots the device. Device Owner only; fails cleanly otherwise. */
    @ReactMethod
    fun reboot(promise: Promise) {
        if (!isOwner()) {
            promise.reject("not_device_owner", "reboot requires Device Owner")
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            promise.reject("unsupported_os", "reboot requires Android N+")
            return
        }
        try {
            dpm().reboot(admin())
            promise.resolve(true)
        } catch (e: Exception) {
            // Thrown if a call/alarm is active, etc.
            promise.reject("reboot_failed", e)
        }
    }

    /**
     * Factory-resets the device. Device Owner only. Destructive — the OS only
     * honours this for the active Device Owner; otherwise it rejects.
     * @param external also wipe adopted/external storage when true.
     */
    @ReactMethod
    fun wipeDevice(external: Boolean, promise: Promise) {
        if (!isOwner()) {
            promise.reject("not_device_owner", "wipe requires Device Owner")
            return
        }
        try {
            var flags = 0
            if (external && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                flags = flags or DevicePolicyManager.WIPE_EXTERNAL_STORAGE
            }
            dpm().wipeData(flags)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("wipe_failed", e)
        }
    }

    /** Enables/disables the camera for the whole device (device admin/owner). */
    @ReactMethod
    fun setCameraDisabled(disabled: Boolean, promise: Promise) {
        if (!isAdminActive()) {
            promise.resolve(false)
            return
        }
        try {
            dpm().setCameraDisabled(admin(), disabled)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("camera_policy_failed", e)
        }
    }
}
