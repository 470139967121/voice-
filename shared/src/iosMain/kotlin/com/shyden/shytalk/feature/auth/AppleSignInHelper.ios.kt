package com.shyden.shytalk.feature.auth

import com.shyden.shytalk.core.util.logE

private const val TAG = "AppleSignInHelper"

/**
 * iOS actual for [performAppleSignInFlow].
 *
 * Two-step flow: native ASAuthorizationController via [performAppleSignIn]
 * yields an Apple identityToken + raw nonce, which we then hand to
 * `AuthViewModel.signInWithApple(idToken, rawNonce)` for Firebase auth.
 *
 * The `activity` param is unused on iOS (no Activity concept; the
 * controller presents itself from the active UIWindow). We re-throw
 * cancellations as the cross-platform [AppleSignInCancelledException]
 * so the screen can branch silently without sniffing error strings.
 */
actual suspend fun performAppleSignInFlow(
    viewModel: AuthViewModel,
    activity: Any?,
) {
    // performAppleSignIn() throws AppleSignInCancelledException directly
    // (typed at the NSError boundary in IosAppleSignInHelper.kt by
    // checking ASAuthorizationErrorCanceled code 1001) so we don't need
    // to string-sniff the message here. Real failures bubble up as
    // Exception("Apple Sign-In failed: <localizedDescription>") and the
    // SignInScreen catch handler shows the snackbar.
    //
    // Note for future maintainers: don't set uiState.isLoading=true
    // before calling performAppleSignIn() — if the user cancels, the
    // exception unwinds before viewModel.signInWithApple runs and the
    // spinner would be left stuck. The current contract relies on
    // local `signingInProvider` state in the screen, cleared in catch.
    val result =
        try {
            performAppleSignIn()
        } catch (e: AppleSignInCancelledException) {
            // Pass through silently — caller swallows.
            throw e
        } catch (e: Exception) {
            logE(TAG, "Apple Sign-In failed on iOS: ${e.message}", e)
            throw e
        }
    viewModel.signInWithApple(result.idToken, result.rawNonce)
}
