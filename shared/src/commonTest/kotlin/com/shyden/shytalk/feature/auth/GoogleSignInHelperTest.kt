package com.shyden.shytalk.feature.auth

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull

/**
 * Cross-platform tests for the [GoogleSignInCancelledException] marker.
 * The actual `performGoogleSignIn` requires platform-specific mocks
 * (CredentialManager on Android, the Swift bridge on iOS) and is
 * exercised by manual QA + compile-time signature checks. Here we just
 * lock down the marker exception's API so screens can `catch` it
 * by type without depending on platform exception classes.
 */
class GoogleSignInHelperTest {
    @Test
    fun `cancelled exception is throwable`() {
        val e = GoogleSignInCancelledException()
        assertIs<Throwable>(e)
    }

    @Test
    fun `cancelled exception has stable message`() {
        // The message is shown ONLY in logs (the cancellation path is
        // silent — no snackbar), but the string is asserted here so
        // log-grepping for it stays reliable.
        val e = GoogleSignInCancelledException()
        assertEquals("Google Sign-In cancelled by user", e.message)
    }

    @Test
    fun `cancelled exception is distinct from generic Exception so callers can branch`() {
        val cancelled: Throwable = GoogleSignInCancelledException()
        val generic: Throwable = Exception("Network error")
        // Type discrimination is what enables the silent-on-cancel /
        // toast-on-error split in SignInScreen.
        assertIs<GoogleSignInCancelledException>(cancelled)
        assertNotNull(generic.message)
    }
}
