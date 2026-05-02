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

    @kotlin.concurrent.Volatile
    var localDevEmail: String? = null
        private set

    @kotlin.concurrent.Volatile
    var googleWebClientId: String? = null
        private set

    /**
     * iOS-only stable per-device identifier, eagerly computed in
     * `iOSApp.swift` and passed in via `KoinHelper.doInitKoin`. The Koin
     * factory at `IosPlatformModule.kt`'s `named("deviceId")` reads from
     * this slot rather than calling `UIDevice.currentDevice.identifierForVendor`
     * lazily — PR #406 attempted that and crashed the Firebase Firestore
     * init with a `ClassCastException: HashMap cannot be cast to CPointer`
     * (K/N + GitLive Firebase + Kotlin 2.4.0-Beta2 timing fragility, see
     * `project-ios-device-id-revert-rca.md`). On Android this slot is
     * unused — `Settings.Secure.ANDROID_ID` is read directly elsewhere.
     */
    @kotlin.concurrent.Volatile
    var iosDeviceId: String? = null
        private set

    /**
     * Build environment: `"local"`, `"dev"`, or `"prod"`. Drives the
     * `PreviewWatermark` overlay — any value other than `"prod"` shows
     * the red "ShyTalk Preview" badge on every screen so screenshots
     * accidentally shared from non-prod builds are unmistakable.
     * Set once at boot via [initBuildInfo]. Defaults to `"prod"` so a
     * misconfigured platform initialiser fails safe (false-positive
     * watermarks on real prod erode trust in the signal more than a
     * missed watermark on a dev build, which is visually obvious during
     * development and self-corrects).
     */
    @kotlin.concurrent.Volatile
    var environment: String = "prod"
        private set

    /**
     * Human-readable build identifier shown in the watermark, e.g.
     * `"1.2.3 (456)"`. Set once at boot via [initBuildInfo]. Defaults
     * to `"?"` so an absent initialiser is visible at a glance rather
     * than rendering as an empty badge.
     */
    @kotlin.concurrent.Volatile
    var buildVersion: String = "?"
        private set

    /**
     * Device label shown in the watermark, e.g. `"Pixel 6 · Android 14"`
     * or `"iPhone 17 · iOS 26.4"`. Lets a screenshot reader trace a
     * leak back to a specific physical device or simulator. Set once at
     * boot via [initBuildInfo].
     *
     * Format is platform-defined:
     * - Android: `"${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE}"`
     * - iOS: `"${UIDevice.model} · iOS ${UIDevice.systemVersion}"`
     */
    @kotlin.concurrent.Volatile
    var deviceInfo: String = "?"
        private set

    /**
     * Convenience: any environment that isn't prod is a "preview"
     * build. The PreviewWatermark composable / web overlay reads this
     * to decide whether to render.
     */
    val isPreviewBuild: Boolean
        get() = environment != "prod"

    /**
     * One-shot initialiser for the watermark slots. Called from
     * platform entry points (Android `MainActivity.onCreate`, iOS
     * `KoinHelper.doInitKoin`) before UI mounts. Empty/blank
     * `environment` is coerced to `"prod"` for fail-safe behaviour;
     * empty `buildVersion` / `deviceInfo` are coerced to `"?"` so a
     * misconfigured initialiser is loud rather than silent.
     */
    fun initBuildInfo(
        environment: String,
        buildVersion: String,
        deviceInfo: String = "",
    ) {
        this.environment = environment.takeIf { it.isNotBlank() } ?: "prod"
        this.buildVersion = buildVersion.takeIf { it.isNotBlank() } ?: "?"
        this.deviceInfo = deviceInfo.takeIf { it.isNotBlank() } ?: "?"
    }

    /**
     * One-shot initialiser called from platform entry points before UI mounts.
     * Public (rather than `internal`) so the `app` module's MainActivity (and
     * iOS's `KoinHelper.doInitKoin`) can invoke it; the named function makes
     * the "set once at boot" contract explicit at every call site.
     *
     * `devPassword` and `devEmail` should be `null` on every non-local build.
     * Android passes the corresponding `BuildConfig.LOCAL_DEV_*` field (empty
     * string when the field is built out via the `dev` / `prod`
     * `buildConfigField` to `""`); iOS passes `nil` from the `#else` branch
     * of `#if DEBUG`. The setter coerces empty strings to `null` so callers
     * can read with a uniform `isNullOrEmpty()` guard.
     *
     * `googleWebClientId` is needed only by Android's CredentialManager flow
     * for Google Sign-In; iOS reads its OAuth client ID from
     * `FirebaseApp.app().options.clientID` and ignores this slot, so iOS
     * passes `nil`.
     */
    fun initLocalEmulator(
        value: Boolean,
        devPassword: String? = null,
        devEmail: String? = null,
        googleWebClientId: String? = null,
    ) {
        isLocalEmulator = value
        localDevPassword = devPassword?.takeIf { it.isNotEmpty() }
        localDevEmail = devEmail?.takeIf { it.isNotEmpty() }
        this.googleWebClientId = googleWebClientId?.takeIf { it.isNotEmpty() }
    }

    /**
     * One-shot iOS deviceId initialiser. Called from
     * `KoinHelper.doInitKoin(deviceId = ...)`, which is in turn called from
     * Swift's `iOSApp.swift` `init()` after `UIApplication` is fully set up
     * but before Firebase init runs. Empty/blank values are coerced to
     * null so a downstream `?: error(...)` in the Koin factory fails
     * loudly rather than passing an empty string to the Express API.
     */
    fun initIosDeviceId(value: String?) {
        iosDeviceId = value?.takeIf { it.isNotBlank() }
    }
}
