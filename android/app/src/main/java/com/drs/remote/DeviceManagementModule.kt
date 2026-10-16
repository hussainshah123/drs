package com.drs.remote

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.PermissionInfo
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

    /**
     * Silently grants this app's own dangerous (runtime) permissions — camera,
     * microphone, location, notifications, etc. — using setPermissionGrantState.
     * Device Owner (or Profile Owner) only; the OS ignores it otherwise, so on a
     * normal device this resolves 0 and the app falls back to the usual prompts.
     *
     * It enumerates the permissions the manifest actually declares and grants
     * each runtime one, so permissions added later are covered automatically.
     * Note: this does NOT cover MediaProjection (screen capture) or the
     * AccessibilityService — those are separate OS gates, not runtime permissions.
     * Resolves the number of permissions granted.
     */
    @ReactMethod
    fun grantRuntimePermissions(promise: Promise) {
        if (!isOwner() || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            promise.resolve(0)
            return
        }
        try {
            val pm = reactCtx.packageManager
            val pkg = reactCtx.packageName
            val info = pm.getPackageInfo(pkg, PackageManager.GET_PERMISSIONS)
            val declared = info.requestedPermissions ?: emptyArray()
            var granted = 0
            for (perm in declared) {
                val dangerous = try {
                    val pi = pm.getPermissionInfo(perm, 0)
                    (pi.protectionLevel and PermissionInfo.PROTECTION_MASK_BASE) ==
                        PermissionInfo.PROTECTION_DANGEROUS
                } catch (e: PackageManager.NameNotFoundException) {
                    false
                }
                if (!dangerous) continue
                val ok = dpm().setPermissionGrantState(
                    admin(), pkg, perm,
                    DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED,
                )
                if (ok) granted++
            }
            promise.resolve(granted)
        } catch (e: Exception) {
            promise.reject("grant_failed", e)
        }
    }

    // -------------------------------------------------------------------------
    // Managed ("hidden agent") policies — Device Owner only
    // -------------------------------------------------------------------------

    private val launcherAlias
        get() = ComponentName(reactCtx.packageName, reactCtx.packageName + ".LauncherAlias")

    /**
     * Hides or shows this agent's launcher icon. Hiding disables the launcher
     * alias (not MainActivity), so the app vanishes from the drawer but can still
     * be started programmatically (boot receiver, service, am start). No owner
     * needed to toggle the component, but it is meant for managed devices.
     */
    @ReactMethod
    fun setLauncherIconHidden(hidden: Boolean, promise: Promise) {
        try {
            val state = if (hidden) {
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED
            } else {
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED
            }
            reactCtx.packageManager.setComponentEnabledSetting(
                launcherAlias, state, PackageManager.DONT_KILL_APP,
            )
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("hide_icon_failed", e)
        }
    }

    /** Blocks or allows the end user uninstalling this app. Device Owner only. */
    @ReactMethod
    fun setUninstallBlocked(blocked: Boolean, promise: Promise) {
        if (!isOwner()) {
            promise.resolve(false)
            return
        }
        try {
            dpm().setUninstallBlocked(admin(), reactCtx.packageName, blocked)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("uninstall_block_failed", e)
        }
    }

    /**
     * Prevents (or re-allows) the user force-stopping / clearing this app from
     * Settings. Device Owner on Android 11+ (setUserControlDisabledPackages).
     */
    @ReactMethod
    fun setUserControlDisabled(disabled: Boolean, promise: Promise) {
        if (!isOwner() || Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            promise.resolve(false)
            return
        }
        try {
            val pkgs = if (disabled) listOf(reactCtx.packageName) else emptyList()
            dpm().setUserControlDisabledPackages(admin(), pkgs)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("user_control_failed", e)
        }
    }

    /**
     * Applies the managed-agent profile in one call for a Device Owner: block
     * uninstall, disable force-stop, and (when hideIcon) remove the launcher
     * icon. Resolves a summary map of what was applied. A no-op on non-owner
     * devices except the icon toggle, which does not need ownership.
     */
    @ReactMethod
    fun applyManagedAgentPolicy(hideIcon: Boolean, promise: Promise) {
        val owner = isOwner()
        val result = WritableNativeMap()
        result.putBoolean("deviceOwner", owner)
        // Every managed action is gated on Device Owner: a normal install must
        // never block its own uninstall or hide its own icon.
        if (!owner) {
            promise.resolve(result)
            return
        }
        try {
            dpm().setUninstallBlocked(admin(), reactCtx.packageName, true)
            result.putBoolean("uninstallBlocked", true)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                dpm().setUserControlDisabledPackages(admin(), listOf(reactCtx.packageName))
                result.putBoolean("forceStopDisabled", true)
            }
            if (hideIcon) {
                reactCtx.packageManager.setComponentEnabledSetting(
                    launcherAlias,
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    PackageManager.DONT_KILL_APP,
                )
                result.putBoolean("iconHidden", true)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("managed_policy_failed", e)
        }
    }

    /**
     * Starts the persistent foreground service that keeps the agent alive in the
     * background (survives recents-swipe / backgrounding). Works on any device,
     * no Device Owner required.
     */
    @ReactMethod
    fun startAgentService(promise: Promise) {
        try {
            AgentService.start(reactCtx)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("agent_service_failed", e)
        }
    }

    /** Keeps the CPU awake only while a remote screen stream has an active peer. */
    @ReactMethod
    fun setStreamingActive(active: Boolean, promise: Promise) {
        try {
            AgentService.setStreamingActive(reactCtx, active)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("stream_wake_lock_failed", e)
        }
    }

    /**
     * Brings the agent's MainActivity to the foreground. Screen capture
     * (MediaProjection) needs a resumed Activity; a hidden/background agent has
     * none, so this is called just before capture starts. A Device Owner is
     * allowed to start an activity from the background.
     */
    @ReactMethod
    fun launchAgentActivity(promise: Promise) {
        try {
            // Target MainActivity directly: the launcher alias is disabled when the
            // icon is hidden, so getLaunchIntentForPackage() may be null.
            val intent = Intent().apply {
                setClassName(reactCtx.packageName, reactCtx.packageName + ".MainActivity")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            }
            reactCtx.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("launch_activity_failed", e)
        }
    }

    /** Stops the background keep-alive service (e.g. on unenroll). */
    @ReactMethod
    fun stopAgentService(promise: Promise) {
        try {
            AgentService.stop(reactCtx)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("agent_service_stop_failed", e)
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
