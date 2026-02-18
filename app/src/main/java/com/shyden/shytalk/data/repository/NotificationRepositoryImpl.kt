package com.shyden.shytalk.data.repository

import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import kotlinx.coroutines.tasks.await

class NotificationRepositoryImpl(
    private val firestore: FirebaseFirestore
) : NotificationRepository {

    override suspend fun saveFcmToken(userId: String, token: String): Resource<Unit> =
        firebaseCall("Failed to save FCM token") {
            firestore.collection("users").document(userId)
                .update("fcmTokens", FieldValue.arrayUnion(token))
                .await()
        }

    override suspend fun removeFcmToken(userId: String, token: String): Resource<Unit> =
        firebaseCall("Failed to remove FCM token") {
            firestore.collection("users").document(userId)
                .update("fcmTokens", FieldValue.arrayRemove(token))
                .await()
        }

    override suspend fun setPmNotificationsEnabled(userId: String, enabled: Boolean): Resource<Unit> =
        firebaseCall("Failed to update notification setting") {
            firestore.collection("users").document(userId)
                .update("pmNotificationsEnabled", enabled)
                .await()
        }

    override suspend fun getPmNotificationsEnabled(userId: String): Resource<Boolean> =
        firebaseCall("Failed to get notification setting") {
            val doc = firestore.collection("users").document(userId).get().await()
            doc.getBoolean("pmNotificationsEnabled") ?: true
        }
}
