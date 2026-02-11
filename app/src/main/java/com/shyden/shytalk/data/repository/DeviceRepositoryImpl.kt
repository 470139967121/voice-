package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.tasks.await
import javax.inject.Inject

class DeviceRepositoryImpl @Inject constructor(
    private val firestore: FirebaseFirestore
) : DeviceRepository {

    private val deviceBindingsCollection = firestore.collection("deviceBindings")

    override suspend fun getDeviceBinding(deviceId: String): Resource<String?> = firebaseCall("Failed to check device binding") {
        val doc = deviceBindingsCollection.document(deviceId).get().await()
        if (doc.exists()) doc.getString("userId") else null
    }

    override suspend fun bindDevice(deviceId: String, userId: String): Resource<Unit> = firebaseCall("Failed to bind device") {
        deviceBindingsCollection.document(deviceId).set(
            mapOf(
                "userId" to userId,
                "boundAt" to FieldValue.serverTimestamp()
            )
        ).await()
    }
}
