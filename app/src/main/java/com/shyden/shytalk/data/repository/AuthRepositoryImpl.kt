package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import kotlinx.coroutines.tasks.await

class AuthRepositoryImpl(
    private val auth: FirebaseAuth
) : AuthRepository {

    override val currentUserId: String?
        get() = auth.currentUser?.uid

    override val isAuthenticated: Boolean
        get() = auth.currentUser != null

    override val currentUserEmail: String?
        get() = auth.currentUser?.email

    override suspend fun signInWithGoogleIdToken(idToken: String): Resource<String> = firebaseCall("Google sign in failed") {
        val credential = GoogleAuthProvider.getCredential(idToken, null)
        val result = auth.signInWithCredential(credential).await()
        result.user?.uid ?: throw Exception("Sign in failed: no user returned")
    }

    override suspend fun signInWithAppleIdToken(idToken: String, rawNonce: String): Resource<String> {
        return Resource.Error("Apple Sign-In is not supported on Android")
    }

    override fun signOut() {
        auth.signOut()
    }
}
