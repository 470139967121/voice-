package com.shyden.shytalk.feature.auth

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Cross-platform tests for [AppleSignInCancelledException].
 *
 * Mirrors `GoogleSignInHelperTest` for the Apple provider. The actual
 * `performAppleSignInFlow` requires platform-specific orchestration
 * (Firebase WebView OAuth on Android, ASAuthorizationController on iOS)
 * and is exercised by manual QA + integration tests in
 * `AuthViewModelIdentityTest`. Here we just lock the marker exception's
 * API so `SignInScreen` can `catch (_: AppleSignInCancelledException)`
 * without depending on platform exception classes (Android's
 * `FirebaseAuthWebException`, iOS's `NSError code 1001`).
 */
class AppleSignInHelperTest {
    @Test
    fun `cancelled exception is throwable`() {
        val e = AppleSignInCancelledException()
        assertIs<Throwable>(e)
    }

    @Test
    fun `cancelled exception has stable message`() {
        // The cancellation path is silent (no snackbar), so the message
        // appears only in `logW("SignInScreen", "Apple sign-in failed", e)`
        // breadcrumbs — but log-grep reliability still matters for
        // diagnosing intermittent reports, so the literal is pinned.
        val e = AppleSignInCancelledException()
        assertEquals("Apple Sign-In cancelled by user", e.message)
    }

    @Test
    fun `cancelled exception is distinct from generic Exception so SignInScreen branches silently`() {
        // SignInScreen.kt line 374 has `catch (_: AppleSignInCancelledException) { /* silent */ }`
        // BEFORE the generic catch that shows the localised
        // "apple_sign_in_failed" snackbar. Type discrimination is what
        // keeps cancellation silent — a future refactor must not
        // collapse this into a generic Exception or every cancel
        // would surface as a misleading "failed" toast.
        val cancelled: Throwable = AppleSignInCancelledException()
        val generic: Throwable = Exception("Apple OAuth network failure")
        assertIs<AppleSignInCancelledException>(cancelled)
        assertNotNull(generic.message)
        assertTrue(
            generic !is AppleSignInCancelledException,
            "Generic Exception must NOT match the cancelled catch arm",
        )
    }

    @Test
    fun `cancelled exception is distinct from Google's so providers don't cross-match`() {
        // SignInScreen catches each provider's cancel separately
        // because their UX is identical (silent) but the click sites
        // are independent — a future change that surfaces a
        // provider-specific recovery hint depends on the type split.
        val apple: Throwable = AppleSignInCancelledException()
        val google: Throwable = GoogleSignInCancelledException()
        assertTrue(apple !is GoogleSignInCancelledException)
        assertTrue(google !is AppleSignInCancelledException)
    }
}
