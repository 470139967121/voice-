package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
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

    override suspend fun signInWithGoogleIdToken(idToken: String): Resource<FirebaseUser> = firebaseCall("Google sign in failed") {
        val credential = GoogleAuthProvider.getCredential(idToken, null)
        val result = auth.signInWithCredential(credential).await()
        result.user ?: throw Exception("Sign in failed: no user returned")
    }

    override fun signOut() {
        auth.signOut()
    }
}
