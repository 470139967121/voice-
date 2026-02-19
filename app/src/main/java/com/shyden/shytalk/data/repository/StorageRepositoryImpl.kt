package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.google.firebase.storage.FirebaseStorage
import com.google.firebase.storage.StorageMetadata
import kotlinx.coroutines.delay
import kotlinx.coroutines.tasks.await

class StorageRepositoryImpl(
    private val storage: FirebaseStorage
) : StorageRepository {

    override suspend fun uploadImage(userId: String, path: String, imageData: ByteArray, contentType: String): Resource<String> = firebaseCall("Failed to upload image") {
        val extension = when {
            contentType.startsWith("video/") -> contentType.substringAfter("video/").let { if (it == "quicktime") "mov" else it }
            contentType == "image/png" -> "png"
            contentType == "image/webp" -> "webp"
            else -> "jpg"
        }
        val refPath = "$path/$userId/${System.currentTimeMillis()}.$extension"
        val ref = storage.reference.child(refPath)
        val metadata = StorageMetadata.Builder().setContentType(contentType).build()
        ref.putBytes(imageData, metadata).await()

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
