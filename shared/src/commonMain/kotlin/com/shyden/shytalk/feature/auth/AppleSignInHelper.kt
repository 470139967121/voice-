package com.shyden.shytalk.feature.auth

/**
 * Cross-platform Apple Sign-In entry point. Hides the very different
 * platform mechanics behind a uniform suspend fun so the consolidated
 * SignInScreen can call it without branching:
 *
 * - **Android** uses Firebase's WebView-based OAuth provider flow
 *   (`auth.startActivityForSignInWithProvider(activity, provider)`) —
 *   so it requires the calling `Activity` and produces a UID directly.
 *   This actual is essentially a thin wrapper around
 *   `AuthViewModel.signInWithAppleViaProvider(activity)` (which is
 *   itself fire-and-forget, dispatching to viewModelScope; the screen
 *   tracks completion via `uiState.isLoading`/`uiState.error`).
 *
 * - **iOS** uses native `ASAuthorizationController` to obtain an Apple
 *   identityToken + raw nonce, then exchanges them for a Firebase UID
 *   via `AuthViewModel.signInWithApple(idToken, rawNonce)`. The
 *   `activity` param is unused.
 *
 * On user cancellation both platforms throw [AppleSignInCancelledException]
 * so the screen can branch silently without depending on platform
 * exception classes.
 */
expect suspend fun performAppleSignInFlow(
    viewModel: AuthViewModel,
    activity: Any? = null,
)

/**
 * Thrown when the user dismisses Apple Sign-In without completing.
 * Caller should treat as silent — no error toast.
 */
class AppleSignInCancelledException : Exception("Apple Sign-In cancelled by user")
