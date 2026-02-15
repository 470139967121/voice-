package com.shyden.shytalk.data.remote

import android.content.Context
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.BuildConfig
import com.shyden.shytalk.core.util.Resource
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout

class AndroidAppConfigService(
    private val context: Context,
    private val firestore: FirebaseFirestore
) : AppConfigService {

    override val currentVersionCode: Int = BuildConfig.VERSION_CODE

    override suspend fun getLatestVersionInfo(): Resource<Pair<Int, String>> {
        return try {
            val doc = withTimeout(10_000L) {
                firestore.collection("config").document("app").get().await()
            }
            val latestVersionCode = (doc.getLong("latestVersionCode") ?: 0).toInt()
            val latestVersionName = doc.getString("latestVersionName") ?: ""
            Resource.Success(latestVersionCode to latestVersionName)
        } catch (e: Exception) {
            Resource.Error("Failed to check for updates")
        }
    }

    override fun clearAppCache() {
        context.cacheDir.listFiles()?.forEach { file -> file.deleteRecursively() }
    }
}
