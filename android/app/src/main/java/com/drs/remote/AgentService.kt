package com.drs.remote

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import com.drs.MainApplication
import com.facebook.react.modules.core.DeviceEventManagerModule

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
 *
 * It also ticks a native heartbeat timer (see startHeartbeatTicker). Confirmed
 * on-device: with the screen off, JS's own `setInterval`-driven heartbeat
 * (src/signal/client.ts) can simply stop firing for minutes at a time — while
 * WebRTC's native, event-driven connection work (not timer-based) keeps
 * running fine in the same process. The gateway expires device presence after
 * 3 missed heartbeat intervals regardless of whether a session is still
 * streaming, which is exactly the "streaming works, device shows offline"
 * symptom this was built to fix. A plain Handler loop on this service's main
 * Looper is not tied to screen/display state the way JS's timer path was, so
 * it emits a tick event to JS on its own schedule; JS responds by sending a
 * heartbeat immediately, on top of (not instead of) its own interval.
 *
 * Confirmed separately on this device's OEM skin (Transsion/XOS — its
 * ProcessRecord carries Transsion-only fields like mNeedLimitVisAdjForTranpm,
 * i.e. its own power-management hooks grafted into the framework): roughly 60
 * seconds after this app loses foreground focus, the WHOLE process stops
 * being scheduled — not just JS's timers but this service's own Handler loop
 * too, since both need the CPU to actually run. An active foreground service
 * does not prevent it. The one wake channel that survives is AlarmManager:
 * its alarms are delivered by system_server, which unfreezes/schedules this
 * process to hand off the broadcast regardless of the OEM's own freeze — see
 * KeepAliveReceiver and scheduleKeepAlive below.
 */
class AgentService : Service() {
    private val heartbeatHandler = Handler(Looper.getMainLooper())
    private var heartbeatRunnable: Runnable? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIF_ID, notification())
        }
        if (streamingActive) {
            setStreamingWakeLock(this, true)
        }
        acquireAgentWakeLock(this)
        OverlayKeepAlive.start(this)
        startReactHostHeadless()
        startHeartbeatTicker()
        scheduleKeepAlive(this)
        return START_STICKY
    }

    /**
     * Starts the RN JS engine itself if nothing has yet (no Activity has run
     * in this process). Confirmed on-device: when KeepAliveReceiver's alarm
     * resurrects a killed process via AgentService.start(), the Service comes
     * up fine (wake lock, overlay, this alarm all re-arm) but MainApplication
     * only lazily constructs the ReactHost object — it never actually starts
     * the JS instance without an Activity, so the gateway connection (which
     * lives in JS) never comes back even though the native process is alive.
     * ReactHost.start() is idempotent/safe to call again if an Activity has
     * already started it.
     */
    private fun startReactHostHeadless() {
        try {
            (application as? MainApplication)?.reactHost?.start()
        } catch (e: Exception) {
            Log.w("AgentService", "headless ReactHost start failed: ${e.message}")
        }
    }

    // Swiping the app from recents must not stop the agent: keep running.
    override fun onTaskRemoved(rootIntent: Intent?) {
        // no stopSelf() on purpose
    }

    override fun onDestroy() {
        stopHeartbeatTicker()
        cancelKeepAlive(this)
        setStreamingWakeLock(this, false)
        releaseAgentWakeLock()
        OverlayKeepAlive.stop(this)
        super.onDestroy()
    }

    private fun startHeartbeatTicker() {
        if (heartbeatRunnable != null) {
            return // already running
        }
        val runnable = object : Runnable {
            override fun run() {
                emitHeartbeatTick()
                heartbeatHandler.postDelayed(this, HEARTBEAT_TICK_MS)
            }
        }
        heartbeatRunnable = runnable
        heartbeatHandler.postDelayed(runnable, HEARTBEAT_TICK_MS)
    }

    private fun stopHeartbeatTicker() {
        heartbeatRunnable?.let { heartbeatHandler.removeCallbacks(it) }
        heartbeatRunnable = null
    }

    /**
     * Emits a "drs_heartbeat_tick" device event. JS (src/signal/client.ts)
     * listens via DeviceEventEmitter and sends a heartbeat immediately on
     * receipt. Best-effort: if the React context is not attached yet (very
     * early in process startup) this silently does nothing and simply tries
     * again on the next tick.
     */
    private fun emitHeartbeatTick() {
        emitHeartbeatTick(this)
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
        private const val WAKE_LOCK_TAG = "drs:screen-stream"
        private const val AGENT_WAKE_LOCK_TAG = "drs:agent-alive"
        /** JS event name the heartbeat ticker emits; must match client.ts. */
        const val HEARTBEAT_EVENT = "drs_heartbeat_tick"
        /** Well inside the gateway's 3-interval (90s @ 30s) presence timeout. */
        private const val HEARTBEAT_TICK_MS = 20_000L
        /**
         * Comfortably under the ~60s this device's OEM power management takes to
         * freeze a backgrounded process (see the class doc comment) and still
         * well inside the gateway's 90s presence timeout.
         */
        const val KEEPALIVE_INTERVAL_MS = 45_000L
        @Volatile private var streamingActive = false
        private val wakeLockGuard = Any()
        private var streamingWakeLock: PowerManager.WakeLock? = null
        private var agentWakeLock: PowerManager.WakeLock? = null

        /** Shared by the Handler-driven ticker and KeepAliveReceiver's alarm tick. */
        fun emitHeartbeatTick(ctx: Context) {
            try {
                val reactContext = (ctx.applicationContext as? MainApplication)?.reactHost?.currentReactContext
                reactContext
                    ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    ?.emit(HEARTBEAT_EVENT, null)
            } catch (e: Exception) {
                Log.w("AgentService", "heartbeat tick emit failed: ${e.message}")
            }
        }

        fun start(ctx: Context) {
            val i = Intent(ctx, AgentService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(i)
            } else {
                ctx.startService(i)
            }
        }

        /**
         * (Re-)arms the one-shot alarm KeepAliveReceiver rearms on every fire, so
         * the cycle repeats as long as the agent is meant to be running.
         * setExactAndAllowWhileIdle survives Doze; it needs SCHEDULE_EXACT_ALARM
         * on Android 12+, which Device Owner apps hold automatically, but a
         * non-owner install could have it revoked, so this falls back to the
         * inexact (still idle-allowed) variant rather than losing the wake-up
         * entirely.
         */
        fun scheduleKeepAlive(ctx: Context) {
            val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val pi = keepAlivePendingIntent(ctx)
            val triggerAt = SystemClock.elapsedRealtime() + KEEPALIVE_INTERVAL_MS
            try {
                am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
                Log.i("AgentService", "keep-alive alarm armed (exact), in ${KEEPALIVE_INTERVAL_MS}ms")
            } catch (e: SecurityException) {
                am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
                Log.w("AgentService", "keep-alive alarm armed (inexact fallback): ${e.message}")
            } catch (e: Exception) {
                Log.e("AgentService", "keep-alive alarm scheduling failed: ${e.message}", e)
            }
        }

        fun cancelKeepAlive(ctx: Context) {
            val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.cancel(keepAlivePendingIntent(ctx))
        }

        private fun keepAlivePendingIntent(ctx: Context): PendingIntent {
            val intent = Intent(ctx, KeepAliveReceiver::class.java)
            return PendingIntent.getBroadcast(
                ctx, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        fun setStreamingActive(ctx: Context, active: Boolean) {
            streamingActive = active
            setStreamingWakeLock(ctx.applicationContext, active)
        }

        fun stop(ctx: Context) {
            streamingActive = false
            setStreamingWakeLock(ctx.applicationContext, false)
            cancelKeepAlive(ctx)
            ctx.stopService(Intent(ctx, AgentService::class.java))
        }

        /**
         * Held for the agent's whole lifetime, not just during an active stream.
         * A plain foreground service plus this device's own battery-optimization
         * exemption and app-standby allowlisting were not enough to stop this
         * OEM freezing the process ~60s after it loses foreground focus (see the
         * class doc comment) — a continuously-held wake lock is the one other
         * standard, widely-respected Android signal left untried.
         */
        private fun acquireAgentWakeLock(ctx: Context) {
            synchronized(wakeLockGuard) {
                if (agentWakeLock?.isHeld == true) {
                    return
                }
                val powerManager = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
                agentWakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    AGENT_WAKE_LOCK_TAG,
                ).apply {
                    setReferenceCounted(false)
                    acquire()
                }
                Log.i("AgentService", "agent wake lock acquired")
            }
        }

        private fun releaseAgentWakeLock() {
            synchronized(wakeLockGuard) {
                agentWakeLock?.let { if (it.isHeld) it.release() }
                agentWakeLock = null
                Log.i("AgentService", "agent wake lock released")
            }
        }

        private fun setStreamingWakeLock(ctx: Context, enabled: Boolean) {
            synchronized(wakeLockGuard) {
                if (enabled) {
                    if (streamingWakeLock?.isHeld == true) {
                        return
                    }
                    val powerManager =
                        ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
                    streamingWakeLock = powerManager.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK,
                        WAKE_LOCK_TAG,
                    ).apply {
                        setReferenceCounted(false)
                        acquire()
                    }
                    Log.i("AgentService", "screen stream CPU wake lock acquired")
                } else {
                    streamingWakeLock?.let {
                        if (it.isHeld) {
                            it.release()
                        }
                    }
                    streamingWakeLock = null
                    Log.i("AgentService", "screen stream CPU wake lock released")
                }
            }
        }
    }
}
