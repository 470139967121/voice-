package com.shyden.shytalk.feature.auth

/**
 * Suspending entry point for Google Sign-In, abstracting platform mechanics.
 *
 * - **Android** uses Jetpack `CredentialManager` (requires the calling
 *   `Context` and the Google OAuth `webClientId` from `BuildConfig`).
 * - **iOS** uses the native Google Sign-In SDK via a Swift bridge
 *   registered at app startup. The Firebase iOS SDK reads its OAuth
 *   client ID from `FirebaseApp.app().options.clientID`, so the
 *   `context` and `webClientId` parameters are ignored on that side.
 *
 * The two parameters are optional with `null` defaults so iOS callers
 * (the existing `IosSignInScreen`) can still call `performGoogleSignIn()`
 * with no arguments. Android callers must supply both — the `context`
 * is non-null at runtime.
 *
 * On user cancellation both platforms throw [GoogleSignInCancelledException]
 * so the screen can distinguish "user backed out" (silent) from a real
 * sign-in failure (snackbar).
 */
expect suspend fun performGoogleSignIn(
    context: Any? = null,
    webClientId: String? = null,
): String

/**
 * Thrown when the user dismisses the Google Sign-In sheet without
 * completing. Caller should treat as silent — no error toast.
 */
class GoogleSignInCancelledException : Exception("Google Sign-In cancelled by user")

/**
 * Thrown when the device has no Google account available for sign-in.
 * Distinct from a generic failure because it's USER-FIXABLE: the user
 * can add a Google account in system Settings and retry. The screen
 * should show actionable guidance ("Add a Google account in Settings
 * to sign in with Google") rather than a cryptic framework string.
 */
class GoogleSignInNoAccountException : Exception("No Google account available — add one in system Settings and try again")
