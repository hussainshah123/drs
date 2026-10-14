package com.drs.remote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Foreground service that keeps the agent alive in the background.
 *
 * The React Native agent (the signalling WebSocket that makes the device appear
 * online and remotely viewable) runs in this same process. Android kills a
 * process with no visible Activity when its task is swiped from recents or it is
 * backgrounded under memory pressure; a running foreground service marks the
 * process as user-visible, so the system keeps it — and the agent stays
 * connected. onTaskRemoved deliberately does nothing (swiping the app away must
 * not stop the agent), and START_STICKY asks the OS to recreate the service if
 * it is ever killed.
 */
class AgentService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIF_ID, notification())
        }
        return START_STICKY
    }

    // Swiping the app from recents must not stop the agent: keep running.
    override fun onTaskRemoved(rootIntent: Intent?) {
        // no stopSelf() on purpose
    }

    private fun notification(): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL, "Device management", NotificationManager.IMPORTANCE_MIN)
            ch.setShowBadge(false)
            nm.createNotificationChannel(ch)
        }
        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL)
        } else {
            Notification.Builder(this)
        }
        return builder
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Device management active")
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CHANNEL = "drs_agent"
        private const val NOTIF_ID = 4201

        fun start(ctx: Context) {
            val i = Intent(ctx, AgentService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(i)
            } else {
                ctx.startService(i)
            }
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, AgentService::class.java))
        }
    }
}
