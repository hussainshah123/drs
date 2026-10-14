package com.drs.remote

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.drs.MainActivity

/**
 * Starts the agent after the device boots so a hidden managed install comes back
 * online on its own — there is no launcher icon to tap on an MDM device. A Device
 * Owner app is allowed to start an activity from the background, so launching
 * MainActivity here brings up the React Native runtime (and the AgentController),
 * which connects to the gateway and goes online.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON" &&
            action != Intent.ACTION_LOCKED_BOOT_COMPLETED
        ) {
            return
        }
        val launch = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(launch)
        } catch (e: Exception) {
            // Background-activity-start is permitted for a Device Owner; on a
            // non-owner device it may be blocked, which is fine (visible install).
        }
    }
}
