package com.shyden.shytalk.core.push

import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.repository.AuthRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.koin.mp.KoinPlatformTools

@kotlin.concurrent.Volatile
private var pushBridge: PushTokenBridge? = null

private val syncScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

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
 * (the next sign-in path through NavGraph will trigger the save). The Koin race
 * is caught explicitly: if KoinContext or AuthRepository is not yet resolvable,
 * we log and return — the token is already cached in NSUserDefaults via the
 * bridge, so a subsequent trigger picks it up.
 */
fun trySyncFcmTokenForCurrentUser() {
    val koin =
        try {
            KoinPlatformTools.defaultContext().get()
        } catch (_: IllegalStateException) {
            logW("IosPushBridge", "trySync skipped — Koin not initialised")
            return
        }
    val userId =
        try {
            koin.get<AuthRepository>().currentUserId
        } catch (e: Exception) {
            logW("IosPushBridge", "trySync skipped — AuthRepository unavailable: ${e.message}")
            return
        }
    if (userId.isNullOrEmpty()) return
    val manager: PushTokenManager =
        try {
            koin.get()
        } catch (e: Exception) {
            logW("IosPushBridge", "trySync skipped — PushTokenManager unavailable: ${e.message}")
            return
        }
    syncScope.launch { manager.syncToken(userId) }
}
