package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.tasks.await
import javax.inject.Inject

class DeviceRepositoryImpl @Inject constructor(
    private val firestore: FirebaseFirestore
) : DeviceRepository {

    private val deviceBindingsCollection = firestore.collection("deviceBindings")

    override suspend fun getDeviceBinding(deviceId: String): Resource<String?> {
        return try {
            val doc = deviceBindingsCollection.document(deviceId).get().await()
            if (doc.exists()) {
                val userId = doc.getString("userId")
                Resource.Success(userId)
            } else {
                Resource.Success(null)
            }
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to check device binding", e)
        }
    }

    override suspend fun bindDevice(deviceId: String, userId: String): Resource<Unit> {
        return try {
            deviceBindingsCollection.document(deviceId).set(
                mapOf(
                    "userId" to userId,
                    "boundAt" to FieldValue.serverTimestamp()
                )
            ).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to bind device", e)
        }
    }
}
