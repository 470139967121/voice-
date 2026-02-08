package com.example.shytalk.data.repository

import com.example.shytalk.core.util.Resource
import com.google.firebase.storage.FirebaseStorage
import kotlinx.coroutines.tasks.await
import javax.inject.Inject

class StorageRepositoryImpl @Inject constructor(
    private val storage: FirebaseStorage
) : StorageRepository {

    override suspend fun uploadImage(userId: String, path: String, imageData: ByteArray): Resource<String> {
        return try {
            val ref = storage.reference.child("$path/$userId/${System.currentTimeMillis()}.jpg")
            ref.putBytes(imageData).await()
            val downloadUrl = ref.downloadUrl.await().toString()
            Resource.Success(downloadUrl)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to upload image", e)
        }
    }
}
