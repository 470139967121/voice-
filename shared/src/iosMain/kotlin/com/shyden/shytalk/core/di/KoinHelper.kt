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
 * emulator seed literal from a `let` local in iOSApp.swift and forwards it.
 * The Release branch passes `nil` so the literal does NOT end up in the
 * production iOS binary — Xcode strips `#if DEBUG` text at compile time.
 * This closes the "reverse-engineer the IPA to learn the seed credential"
 * leak. Source of truth for the value is `local/seed.js`.
 *
 * @param useEmulators If true, connects Firebase to local emulators (localhost).
 * @param devSignInPassword Plaintext password for the dev-only one-tap sign-in
 *   button on `SignInScreen`. MUST be `nil` outside `#if DEBUG`. The runtime
 *   gate also requires `useEmulators=true` to even render the button.
 */
fun doInitKoin(
    useEmulators: Boolean = false,
    devSignInPassword: String? = null,
) {
    BuildVariant.initLocalEmulator(useEmulators, devSignInPassword)
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
