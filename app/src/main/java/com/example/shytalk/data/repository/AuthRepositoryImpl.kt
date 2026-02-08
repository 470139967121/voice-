package com.example.shytalk.data.repository

import com.example.shytalk.core.util.Resource
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import kotlinx.coroutines.tasks.await
import javax.inject.Inject

class AuthRepositoryImpl @Inject constructor(
    private val auth: FirebaseAuth
) : AuthRepository {

    override val currentUser: FirebaseUser?
        get() = auth.currentUser

    override val isAuthenticated: Boolean
        get() = auth.currentUser != null

    override suspend fun signInWithGoogleIdToken(idToken: String): Resource<FirebaseUser> {
        return try {
            val credential = GoogleAuthProvider.getCredential(idToken, null)
            val result = auth.signInWithCredential(credential).await()
            result.user?.let {
                Resource.Success(it)
            } ?: Resource.Error("Sign in failed: no user returned")
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Google sign in failed", e)
        }
    }

    override fun signOut() {
        auth.signOut()
    }
}
