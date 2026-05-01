package com.shyden.shytalk.feature.auth

/**
 * JVM actual for [performGoogleSignIn]. The JVM target is test-only —
 * no real Google Sign-In flow exists. Throwing matches the established
 * "no real impl" pattern (see `JvmPlatformSettingsService` no-ops).
 */
actual suspend fun performGoogleSignIn(
    context: Any?,
    webClientId: String?,
): String = throw UnsupportedOperationException("Google Sign-In is not available on JVM (test-only target)")
