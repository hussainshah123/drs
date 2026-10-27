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

        /**
         * Duration of each live-touch segment. Short enough to feel immediate
         * (a new mouse position is reflected within roughly one segment), long
         * enough that dispatchGesture isn't called at an unreasonable rate.
         */
        private const val LIVE_SEGMENT_MS = 16L
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

    /**
     * One-shot replayed swipe: a single stroke from (x1,y1) to (x2,y2) over
     * durationMs. Used as the pre-API-26 fallback and for scripted/legacy
     * callers. For a live operator drag, prefer touchDown/touchMove/touchUp
     * below — this method only plays out AFTER the whole gesture is known,
     * which is what made dragging feel delayed (nothing moves on screen
     * until release, then the entire motion replays at once).
     */
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

    // -------------------------------------------------------------------------
    // Live touch tracking (API 26+): the operator's mouse down/move/up stream
    // is injected as an actual, continuous touch as each event arrives —
    // StrokeDescription.continueStroke() chains short segments one after
    // another, each dispatched only once the previous one's own callback
    // fires (that is an OS constraint, not a choice: segments cannot overlap).
    // Rapid moves are coalesced to the latest target in between segments, the
    // same way a real finger's movement is sampled, so this stays responsive
    // without unbounded queueing. This is what makes a drag/scroll track the
    // mouse live instead of replaying only after release.
    // -------------------------------------------------------------------------
    private val liveTouchLock = Any()
    private var liveStroke: GestureDescription.StrokeDescription? = null
    private var liveLastX = 0f
    private var liveLastY = 0f
    private var liveTargetX = 0f
    private var liveTargetY = 0f
    private var liveSegmentInFlight = false
    private var livePendingUp = false
    private var liveActive = false

    private fun liveTouchSupported(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O

    /** Starts a live touch at (nx,ny). Returns false (caller should fall back to tap/swipe) pre-API 26 or on failure. */
    fun touchDown(nx: Double, ny: Double): Boolean {
        if (!liveTouchSupported()) {
            return false
        }
        val (x, y) = px(nx, ny)
        synchronized(liveTouchLock) {
            liveLastX = x
            liveLastY = y
            liveTargetX = x
            liveTargetY = y
            livePendingUp = false
            liveActive = true
            liveSegmentInFlight = true
        }
        val path = Path().apply { moveTo(x, y) }
        // A short initial dwell so the OS registers a real ACTION_DOWN before
        // any movement begins — too short and some devices drop it.
        val stroke = GestureDescription.StrokeDescription(path, 0, LIVE_SEGMENT_MS, true)
        synchronized(liveTouchLock) { liveStroke = stroke }
        return dispatchLive(stroke)
    }

    /** Updates the live touch's target position; coalesced with any already-pending move. */
    fun touchMove(nx: Double, ny: Double): Boolean {
        if (!liveTouchSupported()) {
            return false
        }
        val (x, y) = px(nx, ny)
        var shouldKick = false
        synchronized(liveTouchLock) {
            if (!liveActive) {
                return false
            }
            liveTargetX = x
            liveTargetY = y
            if (!liveSegmentInFlight) {
                shouldKick = true
                liveSegmentInFlight = true
            }
        }
        if (shouldKick) {
            continueLiveStroke()
        }
        return true
    }

    /** Ends the live touch at (nx,ny). */
    fun touchUp(nx: Double, ny: Double): Boolean {
        if (!liveTouchSupported()) {
            return false
        }
        val (x, y) = px(nx, ny)
        var shouldKick = false
        synchronized(liveTouchLock) {
            if (!liveActive) {
                return false
            }
            liveTargetX = x
            liveTargetY = y
            livePendingUp = true
            if (!liveSegmentInFlight) {
                shouldKick = true
                liveSegmentInFlight = true
            }
        }
        if (shouldKick) {
            continueLiveStroke()
        }
        return true
    }

    /** Cancels a live touch without completing it (e.g. participant disconnected mid-drag). */
    fun touchCancel() {
        synchronized(liveTouchLock) {
            liveActive = false
            liveSegmentInFlight = false
            livePendingUp = false
            liveStroke = null
        }
    }

    private fun dispatchLive(stroke: GestureDescription.StrokeDescription): Boolean {
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        val callback = object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                continueLiveStroke()
            }

            override fun onCancelled(gestureDescription: GestureDescription?) {
                synchronized(liveTouchLock) {
                    liveActive = false
                    liveSegmentInFlight = false
                    liveStroke = null
                }
            }
        }
        return try {
            dispatchGesture(gesture, callback, null)
        } catch (e: Exception) {
            synchronized(liveTouchLock) {
                liveActive = false
                liveSegmentInFlight = false
                liveStroke = null
            }
            false
        }
    }

    /** Fires from a completed segment's callback, or immediately if none was in flight. */
    private fun continueLiveStroke() {
        val prev: GestureDescription.StrokeDescription?
        val fromX: Float
        val fromY: Float
        val toX: Float
        val toY: Float
        val finishing: Boolean
        synchronized(liveTouchLock) {
            if (!liveActive) {
                liveSegmentInFlight = false
                return
            }
            prev = liveStroke
            fromX = liveLastX
            fromY = liveLastY
            toX = liveTargetX
            toY = liveTargetY
            finishing = livePendingUp
            if (prev == null) {
                liveActive = false
                liveSegmentInFlight = false
                return
            }
            if (fromX == toX && fromY == toY && !finishing) {
                // Nothing moved since the last segment: idle until the next
                // touchMove/touchUp call kicks this off again.
                liveSegmentInFlight = false
                return
            }
        }
        val path = Path().apply {
            moveTo(fromX, fromY)
            if (fromX != toX || fromY != toY) {
                lineTo(toX, toY)
            }
        }
        val next = try {
            prev!!.continueStroke(path, 0, LIVE_SEGMENT_MS, !finishing)
        } catch (e: Exception) {
            synchronized(liveTouchLock) {
                liveActive = false
                liveSegmentInFlight = false
                liveStroke = null
            }
            return
        }
        synchronized(liveTouchLock) {
            liveStroke = next
            liveLastX = toX
            liveLastY = toY
            if (finishing) {
                liveActive = false
            }
        }
        val gesture = GestureDescription.Builder().addStroke(next).build()
        val callback = object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                if (!finishing) {
                    continueLiveStroke()
                } else {
                    synchronized(liveTouchLock) { liveStroke = null }
                }
            }

            override fun onCancelled(gestureDescription: GestureDescription?) {
                synchronized(liveTouchLock) {
                    liveActive = false
                    liveSegmentInFlight = false
                    liveStroke = null
                }
            }
        }
        try {
            dispatchGesture(gesture, callback, null)
        } catch (e: Exception) {
            synchronized(liveTouchLock) {
                liveActive = false
                liveSegmentInFlight = false
                liveStroke = null
            }
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
