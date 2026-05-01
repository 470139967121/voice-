package com.shyden.shytalk.feature.auth

/**
 * Local-emulator-only password sign-in helper, gated everywhere by
 * `BuildVariant.isLocalEmulator`. Hides the Android `Tasks → await()`
 * vs. iOS GitLive Firebase KMP `suspend` impedance mismatch behind a
 * single suspend fun so the consolidated SignInScreen can call one
 * thing on both platforms.
 *
 * **NOT** for production sign-in. The seeded `localdev123` password
 * matches Firebase Emulator data only — production Firebase rejects
 * this credential. Caller MUST gate this behind
 * `BuildVariant.isLocalEmulator` AT THE CALL SITE (defence-in-depth
 * vs a Frida-runtime flag flip).
 *
 * **Exception types diverge by platform.** Android propagates
 * `com.google.firebase.auth.FirebaseAuthInvalidUserException` /
 * `FirebaseAuthInvalidCredentialsException` etc.; iOS propagates the
 * same logical errors via `dev.gitlive.firebase.auth.*` wrappers.
 * Callers that need to discriminate (e.g. "user not found" vs "wrong
 * password") must add a common abstraction — currently every caller
 * just shows a fixed error string, so the divergence is invisible.
 */
expect suspend fun performDevSignIn(
    email: String,
    password: String,
)
