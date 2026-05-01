package com.shyden.shytalk.core

/**
 * Shared build-time flags accessible from common code. Set exactly once at
 * platform startup before any UI runs (Android: when `BuildConfig.FLAVOR ==
 * "local"`; iOS: when the `#if DEBUG` configuration is active).
 *
 * `@kotlin.concurrent.Volatile` establishes a happens-before edge between the
 * boot-time write on the main thread and Compose-thread reads on iOS, where
 * recomposition can read the flag from a different thread than the one that
 * wrote it. The property setter is private so feature code cannot flip the
 * flag at runtime — initialisation must go through `initLocalEmulator()`.
 *
 * `localDevPassword` is injected from outside the binary on the local flavor
 * only — Android reads from `BuildConfig.LOCAL_DEV_PASSWORD` (empty string on
 * dev/prod via `buildConfigField`), iOS reads from `iOSApp.swift`'s `#if DEBUG`
 * block. On non-local builds it is `null`, so `SignInScreen`'s dev path
 * fails closed before the Firebase call. Keeping the literal out of every
 * non-DEBUG iOS Release binary and every non-local Android APK closes the
 * "reverse-engineer the production binary to learn the seed credential" leak
 * that the previous inline `"localdev123"` strings exposed.
 */
object BuildVariant {
    @kotlin.concurrent.Volatile
    var isLocalEmulator: Boolean = false
        private set

    @kotlin.concurrent.Volatile
    var localDevPassword: String? = null
        private set

    /**
     * One-shot initialiser called from platform entry points before UI mounts.
     * Public (rather than `internal`) so the `app` module's MainActivity (and
     * iOS's `KoinHelper.doInitKoin`) can invoke it; the named function makes
     * the "set once at boot" contract explicit at every call site.
     *
     * `devPassword` should be `null` on every non-local build. Android passes
     * `BuildConfig.LOCAL_DEV_PASSWORD` (empty string when the field is built
     * out via the `dev` / `prod` `buildConfigField` to `""`); iOS passes
     * `nil` from the `#else` branch of `#if DEBUG`. The setter coerces empty
     * strings to `null` so callers don't need to translate.
     */
    fun initLocalEmulator(
        value: Boolean,
        devPassword: String? = null,
    ) {
        isLocalEmulator = value
        localDevPassword = devPassword?.takeIf { it.isNotEmpty() }
    }
}
