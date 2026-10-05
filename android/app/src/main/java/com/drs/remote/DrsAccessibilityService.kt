package com.drs.remote

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.os.Bundle
import android.util.DisplayMetrics
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * DrsAccessibilityService injects remote input on behalf of the operator.
 *
 * The React Native RemoteControlModule forwards normalized (0..1) coordinates
 * from the WebRTC control channel; this service scales them to the real display
 * and dispatches gestures, global actions (back/home/recents/lock), and text.
 *
 * It exposes itself as a process-wide singleton so the bridge module can reach
 * the live instance while the service is bound.
 */
class DrsAccessibilityService : AccessibilityService() {

    companion object {
        @Volatile
        var instance: DrsAccessibilityService? = null
            private set
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        instance = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    // This service drives input only; it does not react to a11y events.
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    /** Real display size in pixels, including system bars. */
    fun screenSize(): Pair<Int, Int> {
        val wm = getSystemService(WINDOW_SERVICE) as WindowManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val b = wm.currentWindowMetrics.bounds
            Pair(b.width(), b.height())
        } else {
            val m = DisplayMetrics()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getRealMetrics(m)
            Pair(m.widthPixels, m.heightPixels)
        }
    }

    fun density(): Float = resources.displayMetrics.density

    private fun px(nx: Double, ny: Double): Pair<Float, Float> {
        val (w, h) = screenSize()
        val x = (nx.coerceIn(0.0, 1.0) * w).toFloat()
        val y = (ny.coerceIn(0.0, 1.0) * h).toFloat()
        return Pair(x, y)
    }

    fun tap(nx: Double, ny: Double): Boolean {
        val (x, y) = px(nx, ny)
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 1)
        return dispatch(GestureDescription.Builder().addStroke(stroke).build())
    }

    fun longPress(nx: Double, ny: Double, durationMs: Long): Boolean {
        val (x, y) = px(nx, ny)
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs.coerceIn(20, 10_000))
        return dispatch(GestureDescription.Builder().addStroke(stroke).build())
    }

    fun swipe(nx1: Double, ny1: Double, nx2: Double, ny2: Double, durationMs: Long): Boolean {
        val (x1, y1) = px(nx1, ny1)
        val (x2, y2) = px(nx2, ny2)
        val path = Path().apply {
            moveTo(x1, y1)
            lineTo(x2, y2)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs.coerceIn(20, 10_000))
        return dispatch(GestureDescription.Builder().addStroke(stroke).build())
    }

    private fun dispatch(gesture: GestureDescription): Boolean {
        return try {
            dispatchGesture(gesture, null, null)
        } catch (e: Exception) {
            false
        }
    }

    /** Maps a GLOBAL_ACTION_* name to the platform constant and performs it. */
    fun globalAction(name: String): Boolean {
        val action = when (name) {
            "GLOBAL_ACTION_BACK" -> GLOBAL_ACTION_BACK
            "GLOBAL_ACTION_HOME" -> GLOBAL_ACTION_HOME
            "GLOBAL_ACTION_RECENTS" -> GLOBAL_ACTION_RECENTS
            "GLOBAL_ACTION_NOTIFICATIONS" -> GLOBAL_ACTION_NOTIFICATIONS
            "GLOBAL_ACTION_QUICK_SETTINGS" -> GLOBAL_ACTION_QUICK_SETTINGS
            "GLOBAL_ACTION_POWER_DIALOG" -> GLOBAL_ACTION_POWER_DIALOG
            "GLOBAL_ACTION_LOCK_SCREEN" ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) GLOBAL_ACTION_LOCK_SCREEN else return false
            "GLOBAL_ACTION_TAKE_SCREENSHOT" ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) GLOBAL_ACTION_TAKE_SCREENSHOT else return false
            else -> return false
        }
        return try {
            performGlobalAction(action)
        } catch (e: Exception) {
            false
        }
    }

    /** Appends text to the currently focused editable field. */
    fun inputText(text: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
        if (!focused.isEditable) {
            return false
        }
        val existing = focused.text?.toString() ?: ""
        val args = Bundle().apply {
            putCharSequence(
                AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                existing + text,
            )
        }
        return focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }
}
