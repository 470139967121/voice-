package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.google.firebase.Timestamp
import com.google.firebase.firestore.FieldPath
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout
import javax.inject.Inject

class UserRepositoryImpl @Inject constructor(
    private val firestore: FirebaseFirestore
) : UserRepository {

    private val usersCollection = firestore.collection("users")

    override suspend fun createOrUpdateUser(user: User): Resource<Unit> = firebaseCall("Failed to create/update user") {
        try {
            withTimeout(10_000L) {
                usersCollection.document(user.uid).set(user.toMap()).await()
            }
        } catch (_: TimeoutCancellationException) {
            throw Exception("Server not responding — please try again")
        }
    }

    override suspend fun getUser(userId: String): Resource<User> = firebaseCall("Failed to get user") {
        val doc = usersCollection.document(userId).get().await()
        if (!doc.exists()) throw Exception("User not found")
        val data = doc.data ?: throw Exception("User data is null")
        User.fromMap(data, doc.id)
    }

    override suspend fun userExists(userId: String): Resource<Boolean> = firebaseCall("Failed to check user existence") {
        val doc = usersCollection.document(userId).get().await()
        doc.exists()
    }

    override suspend fun updateDisplayName(userId: String, displayName: String): Resource<Unit> = firebaseCall("Failed to update display name") {
        usersCollection.document(userId).update("displayName", displayName).await()
    }

    override suspend fun updateAvatar(userId: String, avatarUrl: String): Resource<Unit> = firebaseCall("Failed to update avatar") {
        usersCollection.document(userId).update("avatarUrl", avatarUrl).await()
    }

    override suspend fun updateLastSeen(userId: String): Resource<Unit> = firebaseCall("Failed to update last seen") {
        usersCollection.document(userId).update("lastSeenAt", Timestamp.now()).await()
    }

    override suspend fun updateProfile(userId: String, fields: Map<String, Any?>): Resource<Unit> = firebaseCall("Failed to update profile") {
        usersCollection.document(userId).update(fields).await()
    }

    override suspend fun generateUniqueId(userId: String): Resource<Long> = firebaseCall("Failed to generate unique ID") {
        val counterRef = firestore.collection("counters").document("uniqueId")
        firestore.runTransaction { transaction ->
            val snapshot = transaction.get(counterRef)
            val currentId = if (snapshot.exists()) {
                snapshot.getLong("nextId") ?: 10000000L
            } else {
                10000000L
            }
            transaction.set(counterRef, mapOf("nextId" to currentId + 1))
            transaction.update(usersCollection.document(userId), "uniqueId", currentId)
            currentId
        }.await()
    }

    override suspend fun blockUser(userId: String, blockedUserId: String): Resource<Unit> = firebaseCall("Failed to block user") {
        usersCollection.document(userId)
            .update("blockedUserIds", FieldValue.arrayUnion(blockedUserId)).await()
    }

    override suspend fun unblockUser(userId: String, blockedUserId: String): Resource<Unit> = firebaseCall("Failed to unblock user") {
        usersCollection.document(userId)
            .update("blockedUserIds", FieldValue.arrayRemove(blockedUserId)).await()
    }

    override suspend fun getBlockedUserIds(userId: String): Resource<Set<String>> = firebaseCall("Failed to get blocked users") {
        val doc = usersCollection.document(userId).get().await()
        if (!doc.exists()) return@firebaseCall emptySet()
        val data = doc.data ?: return@firebaseCall emptySet()
        (data["blockedUserIds"] as? List<*>)?.filterIsInstance<String>()?.toSet() ?: emptySet()
    }

    override suspend fun followUser(currentUserId: String, targetUserId: String): Resource<Unit> =
        firebaseCall("Failed to follow user") {
            val batch = firestore.batch()
            batch.update(usersCollection.document(currentUserId), "followingIds", FieldValue.arrayUnion(targetUserId))
            batch.update(usersCollection.document(targetUserId), "followerIds", FieldValue.arrayUnion(currentUserId))
            batch.commit().await()
        }

    override suspend fun unfollowUser(currentUserId: String, targetUserId: String): Resource<Unit> =
        firebaseCall("Failed to unfollow user") {
            val batch = firestore.batch()
            batch.update(usersCollection.document(currentUserId), "followingIds", FieldValue.arrayRemove(targetUserId))
            batch.update(usersCollection.document(targetUserId), "followerIds", FieldValue.arrayRemove(currentUserId))
            batch.commit().await()
        }

    override suspend fun getUsers(userIds: List<String>): Resource<List<User>> =
        firebaseCall("Failed to get users") {
            if (userIds.isEmpty()) return@firebaseCall emptyList()
            userIds.chunked(30).flatMap { chunk ->
                val snapshot = usersCollection.whereIn(FieldPath.documentId(), chunk).get().await()
                snapshot.documents.mapNotNull { doc ->
                    doc.data?.let { User.fromMap(it, doc.id) }
                }
            }
        }
}
