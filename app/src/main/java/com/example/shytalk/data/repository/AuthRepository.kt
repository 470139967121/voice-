package com.example.shytalk.data.repository

import android.app.Activity
import com.example.shytalk.core.util.Resource
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.PhoneAuthCredential
import com.google.firebase.auth.PhoneAuthProvider
import kotlinx.coroutines.flow.Flow

interface AuthRepository {
    val currentUser: FirebaseUser?
    val isAuthenticated: Boolean

    fun sendVerificationCode(
        phoneNumber: String,
        activity: Activity,
        callbacks: PhoneAuthProvider.OnVerificationStateChangedCallbacks
    )

    suspend fun signInWithPhoneCredential(credential: PhoneAuthCredential): Resource<FirebaseUser>
    suspend fun signInWithGoogleIdToken(idToken: String): Resource<FirebaseUser>
    fun signOut()
}
