package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.google.firebase.storage.FirebaseStorage
import kotlinx.coroutines.delay
import kotlinx.coroutines.tasks.await
import javax.inject.Inject

class StorageRepositoryImpl @Inject constructor(
    private val storage: FirebaseStorage
) : StorageRepository {

    override suspend fun uploadImage(userId: String, path: String, imageData: ByteArray): Resource<String> {
        return try {
            val ref = storage.reference.child("$path/$userId/${System.currentTimeMillis()}.jpg")
            ref.putBytes(imageData).await()

            // Retry getDownloadUrl to handle Firebase Storage eventual consistency
            var downloadUrl: String? = null
            var lastException: Exception? = null
            for (attempt in 1..3) {
                try {
                    downloadUrl = ref.downloadUrl.await().toString()
                    break
                } catch (e: Exception) {
                    lastException = e
                    if (attempt < 3) delay(500L * attempt)
                }
            }

            if (downloadUrl != null) {
                Resource.Success(downloadUrl)
            } else {
                Resource.Error(lastException?.message ?: "Failed to get download URL", lastException)
            }
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to upload image", e)
        }
    }
}
