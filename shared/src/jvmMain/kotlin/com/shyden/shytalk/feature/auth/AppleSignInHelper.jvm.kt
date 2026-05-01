package com.shyden.shytalk.feature.auth

/**
 * JVM actual for [performAppleSignInFlow]. Test-only target — no real
 * Apple Sign-In flow exists on JVM. Throws to match the established
 * "no real impl" pattern (see `JvmPlatformSettingsService` no-ops).
 */
actual suspend fun performAppleSignInFlow(
    viewModel: AuthViewModel,
    activity: Any?,
): Unit = throw UnsupportedOperationException("Apple Sign-In is not available on JVM (test-only target)")
