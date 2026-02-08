package com.example.shytalk.data.repository

import com.example.shytalk.core.util.Resource

interface StorageRepository {
    suspend fun uploadImage(userId: String, path: String, imageData: ByteArray): Resource<String>
}
