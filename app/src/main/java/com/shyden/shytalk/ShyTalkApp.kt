package com.shyden.shytalk

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.disk.DiskCache
import coil.memory.MemoryCache
import com.shyden.shytalk.core.util.Constants
import dagger.hilt.android.HiltAndroidApp
import okhttp3.Cache
import okhttp3.OkHttpClient

@HiltAndroidApp
class ShyTalkApp : Application(), ImageLoaderFactory {

    override fun newImageLoader(): ImageLoader {
        return ImageLoader.Builder(this)
            .memoryCache {
                MemoryCache.Builder(this)
                    .maxSizePercent(0.25)
                    .build()
            }
            .diskCache {
                DiskCache.Builder()
                    .directory(cacheDir.resolve("image_cache"))
                    .maxSizeBytes(50L * 1024 * 1024)
                    .build()
            }
            .okHttpClient {
                OkHttpClient.Builder()
                    .cache(Cache(cacheDir.resolve("http_cache"), 25L * 1024 * 1024))
                    .addNetworkInterceptor { chain ->
                        chain.proceed(chain.request()).newBuilder()
                            .removeHeader("Pragma")
                            .header("Cache-Control", "public, max-age=86400, immutable")
                            .build()
                    }
                    .build()
            }
            .crossfade(true)
            .build()
    }

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
