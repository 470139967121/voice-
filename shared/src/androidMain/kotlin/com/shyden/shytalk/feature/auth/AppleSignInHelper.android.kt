package com.shyden.shytalk.feature.auth

import android.app.Activity

/**
 * Android actual for [performAppleSignInFlow].
 *
 * Apple Sign-In on Android goes through Firebase's WebView OAuth flow,
 * which requires the calling Activity. The flow itself is fire-and-
 * forget on the ViewModel side (the result lands in `uiState.isLoading`
 * / `uiState.error` rather than being returned), so this wrapper just
 * validates the activity ref and dispatches.
 */
actual suspend fun performAppleSignInFlow(
    viewModel: AuthViewModel,
    activity: Any?,
) {
    val act =
        requireNotNull(activity as? Activity) {
            "Android performAppleSignInFlow requires an Android Activity, got ${activity?.let { it::class.simpleName }}"
        }
    viewModel.signInWithAppleViaProvider(act)
}
