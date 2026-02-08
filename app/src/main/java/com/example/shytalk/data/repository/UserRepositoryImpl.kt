package com.example.shytalk.data.repository

import com.example.shytalk.core.model.User
import com.example.shytalk.core.util.Resource
import com.google.firebase.Timestamp
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.tasks.await
import javax.inject.Inject

class UserRepositoryImpl @Inject constructor(
    private val firestore: FirebaseFirestore
) : UserRepository {

    private val usersCollection = firestore.collection("users")

    override suspend fun createOrUpdateUser(user: User): Resource<Unit> {
        return try {
            usersCollection.document(user.uid).set(user.toMap()).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to create/update user", e)
        }
    }

    override suspend fun getUser(userId: String): Resource<User> {
        return try {
            val doc = usersCollection.document(userId).get().await()
            if (doc.exists()) {
                val data = doc.data ?: return Resource.Error("User data is null")
                Resource.Success(
                    User(
                        uid = doc.id,
                        displayName = data["displayName"] as? String ?: "",
                        avatarUrl = data["avatarUrl"] as? String,
                        profilePhotoUrl = data["profilePhotoUrl"] as? String,
                        coverPhotoUrl = data["coverPhotoUrl"] as? String,
                        description = data["description"] as? String,
                        nationality = data["nationality"] as? String,
                        uniqueId = (data["uniqueId"] as? Long) ?: 0L,
                        blockedUserIds = (data["blockedUserIds"] as? List<*>)
                            ?.filterIsInstance<String>() ?: emptyList(),
                        phoneNumber = data["phoneNumber"] as? String,
                        email = data["email"] as? String,
                        createdAt = data["createdAt"] as? Timestamp ?: Timestamp.now(),
                        lastSeenAt = data["lastSeenAt"] as? Timestamp ?: Timestamp.now()
                    )
                )
            } else {
                Resource.Error("User not found")
            }
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to get user", e)
        }
    }

    override suspend fun userExists(userId: String): Resource<Boolean> {
        return try {
            val doc = usersCollection.document(userId).get().await()
            Resource.Success(doc.exists())
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to check user existence", e)
        }
    }

    override suspend fun updateDisplayName(userId: String, displayName: String): Resource<Unit> {
        return try {
            usersCollection.document(userId).update("displayName", displayName).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to update display name", e)
        }
    }

    override suspend fun updateAvatar(userId: String, avatarUrl: String): Resource<Unit> {
        return try {
            usersCollection.document(userId).update("avatarUrl", avatarUrl).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to update avatar", e)
        }
    }

    override suspend fun updateLastSeen(userId: String): Resource<Unit> {
        return try {
            usersCollection.document(userId).update("lastSeenAt", Timestamp.now()).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to update last seen", e)
        }
    }

    override suspend fun updateProfile(userId: String, fields: Map<String, Any?>): Resource<Unit> {
        return try {
            usersCollection.document(userId).update(fields).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to update profile", e)
        }
    }

    override suspend fun generateUniqueId(userId: String): Resource<Long> {
        return try {
            val counterRef = firestore.collection("counters").document("uniqueId")
            val newId = firestore.runTransaction { transaction ->
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
            Resource.Success(newId)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to generate unique ID", e)
        }
    }

    override suspend fun blockUser(userId: String, blockedUserId: String): Resource<Unit> {
        return try {
            usersCollection.document(userId)
                .update("blockedUserIds", FieldValue.arrayUnion(blockedUserId)).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to block user", e)
        }
    }

    override suspend fun unblockUser(userId: String, blockedUserId: String): Resource<Unit> {
        return try {
            usersCollection.document(userId)
                .update("blockedUserIds", FieldValue.arrayRemove(blockedUserId)).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to unblock user", e)
        }
    }

    override suspend fun getBlockedUserIds(userId: String): Resource<List<String>> {
        return try {
            val doc = usersCollection.document(userId).get().await()
            if (doc.exists()) {
                val data = doc.data ?: return Resource.Success(emptyList())
                val blocked = (data["blockedUserIds"] as? List<*>)
                    ?.filterIsInstance<String>() ?: emptyList()
                Resource.Success(blocked)
            } else {
                Resource.Success(emptyList())
            }
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to get blocked users", e)
        }
    }
}
