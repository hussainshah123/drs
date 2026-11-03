package com.drs.remote

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.util.Log
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

        private const val TAG = "DrsAccessibility"

        /**
         * Duration of each live-touch segment, including the initial dwell.
         * Reverted from an elapsed-wall-clock-time version that broke control
         * entirely on-device (root cause not yet confirmed by logs — this is
         * the proven-working value from before that change). See
         * continueLiveStroke()'s log output if retuning this again.
         */
        private const val LIVE_SEGMENT_MS = 16L

        /**
         * How long armCaptureConsentAutoAccept() stays armed. The dialog is
         * Android's own system prompt (MediaProjectionManager), not ours — it
         * normally appears within a second of requesting capture, but a slow
         * OEM permission-controller process can take longer.
         */
        private const val CAPTURE_CONSENT_ARM_TIMEOUT_MS = 15_000L

        /**
         * Fallback button labels for the screen-capture system dialog when its
         * accept button isn't android:id/button1 (seen on some OEM skins).
         * Deliberately narrow — this only runs while armed, i.e. right after
         * this app itself requested capture, so a false match has to be a
         * same-moment, same-foreground-window coincidence.
         */
        private val CAPTURE_ACCEPT_LABELS =
            setOf("start now", "start", "allow", "share now", "begin now", "cast")

        /**
         * Android 14+'s screen-share dialog adds a mode picker (AOSP SystemUI,
         * resource-id screen_share_mode_options) defaulted to "Share one app".
         * Confirming through with that selected never starts our capture — it
         * waits on an app pick instead — which showed up as a NotAllowedError
         * right after the prompt and the dialog reappearing on every retry.
         */
        private const val MODE_SPINNER_ID = "com.android.systemui:id/screen_share_mode_options"
        private val ENTIRE_SCREEN_LABELS =
            setOf("share entire screen", "entire screen", "whole screen", "share full screen")
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

    @Volatile
    private var captureConsentArmed = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private var disarmCaptureConsent: Runnable? = null

    /**
     * Arms a short window in which this service will auto-tap the device's
     * own screen-capture system dialog (MediaProjectionManager) — the "Start
     * now" prompt Android requires before any app can start screen capture,
     * including on every reconnect on Android 14+ (OS policy, not something
     * app code can skip). Mirrors config.autoShareScreen/autoAcceptConsent's
     * existing "fully managed, unattended" intent: those already auto-accept
     * this app's own consent step; this extends the same policy to the OS's
     * prompt so an enrolled, managed device doesn't sit waiting for someone
     * to physically tap a dialog it can't see (screen off/locked, unattended).
     * Call this immediately before requesting capture (screenShare.ts's
     * getDisplayMedia); it self-disarms after one click or after the timeout.
     */
    fun armCaptureConsentAutoAccept() {
        captureConsentArmed = true
        disarmCaptureConsent?.let { mainHandler.removeCallbacks(it) }
        val r = Runnable { captureConsentArmed = false }
        disarmCaptureConsent = r
        mainHandler.postDelayed(r, CAPTURE_CONSENT_ARM_TIMEOUT_MS)
        // The dialog may already be on screen by the time the bridge call
        // lands here (race with the native getDisplayMedia call) — try once
        // right away instead of waiting for the next window-state event.
        if (tryAcceptCaptureDialog()) {
            captureConsentArmed = false
            disarmCaptureConsent?.let { mainHandler.removeCallbacks(it) }
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (!captureConsentArmed) {
            return
        }
        val type = event?.eventType
        if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
            type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
        ) {
            if (tryAcceptCaptureDialog()) {
                captureConsentArmed = false
                disarmCaptureConsent?.let { mainHandler.removeCallbacks(it) }
            }
        }
    }

    override fun onInterrupt() {}

    /**
     * Drives the capture dialog one step closer to accepted and reports
     * whether that step was the final confirm (only then should the caller
     * disarm) — getting there can take a couple of steps (open the mode
     * picker, pick "entire screen", then confirm), each one driven by the
     * next onAccessibilityEvent as the UI updates.
     */
    private fun tryAcceptCaptureDialog(): Boolean {
        val root = rootInActiveWindow ?: return false

        // The mode picker's option list, when open, is a ListView whose rows
        // use android:id/text1 — require that id so this only ever matches an
        // open list row, never the picker's own closed-state label (same
        // text, but no id there), which would tap-reopen it forever.
        val openOption = findByTextAndId(root, ENTIRE_SCREEN_LABELS, "android:id/text1")
        if (openOption != null) {
            // Reported non-clickable in the accessibility tree (it's an
            // AdapterView row, selected via touch, not a plain click target),
            // so tap its on-screen position directly rather than
            // performAction(CLICK), which doesn't register a selection here.
            tapNodeCenter(openOption)
            return false
        }

        val spinner = findByResourceId(root, MODE_SPINNER_ID)
        if (spinner != null) {
            val current = firstText(spinner)?.trim()?.lowercase() ?: ""
            if (current !in ENTIRE_SCREEN_LABELS) {
                // Still on the wrong default — open the picker; the next event
                // (its option list appearing) is handled by the branch above.
                if (!spinner.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                    tapNodeCenter(spinner)
                }
                return false
            }
        }

        // No mode picker (older, single-step dialog) or it already reads
        // "entire screen" — safe to confirm now, whatever this button is
        // labeled ("Start now", "Share screen", ...).
        val target = findClickableByResourceId(root, "android:id/button1")
            ?: findClickableByText(root, CAPTURE_ACCEPT_LABELS)
            ?: return false
        val clicked = target.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        if (clicked) {
            Log.i(TAG, "auto-accepted the screen-capture system prompt")
        }
        return clicked
    }

    private fun tapNodeCenter(node: AccessibilityNodeInfo): Boolean {
        val bounds = android.graphics.Rect()
        node.getBoundsInScreen(bounds)
        val path = Path().apply { moveTo(bounds.exactCenterX(), bounds.exactCenterY()) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 1)
        return dispatch(GestureDescription.Builder().addStroke(stroke).build())
    }

    /** First non-blank text found in this node or its descendants (depth-first). */
    private fun firstText(node: AccessibilityNodeInfo?): String? {
        if (node == null) {
            return null
        }
        val text = node.text?.toString()
        if (!text.isNullOrBlank()) {
            return text
        }
        for (i in 0 until node.childCount) {
            val found = firstText(node.getChild(i))
            if (found != null) {
                return found
            }
        }
        return null
    }

    private fun findByResourceId(node: AccessibilityNodeInfo?, resourceId: String): AccessibilityNodeInfo? {
        if (node == null) {
            return null
        }
        if (node.viewIdResourceName == resourceId) {
            return node
        }
        for (i in 0 until node.childCount) {
            val found = findByResourceId(node.getChild(i), resourceId)
            if (found != null) {
                return found
            }
        }
        return null
    }

    private fun findByTextAndId(node: AccessibilityNodeInfo?, labels: Set<String>, resourceId: String): AccessibilityNodeInfo? {
        if (node == null) {
            return null
        }
        val text = node.text?.toString()?.trim()?.lowercase()
        if (node.viewIdResourceName == resourceId && text != null && labels.contains(text)) {
            return node
        }
        for (i in 0 until node.childCount) {
            val found = findByTextAndId(node.getChild(i), labels, resourceId)
            if (found != null) {
                return found
            }
        }
        return null
    }

    private fun findClickableByResourceId(node: AccessibilityNodeInfo?, resourceId: String): AccessibilityNodeInfo? {
        if (node == null) {
            return null
        }
        if (node.isClickable && node.viewIdResourceName == resourceId) {
            return node
        }
        for (i in 0 until node.childCount) {
            val found = findClickableByResourceId(node.getChild(i), resourceId)
            if (found != null) {
                return found
            }
        }
        return null
    }

    private fun findClickableByText(node: AccessibilityNodeInfo?, labels: Set<String>): AccessibilityNodeInfo? {
        if (node == null) {
            return null
        }
        val text = node.text?.toString()?.trim()?.lowercase()
        if (node.isClickable && text != null && labels.contains(text)) {
            return node
        }
        for (i in 0 until node.childCount) {
            val found = findClickableByText(node.getChild(i), labels)
            if (found != null) {
                return found
            }
        }
        return null
    }

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
    // Counts consecutive system cancellations within one drag, so an
    // auto-restart loop (see continueLiveStroke's onCancelled) can give up
    // instead of retrying forever on a device that drops every gesture.
    private var liveCancelStreak = 0

    private fun liveTouchSupported(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O

    /** Starts a live touch at (nx,ny). Returns false (caller should fall back to tap/swipe) pre-API 26 or on failure. */
    fun touchDown(nx: Double, ny: Double): Boolean {
        if (!liveTouchSupported()) {
            return false
        }
        liveCancelStreak = 0
        val (x, y) = px(nx, ny)
        return startLiveTouchAtPx(x, y)
    }

    /** Starts a live touch at a pixel position — used by touchDown, and to
     * restart in place after continueLiveStroke's onCancelled mid-drag. */
    private fun startLiveTouchAtPx(x: Float, y: Float): Boolean {
        val path = Path().apply { moveTo(x, y) }
        // A short initial dwell so the OS registers a real ACTION_DOWN before
        // any movement begins — too short and some devices drop it.
        val stroke = GestureDescription.StrokeDescription(path, 0, LIVE_SEGMENT_MS, true)
        synchronized(liveTouchLock) {
            liveLastX = x
            liveLastY = y
            liveTargetX = x
            liveTargetY = y
            livePendingUp = false
            liveActive = true
            liveSegmentInFlight = true
            // Set together with the other state, before dispatch, so a
            // same-thread-reentrant or unexpectedly-fast callback can never
            // observe liveActive=true with liveStroke still null.
            liveStroke = stroke
        }
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
                Log.w(TAG, "live touch: initial dispatch cancelled by the system")
                synchronized(liveTouchLock) {
                    liveActive = false
                    liveSegmentInFlight = false
                    liveStroke = null
                }
            }
        }
        val accepted = try {
            dispatchGesture(gesture, callback, null)
        } catch (e: Exception) {
            Log.w(TAG, "live touch: initial dispatchGesture threw", e)
            false
        }
        if (!accepted) {
            // Rejected synchronously (e.g. another gesture already in
            // flight) — the callback above will never fire for this attempt,
            // so state must be cleared here or every later touchMove/touchUp
            // would wait forever for a segment that was never accepted.
            Log.w(TAG, "live touch: initial dispatchGesture rejected")
            synchronized(liveTouchLock) {
                liveActive = false
                liveSegmentInFlight = false
                liveStroke = null
            }
        }
        return accepted
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
            Log.w(TAG, "live touch: continueStroke threw", e)
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
                liveCancelStreak = 0
                if (!finishing) {
                    continueLiveStroke()
                } else {
                    synchronized(liveTouchLock) {
                        liveStroke = null
                        liveSegmentInFlight = false
                    }
                }
            }

            override fun onCancelled(gestureDescription: GestureDescription?) {
                synchronized(liveTouchLock) {
                    liveActive = false
                    liveSegmentInFlight = false
                    liveStroke = null
                }
                // Confirmed on-device: the system cancels an in-progress
                // continueStroke chain intermittently under load, with no
                // native way to resume the SAME stroke — without this, the
                // operator's drag simply stops responding (touchMove returns
                // false while !liveActive) until the next mouse-up starts a
                // fresh gesture. If the operator is still mid-drag (!finishing)
                // and we haven't just been cancelled repeatedly, re-press at
                // the last target so the drag keeps tracking instead of
                // freezing — a few restarts in a row means this device can't
                // sustain it at all, so stop trying rather than loop forever.
                if (finishing) {
                    Log.w(TAG, "live touch: continuation cancelled by the system")
                    return
                }
                liveCancelStreak++
                if (liveCancelStreak > 5) {
                    Log.w(TAG, "live touch: cancelled repeatedly, giving up on this drag")
                    return
                }
                Log.w(TAG, "live touch: continuation cancelled by the system — restarting at last target")
                startLiveTouchAtPx(toX, toY)
            }
        }
        val accepted = try {
            dispatchGesture(gesture, callback, null)
        } catch (e: Exception) {
            Log.w(TAG, "live touch: continuation dispatchGesture threw", e)
            false
        }
        if (!accepted) {
            Log.w(TAG, "live touch: continuation dispatchGesture rejected")
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
