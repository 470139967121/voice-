package com.shyden.shytalk.data.remote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.shyden.shytalk.R

/**
 * Foreground service that keeps Firestore snapshot listeners active
 * for PM conversations even when the app is in the background.
 * Uses FOREGROUND_SERVICE_TYPE_DATA_SYNC with minimum priority.
 */
class PmSyncService : Service() {

    companion object {
        const val CHANNEL_ID = "pm_sync_channel"
        const val NOTIFICATION_ID = 2001
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, createNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Message Sync",
            NotificationManager.IMPORTANCE_MIN
        ).apply {
            description = "Keeps messages in sync"
            setShowBadge(false)
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    private fun createNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("ShyTalk")
            .setContentText("Syncing messages")
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .build()
    }
}
