package com.shyden.shytalk.feature.auth

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * Locks down the JVM actual's loud-throw behaviour. The JVM target exists
 * solely to run commonTest on Windows/Linux/CI — dev sign-in is a mobile
 * concern and any test that ends up calling [performDevSignIn] on JVM has
 * a misconfigured fixture, NOT a real sign-in attempt. Throwing surfaces
 * that mismatch immediately. A silent no-op would mask the misconfiguration
 * by letting the test continue with no auth state, which is a footgun.
 */
class DevSignInHelperJvmTest {
    @Test
    fun `throws so an accidental JVM call surfaces the misconfigured fixture`() =
        runTest {
            // Placeholder values — JVM stub throws before touching them.
            val placeholderEmail = "test@example.com"
            val placeholderSecret = "fixture"
            val ex =
                assertFailsWith<UnsupportedOperationException> {
                    performDevSignIn(email = placeholderEmail, password = placeholderSecret)
                }
            assertTrue(
                ex.message?.contains("JVM") == true,
                "throw must name the platform to aid debugging; was: ${ex.message}",
            )
        }
}
