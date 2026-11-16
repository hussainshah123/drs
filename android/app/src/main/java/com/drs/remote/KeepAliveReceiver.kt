package com.drs.remote

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Fired by the AlarmManager alarm AgentService.scheduleKeepAlive arms. System
 * alarms are delivered by system_server, which must unfreeze/schedule this
 * process to hand off the broadcast — the one wake channel that survives this
 * device's OEM-level background freeze (see AgentService's class doc comment),
 * unlike the service's own Handler-based ticker, which needs the CPU already
 * scheduling this process to fire at all.
 *
 * Restarting the service here is defense in depth for the rarer case where the
 * process was actually killed (not just frozen) — AgentService.start is a
 * no-op if it is already running.
 */
class KeepAliveReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Log.i("KeepAliveReceiver", "keep-alive tick fired")
        try {
            AgentService.start(context)
            AgentService.emitHeartbeatTick(context)
        } catch (e: Exception) {
            Log.w("KeepAliveReceiver", "keep-alive tick failed: ${e.message}")
        }
        AgentService.scheduleKeepAlive(context)
    }
}
