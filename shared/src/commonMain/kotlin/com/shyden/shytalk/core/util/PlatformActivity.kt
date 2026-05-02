package com.shyden.shytalk.core.util

import androidx.compose.runtime.Composable

/**
 * Returns the platform's "current Activity-like" handle, or `null` when no
 * such concept applies. Used by SignInScreen to feed Android-only sign-in
 * mechanics (CredentialManager Context, Firebase WebView OAuth Activity)
 * without leaking the Android types into commonMain.
 *
 * - Android returns `LocalContext.current as? android.app.Activity`.
 * - iOS / JVM return `null`. The downstream sign-in helpers either don't
 *   need it (iOS, where Apple Sign-In uses ASAuthorizationController and
 *   Google Sign-In uses GIDSignIn) or fail closed (JVM, where the
 *   sign-in path is unreachable).
 */
@Composable
expect fun rememberPlatformActivity(): Any?
