package com.shyden.shytalk.feature.auth

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Callback interface for Google Sign-In on iOS.
 *
 * The Swift app registers an implementation at startup via [registerGoogleSignInHandler].
 * The Kotlin side calls [performGoogleSignIn] which invokes the handler.
 */
interface GoogleSignInHandler {
    fun signIn(completion: (idToken: String?, error: String?) -> Unit)
}

@kotlin.concurrent.Volatile
private var googleSignInHandler: GoogleSignInHandler? = null

/**
 * Called from Swift during app init to register the Google Sign-In handler.
 */
fun registerGoogleSignInHandler(handler: GoogleSignInHandler) {
    googleSignInHandler = handler
}

/**
 * Triggers Google Sign-In via the registered Swift handler.
 * Returns the Google ID token for AuthViewModel.signInWithGoogle().
 */
suspend fun performGoogleSignIn(): String =
    suspendCancellableCoroutine { continuation ->
        val handler = googleSignInHandler
        if (handler == null) {
            continuation.resumeWithException(Exception("Google Sign-In not configured on iOS"))
            return@suspendCancellableCoroutine
        }

        handler.signIn { idToken, error ->
            if (!continuation.isActive) return@signIn
            if (idToken != null) {
                continuation.resume(idToken)
            } else {
                continuation.resumeWithException(
                    Exception(error ?: "Google Sign-In failed"),
                )
            }
        }
    }
