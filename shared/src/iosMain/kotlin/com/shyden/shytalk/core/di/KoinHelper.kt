package com.shyden.shytalk.core.di

import com.shyden.shytalk.core.BuildVariant
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import dev.gitlive.firebase.Firebase
import dev.gitlive.firebase.auth.auth
import dev.gitlive.firebase.database.database
import dev.gitlive.firebase.firestore.firestore
import org.koin.core.context.startKoin
import org.koin.mp.KoinPlatformTools

/**
 * Initializes Firebase and Koin for the iOS app.
 *
 * Called from Swift inside the `#if DEBUG` block — the Swift side reads the
 * emulator seed literals (email + password) from `let` locals in iOSApp.swift
 * and forwards them. The Release branch passes `nil` for both so the literals
 * do NOT end up in the production iOS binary — Xcode strips `#if DEBUG` text
 * at compile time. This closes the "reverse-engineer the IPA to learn the
 * seed credential" leak. Source of truth for both values is `local/seed.js`.
 *
 * `googleWebClientId` is intentionally not a parameter here: iOS reads its
 * Google OAuth client ID from `FirebaseApp.app().options.clientID` (set via
 * the bundled `GoogleService-Info.plist`), so the Android-only
 * `BuildConfig.WEB_CLIENT_ID` slot is left `null` for iOS.
 *
 * @param useEmulators If true, connects Firebase to local emulators (localhost).
 * @param devSignInPassword Plaintext password for the dev-only one-tap sign-in
 *   button on `SignInScreen`. MUST be `nil` outside `#if DEBUG`. The runtime
 *   gate also requires `useEmulators=true` to even render the button.
 * @param devSignInEmail Email paired with `devSignInPassword`. Same `#if DEBUG`
 *   strip rule applies. Both must be non-null/non-empty for the dev-sign-in
 *   path's empty-credentials guard to allow the call to proceed.
 */
fun doInitKoin(
    useEmulators: Boolean = false,
    devSignInPassword: String? = null,
    devSignInEmail: String? = null,
    deviceId: String? = null,
) {
    BuildVariant.initLocalEmulator(
        value = useEmulators,
        devPassword = devSignInPassword,
        devEmail = devSignInEmail,
        // iOS uses Firebase's bundled clientID via FirebaseApp.app().options
        // — the Android-only CredentialManager webClientId is not needed.
        googleWebClientId = null,
    )
    // Eagerly persist the iOS deviceId before any Firebase / Koin
    // resolution. PR #406 attempted lazy `UIDevice.identifierForVendor`
    // inside the Koin factory and crashed with `ClassCastException:
    // HashMap cannot be cast to CPointer` — see
    // `project-ios-device-id-revert-rca.md`. Eager Swift-side compute +
    // BuildVariant slot avoids the K/N + GitLive Firebase init race.
    BuildVariant.initIosDeviceId(deviceId)
    if (KoinPlatformTools.defaultContext().getOrNull() != null) {
        logI("KoinHelper", "Koin already initialised — skipping")
        return
    }
    try {
        if (useEmulators) {
            configureFirebaseEmulators()
        }
        startKoin {
            modules(viewModelModule, iosPlatformModule)
        }
        logI("KoinHelper", "Koin initialised successfully (emulators=$useEmulators)")
    } catch (e: Exception) {
        logE("KoinHelper", "Koin initialisation failed: ${e.message}", e)
        throw e
    }
}

private fun configureFirebaseEmulators() {
    val host = "localhost"
    Firebase.firestore.useEmulator(host, 8080)
    Firebase.auth.useEmulator(host, 9099)
    Firebase.database.useEmulator(host, 9000)
    logI("KoinHelper", "Firebase emulators: Firestore=$host:8080, Auth=$host:9099, RTDB=$host:9000")
}
