package com.example.shytalk.data.repository

import android.app.Activity
import com.example.shytalk.core.util.Resource
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.auth.PhoneAuthCredential
import com.google.firebase.auth.PhoneAuthOptions
import com.google.firebase.auth.PhoneAuthProvider
import kotlinx.coroutines.tasks.await
import java.util.concurrent.TimeUnit
import javax.inject.Inject

class AuthRepositoryImpl @Inject constructor(
    private val auth: FirebaseAuth
) : AuthRepository {

    override val currentUser: FirebaseUser?
        get() = auth.currentUser

    override val isAuthenticated: Boolean
        get() = auth.currentUser != null

    override fun sendVerificationCode(
        phoneNumber: String,
        activity: Activity,
        callbacks: PhoneAuthProvider.OnVerificationStateChangedCallbacks
    ) {
        val options = PhoneAuthOptions.newBuilder(auth)
            .setPhoneNumber(phoneNumber)
            .setTimeout(60L, TimeUnit.SECONDS)
            .setActivity(activity)
            .setCallbacks(callbacks)
            .build()
        PhoneAuthProvider.verifyPhoneNumber(options)
    }

    override suspend fun signInWithPhoneCredential(credential: PhoneAuthCredential): Resource<FirebaseUser> {
        return try {
            val result = auth.signInWithCredential(credential).await()
            result.user?.let {
                Resource.Success(it)
            } ?: Resource.Error("Sign in failed: no user returned")
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Phone sign in failed", e)
        }
    }

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
