package com.drs.remote

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * DrsDeviceAdminReceiver is the app's DPC (Device Policy Controller) component.
 *
 * It is the admin ComponentName passed to DevicePolicyManager for every policy
 * operation. On a company-owned, fully managed device this app is provisioned as
 * Device Owner (Android Enterprise QR / zero-touch in production; test
 * provisioning on a dedicated dev device), after which DevicePolicyManager grants
 * the management operations exposed by DeviceManagementModule.
 *
 * This class only needs to exist and be declared in the manifest with
 * BIND_DEVICE_ADMIN; the lifecycle callbacks are advisory logging.
 */
class DrsDeviceAdminReceiver : DeviceAdminReceiver() {

    companion object {
        private const val TAG = "DrsDeviceAdmin"

        /** The admin ComponentName used for all DevicePolicyManager calls. */
        fun component(context: Context): ComponentName =
            ComponentName(context.applicationContext, DrsDeviceAdminReceiver::class.java)
    }

    override fun onEnabled(context: Context, intent: Intent) {
        Log.i(TAG, "device admin enabled")
        protect(context)
    }

    override fun onDisabled(context: Context, intent: Intent) {
        Log.i(TAG, "device admin disabled")
    }

    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        Log.i(TAG, "profile/device provisioning complete")
        protect(context)
    }

    /**
     * Applies the baseline tamper protection the moment this app becomes Device
     * Owner — block uninstall and (Android 11+) force-stop — so there is no window
     * between provisioning and the first app launch where the agent could be
     * removed. The React Native layer re-asserts this (and hides the icon) on
     * boot; doing it here too makes it immediate and independent of the JS layer.
     * A no-op unless this app is Device Owner.
     */
    private fun protect(context: Context) {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val pkg = context.packageName
        if (!dpm.isDeviceOwnerApp(pkg)) {
            return
        }
        val admin = component(context)
        try {
            dpm.setUninstallBlocked(admin, pkg, true)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                dpm.setUserControlDisabledPackages(admin, listOf(pkg))
            }
            Log.i(TAG, "baseline tamper protection applied (uninstall + force-stop blocked)")
        } catch (e: Exception) {
            Log.w(TAG, "failed to apply baseline protection: ${e.message}")
        }
    }
}
