package com.shyden.shytalk.feature.auth

import com.shyden.shytalk.core.util.logE
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
 * iOS actual for the cross-platform [performGoogleSignIn] expect. The
 * `context` and `webClientId` params are ignored — the Firebase iOS SDK
 * reads its OAuth client ID from `FirebaseApp.app().options.clientID`,
 * and there's no Activity/Context concept on iOS.
 *
 * Maps the Swift "cancelled" string back to [GoogleSignInCancelledException]
 * so the cross-platform call site can branch silently on cancel without
 * caring which platform produced the cancel.
 */
actual suspend fun performGoogleSignIn(
    context: Any?,
    webClientId: String?,
): String =
    suspendCancellableCoroutine { continuation ->
        val handler = googleSignInHandler
        if (handler == null) {
            // Programmer error — setupGoogleSignIn() in iOSApp.init()
            // never registered a handler. Log so Sentry catches the
            // misconfiguration rather than letting it surface as a
            // user-facing snackbar.
            logE("GoogleSignInHelper", "Google Sign-In handler not registered — setupGoogleSignIn() missing from iOSApp.init?")
            continuation.resumeWithException(Exception("Google Sign-In not configured on iOS"))
            return@suspendCancellableCoroutine
        }

        handler.signIn { idToken, error ->
            if (!continuation.isActive) return@signIn
            if (idToken != null) {
                continuation.resume(idToken)
            } else if (error != null && error.equals("cancelled", ignoreCase = true)) {
                continuation.resumeWithException(GoogleSignInCancelledException())
            } else if (error != null) {
                // Real failure — Swift forwarded a localizedDescription.
                // Log via logE so Sentry sees iOS Google Sign-In failures
                // (cross-user pattern detection requires structured logs).
                logE("GoogleSignInHelper", "Google Sign-In failed on iOS: $error")
                continuation.resumeWithException(Exception(error))
            } else {
                // Bridge-contract violation: handler invoked the callback
                // with both idToken and error null. Should be impossible
                // per the Swift bridge protocol — log loudly so we catch
                // future regressions where the bridge silently no-ops.
                logE("GoogleSignInHelper", "Bridge contract violation: callback fired with both idToken and error null")
                continuation.resumeWithException(
                    Exception("Google Sign-In returned no result (bridge contract violation)"),
                )
            }
        }
    }
