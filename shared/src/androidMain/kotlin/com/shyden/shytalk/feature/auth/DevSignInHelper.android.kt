package com.shyden.shytalk.feature.auth

import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.tasks.await

/**
 * Android actual for [performDevSignIn]. Uses the Firebase Android SDK
 * Tasks API + kotlinx-coroutines `await()` adapter — equivalent to the
 * iOS GitLive suspend variant for the caller's purposes.
 */
actual suspend fun performDevSignIn(
    email: String,
    password: String,
) {
    FirebaseAuth
        .getInstance()
        .signInWithEmailAndPassword(email, password)
        .await()
}
