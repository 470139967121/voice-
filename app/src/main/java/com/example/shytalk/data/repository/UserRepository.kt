package com.example.shytalk.data.repository

import com.example.shytalk.core.model.User
import com.example.shytalk.core.util.Resource

interface UserRepository {
    suspend fun createOrUpdateUser(user: User): Resource<Unit>
    suspend fun getUser(userId: String): Resource<User>
    suspend fun userExists(userId: String): Resource<Boolean>
    suspend fun updateDisplayName(userId: String, displayName: String): Resource<Unit>
    suspend fun updateAvatar(userId: String, avatarUrl: String): Resource<Unit>
    suspend fun updateLastSeen(userId: String): Resource<Unit>
}
