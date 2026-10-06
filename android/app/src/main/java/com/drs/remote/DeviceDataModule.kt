package com.drs.remote

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream

/**
 * Device-side data operations for operator <-> device transfer beyond input:
 *   - saveToDownloads: write a file the operator pushed (base64) into the device
 *     Downloads collection (MediaStore on API 29+, app external dir below that).
 *   - notify: show a local notification for an operator message / delivered file.
 *
 * File bytes travel peer-to-peer over the WebRTC control channel (chunked by the
 * JS layer); this module only persists the reassembled bytes and alerts the user.
 */
class DeviceDataModule(private val reactCtx: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactCtx) {

    override fun getName(): String = "DeviceDataModule"

    companion object {
        private const val CHANNEL_ID = "drs_messages"
    }

    /**
     * Writes base64 bytes to the device Downloads as [name]. Returns the saved
     * location (a content:// uri on API 29+, or a file path on older devices).
     */
    @ReactMethod
    fun saveToDownloads(name: String, base64: String, mime: String, promise: Promise) {
        try {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            val safeName = name.ifBlank { "drs-file" }.replace('/', '_')
            val mimeType = mime.ifBlank { "application/octet-stream" }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = reactCtx.contentResolver
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, safeName)
                    put(MediaStore.Downloads.MIME_TYPE, mimeType)
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: throw IllegalStateException("could not create Downloads entry")
                resolver.openOutputStream(uri).use { out ->
                    out?.write(bytes) ?: throw IllegalStateException("no output stream")
                }
                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                promise.resolve(uri.toString())
            } else {
                @Suppress("DEPRECATION")
                val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                if (!dir.exists()) dir.mkdirs()
                val file = File(dir, safeName)
                FileOutputStream(file).use { it.write(bytes) }
                promise.resolve(file.absolutePath)
            }
        } catch (e: Exception) {
            promise.reject("save_failed", e)
        }
    }

    /** Posts a local notification (operator message or delivered file). */
    @ReactMethod
    fun notify(title: String, body: String, promise: Promise) {
        try {
            val mgr = reactCtx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val ch = NotificationChannel(
                    CHANNEL_ID,
                    "Remote messages",
                    NotificationManager.IMPORTANCE_DEFAULT,
                )
                mgr.createNotificationChannel(ch)
            }
            val notif = NotificationCompat.Builder(reactCtx, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_email)
                .setContentTitle(title.ifBlank { "Remote message" })
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .build()
            mgr.notify((System.currentTimeMillis() and 0xFFFFFF).toInt(), notif)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("notify_failed", e)
        }
    }
}
