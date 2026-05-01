package com.shyden.shytalk.feature.auth

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.shyden.shytalk.core.util.logE

/**
 * Android actual for the cross-platform [performGoogleSignIn] expect.
 *
 * Uses Jetpack `CredentialManager` + Google Identity `GetGoogleIdOption`.
 * Requires both params:
 *  - [context] — Android `Context` to host the credential picker UI.
 *  - [webClientId] — Google OAuth web client ID, sourced from `BuildConfig`.
 *
 * `setFilterByAuthorizedAccounts(false)` lets first-time users see all
 * Google accounts on the device, not just ones already authorized for
 * this app.
 */
actual suspend fun performGoogleSignIn(
    context: Any?,
    webClientId: String?,
): String {
    val ctx =
        requireNotNull(context as? Context) {
            "Android performGoogleSignIn requires an Android Context, got ${context?.let { it::class.simpleName }}"
        }
    val clientId =
        requireNotNull(webClientId) {
            "Android performGoogleSignIn requires the Google OAuth webClientId from BuildConfig"
        }
    val credentialManager = CredentialManager.create(ctx)
    val googleIdOption =
        GetGoogleIdOption
            .Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(clientId)
            .build()
    val request =
        GetCredentialRequest
            .Builder()
            .addCredentialOption(googleIdOption)
            .build()
    return try {
        val result = credentialManager.getCredential(request = request, context = ctx)
        GoogleIdTokenCredential.createFrom(result.credential.data).idToken
    } catch (e: GetCredentialCancellationException) {
        // Translate Android-specific cancellation to the cross-platform
        // marker so SignInScreen can branch on cancel without depending
        // on androidx.credentials types.
        throw GoogleSignInCancelledException()
    } catch (e: NoCredentialException) {
        // User-fixable: no Google account on device, or all accounts
        // are blocked from this app. Log via logE so Sentry sees it
        // (the on-device snackbar shows the message, but for diagnosing
        // patterns across users we want the structured log too) and
        // rethrow with a clearer message that hints at the fix.
        logE("GoogleSignInHelper", "No Google account available for sign-in", e)
        throw GoogleSignInNoAccountException()
    } catch (e: Exception) {
        // Other CredentialManager exceptions: GetCredentialInterruptedException
        // (transient), GetCredentialProviderConfigurationException (missing/
        // outdated Play Services), or any unexpected runtime error. Log so
        // Sentry sees ALL credential failures, then rethrow for the caller's
        // generic snackbar handler.
        logE("GoogleSignInHelper", "Google Sign-In failed: ${e::class.simpleName}", e)
        throw e
    }
}
