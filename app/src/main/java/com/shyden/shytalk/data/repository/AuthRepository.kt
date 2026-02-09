package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.google.firebase.auth.FirebaseUser

interface AuthRepository {
    val currentUser: FirebaseUser?
    val isAuthenticated: Boolean

    suspend fun signInWithGoogleIdToken(idToken: String): Resource<FirebaseUser>
    fun signOut()
}
