package com.shyden.shytalk.data.remote

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.shyden.shytalk.MainActivity
import com.shyden.shytalk.R
import com.shyden.shytalk.core.util.Constants
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

class ShyTalkMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        val userId = FirebaseAuth.getInstance().currentUser?.uid ?: return
        CoroutineScope(Dispatchers.IO).launch {
            try {
                FirebaseFirestore.getInstance()
                    .collection("users")
                    .document(userId)
                    .update("fcmTokens", com.google.firebase.firestore.FieldValue.arrayUnion(token))
                    .await()
            } catch (_: Exception) {
                // Token save failed — will retry on next app launch
            }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)

        val data = message.data
        val type = data["type"] ?: return

        when (type) {
            "PM" -> handlePmNotification(data)
        }
    }

    private fun handlePmNotification(data: Map<String, String>) {
        val senderName = data["senderName"] ?: "Someone"
        val messageText = data["messageText"] ?: "New message"
        val otherUserId = data["senderId"] ?: return
        val showPreview = data["showPreview"]?.toBooleanStrictOrNull() ?: true

        ensureNotificationChannel()

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("navigateTo", "chat")
            putExtra("otherUserId", otherUserId)
        }
        val pendingIntent = PendingIntent.getActivity(
            this, otherUserId.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notificationText = if (showPreview) messageText else "New message"

        val notification = NotificationCompat.Builder(this, Constants.PM_NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(senderName)
            .setContentText(notificationText)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager?.notify(otherUserId.hashCode(), notification)
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                Constants.PM_NOTIFICATION_CHANNEL_ID,
                "Private Messages",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Notifications for private messages"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }
}
