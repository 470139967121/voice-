package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource

interface UserRepository {
    suspend fun createOrUpdateUser(user: User): Resource<Unit>
    suspend fun getUser(userId: String): Resource<User>
    suspend fun userExists(userId: String): Resource<Boolean>
    suspend fun updateDisplayName(userId: String, displayName: String): Resource<Unit>
    suspend fun updateAvatar(userId: String, avatarUrl: String): Resource<Unit>
    suspend fun updateLastSeen(userId: String): Resource<Unit>
    suspend fun updateProfile(userId: String, fields: Map<String, Any?>): Resource<Unit>
    suspend fun generateUniqueId(userId: String): Resource<Long>
    suspend fun blockUser(userId: String, blockedUserId: String): Resource<Unit>
    suspend fun unblockUser(userId: String, blockedUserId: String): Resource<Unit>
    suspend fun getBlockedUserIds(userId: String): Resource<Set<String>>
    suspend fun followUser(currentUserId: String, targetUserId: String): Resource<Unit>
    suspend fun unfollowUser(currentUserId: String, targetUserId: String): Resource<Unit>
    suspend fun getUsers(userIds: List<String>): Resource<List<User>>
}
