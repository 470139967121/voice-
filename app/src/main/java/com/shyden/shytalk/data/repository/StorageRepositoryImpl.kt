package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.google.firebase.storage.FirebaseStorage
import kotlinx.coroutines.delay
import kotlinx.coroutines.tasks.await

class StorageRepositoryImpl(
    private val storage: FirebaseStorage
) : StorageRepository {

    override suspend fun uploadImage(userId: String, path: String, imageData: ByteArray): Resource<String> = firebaseCall("Failed to upload image") {
        val ref = storage.reference.child("$path/$userId/${System.currentTimeMillis()}.jpg")
        ref.putBytes(imageData).await()

        // Retry getDownloadUrl to handle Firebase Storage eventual consistency
        var lastException: Exception? = null
        for (attempt in 1..3) {
            try {
                return@firebaseCall ref.downloadUrl.await().toString()
            } catch (e: Exception) {
                lastException = e
                if (attempt < 3) delay(500L * attempt)
            }
        }
        throw (lastException ?: Exception("Failed to get download URL"))
    }

    override suspend fun deleteImageByUrl(url: String) {
        try {
            storage.getReferenceFromUrl(url).delete().await()
        } catch (_: Exception) {
            // Best-effort: ignore if file is already gone or URL is invalid
        }
    }
}
