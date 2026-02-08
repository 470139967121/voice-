package com.example.shytalk.data.repository

import android.net.Uri
import com.example.shytalk.core.util.Resource

interface StorageRepository {
    suspend fun uploadImage(userId: String, path: String, imageUri: Uri): Resource<String>
}
