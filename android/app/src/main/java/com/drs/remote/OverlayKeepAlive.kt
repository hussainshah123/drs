package com.drs.remote

import android.content.Context
import android.graphics.PixelFormat
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager

/**
 * A 1x1, fully transparent WindowManager overlay kept alive for as long as
 * AgentService runs. Experimental: a window actually present on screen (even
 * an invisible one) may count as this process being "visible" to the OS in a
 * way a foreground-service notification alone does not on this device's OEM
 * power management — see AgentService's class doc comment for the measured
 * ~60s freeze this is trying to avoid. The foreground service itself, the
 * battery-optimization exemption, the app-standby exemption and a
 * continuously-held wake lock all failed to prevent that freeze; this is the
 * next standard Android signal to try, not a confirmed fix.
 *
 * Needs SYSTEM_ALERT_WINDOW (Settings.canDrawOverlays) — a one-time manual
 * grant with no silent Device Owner equivalent — so it only activates once
 * the device owner has granted it from the Permissions tab.
 */
object OverlayKeepAlive {
    private const val TAG = "OverlayKeepAlive"
    private var view: View? = null

    fun isAvailable(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)

    @Synchronized
    fun start(ctx: Context) {
        if (view != null || !isAvailable(ctx)) {
            return
        }
        try {
            val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            } else {
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.TYPE_PHONE
            }
            val params = WindowManager.LayoutParams(
                1, 1, type,
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT,
            )
            params.gravity = Gravity.TOP or Gravity.START
            val v = View(ctx.applicationContext)
            v.setBackgroundColor(0)
            wm.addView(v, params)
            view = v
            Log.i(TAG, "overlay keep-alive window added")
        } catch (e: Exception) {
            Log.w(TAG, "overlay add failed: ${e.message}")
        }
    }

    @Synchronized
    fun stop(ctx: Context) {
        val v = view ?: return
        try {
            val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            wm.removeViewImmediate(v)
            Log.i(TAG, "overlay keep-alive window removed")
        } catch (e: Exception) {
            Log.w(TAG, "overlay remove failed: ${e.message}")
        } finally {
            view = null
        }
    }
}
