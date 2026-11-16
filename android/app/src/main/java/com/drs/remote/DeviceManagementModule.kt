package com.drs.remote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
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
            // This plain startActivity() call is what Android 10+'s background
            // activity launch (BAL) restrictions were built to block: with no
            // visible activity and no qualifying exemption, the OS can — and on
            // this device's Android 16, reliably does — silently drop the start
            // with no exception thrown, so the call "succeeds" here while nothing
            // ever appears on screen. It still costs nothing to try first (works
            // when the process already has some foreground standing), but
            // postIncomingSessionNotification() below is the actual, OS-sanctioned
            // way to interrupt whatever the device is doing from the background —
            // the same mechanism incoming-call and alarm apps rely on.
            try {
                reactCtx.startActivity(intent)
            } catch (e: Exception) {
                android.util.Log.w("DeviceManagement", "direct activity start failed: ${e.message}")
            }
            postIncomingSessionNotification()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("launch_activity_failed", e)
        }
    }

    /**
     * Posts a high-priority, full-screen-intent notification targeting
     * MainActivity. Unlike a plain startActivity() from the background, this is
     * the mechanism Android actually allows to bring an activity to the
     * foreground unprompted (subject to the OS's own full-screen-intent trust
     * heuristics — on devices/versions where it declines to go full-screen, this
     * still surfaces a heads-up notification the operator-side device owner can
     * tap, which beats nothing happening at all).
     */
    private fun postIncomingSessionNotification() {
        val nm = reactCtx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                SESSION_CHANNEL,
                "Remote session",
                NotificationManager.IMPORTANCE_HIGH,
            )
            nm.createNotificationChannel(ch)
        }
        val intent = Intent().apply {
            setClassName(reactCtx.packageName, reactCtx.packageName + ".MainActivity")
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP,
            )
        }
        val pendingIntent = PendingIntent.getActivity(
            reactCtx,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(reactCtx, SESSION_CHANNEL)
        } else {
            Notification.Builder(reactCtx)
        }
        val notification = builder
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Remote session starting")
            .setContentText("An operator is connecting to this device.")
            .setCategory(Notification.CATEGORY_CALL)
            .setFullScreenIntent(pendingIntent, true)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()
        nm.notify(SESSION_NOTIF_ID, notification)
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

    // -------------------------------------------------------------------------
    // Battery optimization exemption
    //
    // A foreground service survives backgrounding by itself, but Android's
    // Doze/App Standby battery optimizer can still throttle or kill network
    // connections (and, on some OEM skins — Xiaomi/MIUI, Oppo, Vivo, Huawei,
    // Samsung — the whole background process) after extended idle time,
    // regardless of the foreground service. Being on the OS's battery
    // optimization exemption list is the standard, documented defense for an
    // app that genuinely needs to stay connected in the background (this is
    // the same mechanism messaging and VPN apps use). It still needs ONE
    // explicit user tap on the system dialog below — there is no public API,
    // even for a Device Owner, to grant this silently. OEM-specific
    // "autostart"/"no restrictions" battery managers are a separate, further
    // step this cannot reach — that needs the IT admin to allow this app in
    // the device's own battery manager app, which has no common Android API.
    // -------------------------------------------------------------------------

    @ReactMethod
    fun isIgnoringBatteryOptimizations(promise: Promise) {
        try {
            val pm = reactCtx.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
            promise.resolve(pm.isIgnoringBatteryOptimizations(reactCtx.packageName))
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    /**
     * Shows the system "allow this app to ignore battery optimizations?"
     * dialog if not already exempt. Resolves true only if already exempt
     * (the dialog itself is fire-and-forget; call isIgnoringBatteryOptimizations
     * again after the app resumes to see what the user chose).
     */
    @ReactMethod
    fun requestIgnoreBatteryOptimizations(promise: Promise) {
        try {
            val pm = reactCtx.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
            if (pm.isIgnoringBatteryOptimizations(reactCtx.packageName)) {
                promise.resolve(true)
                return
            }
            val intent = Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = android.net.Uri.parse("package:${reactCtx.packageName}")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactCtx.startActivity(intent)
            promise.resolve(false)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    /**
     * Opens the OS's per-app battery detail screen for this app
     * (android.settings.VIEW_ADVANCED_POWER_USAGE_DETAIL). On this device's OEM
     * skin (Transsion/XOS) this is also where the "Allow background activity" /
     * "Stop app when idle" toggles live — the layer above the standard Doze/App
     * Standby exemption that the OEM's own RMS background-process manager
     * checks independently. There is no public API to set these toggles
     * silently, even for a Device Owner: confirmed by inspecting the OEM's own
     * settings/phonemanager/performance.rms system packages on this device,
     * none of which expose a programmatic grant path. Falls back to the
     * package's App Info screen if the detail action isn't handled.
     */
    @ReactMethod
    fun openBackgroundActivitySettings(promise: Promise) {
        try {
            val pkg = reactCtx.packageName
            val detail = Intent("android.settings.VIEW_ADVANCED_POWER_USAGE_DETAIL").apply {
                data = android.net.Uri.parse("package:$pkg")
                putExtra("package", pkg)
                try {
                    putExtra("uid", reactCtx.packageManager.getApplicationInfo(pkg, 0).uid)
                } catch (e: Exception) { /* uid extra is best-effort */ }
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            try {
                reactCtx.startActivity(detail)
                promise.resolve(true)
                return
            } catch (e: Exception) {
                android.util.Log.w("DeviceManagement", "advanced power usage detail failed: ${e.message}")
            }
            val appInfo = Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = android.net.Uri.parse("package:$pkg")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactCtx.startActivity(appInfo)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("battery_detail_failed", e)
        }
    }

    /**
     * Whether the OS currently lets this app draw overlay windows
     * (Settings.canDrawOverlays). See OverlayKeepAlive.kt: an experimental,
     * last-resort background-persistence signal, not confirmed to work.
     */
    @ReactMethod
    fun hasOverlayPermission(promise: Promise) {
        promise.resolve(OverlayKeepAlive.isAvailable(reactCtx))
    }

    /**
     * Opens the system "draw over other apps" grant screen for this app if
     * not already allowed. One-time manual tap — there is no silent Device
     * Owner grant for SYSTEM_ALERT_WINDOW.
     */
    @ReactMethod
    fun requestOverlayPermission(promise: Promise) {
        try {
            if (OverlayKeepAlive.isAvailable(reactCtx)) {
                promise.resolve(true)
                return
            }
            val intent = Intent(
                android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                android.net.Uri.parse("package:${reactCtx.packageName}"),
            ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            reactCtx.startActivity(intent)
            promise.resolve(false)
        } catch (e: Exception) {
            promise.resolve(false)
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

    companion object {
        private const val SESSION_CHANNEL = "drs_incoming_session"
        private const val SESSION_NOTIF_ID = 4202
    }
}
