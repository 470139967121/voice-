package com.shyden.shytalk

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import com.shyden.shytalk.core.util.Constants
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class ShyTalkApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val channel = NotificationChannel(
            Constants.ROOM_NOTIFICATION_CHANNEL_ID,
            "Voice Room",
            NotificationManager.IMPORTANCE_LOW
        ).apply { description = "Active voice room notification" }
        getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }
}
