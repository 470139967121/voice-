package com.shyden.shytalk.data.remote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.shyden.shytalk.R
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.koin.android.ext.android.inject

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

    private val pmRepository: PrivateMessageRepository by inject()
    private val authRepository: AuthRepository by inject()
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var conversationsJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, createNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val userId = authRepository.currentUserId
        if (userId != null) {
            conversationsJob?.cancel()
            conversationsJob = serviceScope.launch {
                pmRepository.getConversations(userId).collect { /* keep listener alive */ }
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        conversationsJob?.cancel()
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Message Sync",
            NotificationManager.IMPORTANCE_NONE
        ).apply {
            description = "Keeps messages in sync"
            setShowBadge(false)
            enableLights(false)
            enableVibration(false)
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    private fun createNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .setSilent(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_DEFERRED)
            .build()
    }
}
