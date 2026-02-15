package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource

interface AuthRepository {
    val currentUserId: String?
    val isAuthenticated: Boolean
    val currentUserEmail: String?

    suspend fun signInWithGoogleIdToken(idToken: String): Resource<String>
    suspend fun signInWithAppleIdToken(idToken: String, rawNonce: String): Resource<String>
    fun signOut()
}
