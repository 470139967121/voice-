package com.shyden.shytalk.core.push

import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.data.repository.AuthRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.koin.mp.KoinPlatformTools

@kotlin.concurrent.Volatile
private var pushBridge: PushTokenBridge? = null

private val syncScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

private const val TAG = "IosPushBridge"

/**
 * Called from Swift during app init (after FirebaseApp.configure and Koin init)
 * to register the AppDelegate-backed push token bridge.
 */
fun registerPushBridge(bridge: PushTokenBridge) {
    pushBridge = bridge
}

/**
 * Access the registered push bridge from Kotlin. Returns null until Swift
 * has registered an implementation.
 */
fun getPushBridge(): PushTokenBridge? = pushBridge

/**
 * Best-effort token sync, called from AppDelegate on:
 *   - `messaging(_:didReceiveRegistrationToken:)` — fresh token / rotation
 *   - `application(_:didBecomeActive:)` — foreground (catches token rotation
 *     that happened while suspended, or first save after a Koin race)
 *
 * If a user is signed in, kicks off `PushTokenManager.syncToken`. If not, no-op
 * (the next sign-in path through NavGraph will trigger the save).
 *
 * Errors are caught broadly (`Exception`) because this function is invoked
 * across the Swift→Kotlin FFI boundary — an uncaught Kotlin exception there
 * would crash the iOS app. Failures are logged at `logE` because they all
 * indicate build/wiring defects (missing Koin binding, missing AuthRepository,
 * missing PushTokenManager) rather than transient runtime conditions, and
 * Sentry's warning-filter would otherwise hide the bug class entirely.
 */
fun trySyncFcmTokenForCurrentUser() {
    val koin =
        try {
            KoinPlatformTools.defaultContext().get()
        } catch (e: Exception) {
            logE(TAG, "trySync skipped — Koin not initialised: ${e.message}", e)
            return
        }
    val userId =
        try {
            koin.get<AuthRepository>().currentUserId
        } catch (e: Exception) {
            logE(TAG, "trySync skipped — AuthRepository unavailable: ${e.message}", e)
            return
        }
    if (userId.isNullOrEmpty()) return
    val manager: PushTokenManager =
        try {
            koin.get()
        } catch (e: Exception) {
            logE(TAG, "trySync skipped — PushTokenManager unavailable: ${e.message}", e)
            return
        }
    syncScope.launch { manager.syncToken(userId) }
}
