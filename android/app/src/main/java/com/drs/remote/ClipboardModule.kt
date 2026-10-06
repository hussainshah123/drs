package com.drs.remote

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Bridge for syncing the device clipboard with the operator over the control
 * channel (operator -> agent set, agent -> operator get).
 *
 * Android 10+ (API 29) blocks clipboard READ from the background: getText only
 * returns data while the app holds focus or is the default IME. Writes are more
 * permissive. Both methods are therefore best-effort and resolve false rather
 * than throwing when the platform denies access.
 */
class ClipboardModule(private val reactCtx: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactCtx) {

    override fun getName(): String = "ClipboardModule"

    private fun manager(): ClipboardManager =
        reactCtx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

    @ReactMethod
    fun setText(text: String, promise: Promise) {
        try {
            manager().setPrimaryClip(ClipData.newPlainText("drs", text))
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun getText(promise: Promise) {
        try {
            val clip = manager().primaryClip
            val text = if (clip != null && clip.itemCount > 0) {
                clip.getItemAt(0).coerceToText(reactCtx).toString()
            } else {
                ""
            }
            promise.resolve(text)
        } catch (e: Exception) {
            promise.resolve("")
        }
    }
}
