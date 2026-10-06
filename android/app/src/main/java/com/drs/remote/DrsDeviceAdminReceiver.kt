package com.drs.remote

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
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
    }

    override fun onDisabled(context: Context, intent: Intent) {
        Log.i(TAG, "device admin disabled")
    }

    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        Log.i(TAG, "profile/device provisioning complete")
    }
}
