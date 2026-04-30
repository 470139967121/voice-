package com.shyden.shytalk.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.data.remote.WorkerApiClient
import kotlinx.coroutines.tasks.await
import org.json.JSONObject

class NotificationRepositoryImpl(
    private val api: WorkerApiClient,
    private val firestore: FirebaseFirestore,
) : NotificationRepository {
    override suspend fun saveFcmToken(
        userId: String,
        token: String,
    ): Resource<Unit> =
        firebaseCall("Failed to save FCM token") {
            api.post(
                "/api/notifications/token",
                JSONObject().apply {
                    put("token", token)
                },
            )
            Unit
        }

    override suspend fun removeFcmToken(
        userId: String,
        token: String,
    ): Resource<Unit> =
        firebaseCall("Failed to remove FCM token") {
            api.delete(
                "/api/notifications/token",
                JSONObject().apply {
                    put("token", token)
                },
            )
            Unit
        }

    // Routed through the Express API (PATCH /api/notifications/settings)
    // rather than a direct Firestore write so the field is rate-limited
    // (writeLimiter) and audited consistently with other settings updates.
    // The Firestore rule blocks direct client writes to pmNotificationsEnabled.
    override suspend fun setPmNotificationsEnabled(
        userId: String,
        enabled: Boolean,
    ): Resource<Unit> =
        firebaseCall("Failed to update notification setting") {
            api.patch(
                "/api/notifications/settings",
                JSONObject().apply {
                    put("pmNotificationsEnabled", enabled)
                },
            )
            Unit
        }

    override suspend fun getPmNotificationsEnabled(userId: String): Resource<Boolean> =
        firebaseCall("Failed to get notification setting") {
            val doc = firestore.document("users/$userId").get().await()
            val data = doc.data ?: return@firebaseCall true
            (data["pmNotificationsEnabled"] as? Boolean) ?: true
        }
}
