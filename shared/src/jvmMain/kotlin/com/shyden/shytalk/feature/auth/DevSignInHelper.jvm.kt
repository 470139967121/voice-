package com.shyden.shytalk.feature.auth

/**
 * JVM actual for [performDevSignIn]. Test-only target — no Firebase
 * Auth runtime. Throws loudly so an accidental call from a misconfigured
 * test fixture surfaces immediately instead of silently no-opping (which
 * would let the test continue with no auth state and mask the
 * misconfiguration). The corresponding [DevSignInHelperJvmTest] locks
 * this behaviour down.
 */
actual suspend fun performDevSignIn(
    email: String,
    password: String,
): Unit = throw UnsupportedOperationException("Dev sign-in is not available on JVM (test-only target)")
