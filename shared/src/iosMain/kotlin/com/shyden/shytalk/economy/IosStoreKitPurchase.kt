package com.shyden.shytalk.economy

import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Suspend wrapper around the callback-style `StoreKitBridge.purchase`.
 * Returns the signed JWS on success, throws `StoreKitCancelledException`
 * on user-dismiss, or generic `Exception` on hard failure.
 *
 * Throws `IllegalStateException` if the bridge isn't registered yet —
 * a programmer error (Swift didn't call `registerStoreKitBridge` after
 * Koin init), surfaced loud rather than silently no-opping.
 */
internal suspend fun storeKitPurchase(
    productId: String,
    isSubscription: Boolean,
): String =
    suspendCancellableCoroutine { cont: CancellableContinuation<String> ->
        val bridge =
            getStoreKitBridge() ?: run {
                cont.resumeWithException(
                    IllegalStateException(
                        "StoreKitBridge not registered — iOSApp.swift must call " +
                            "registerStoreKitBridge(...) after KoinHelper.doInitKoin",
                    ),
                )
                return@suspendCancellableCoroutine
            }
        bridge.purchase(
            productId = productId,
            isSubscription = isSubscription,
            onSuccess = { jws -> if (cont.isActive) cont.resume(jws) },
            onCancelled = {
                if (cont.isActive) cont.resumeWithException(StoreKitCancelledException())
            },
            onFailed = { error ->
                if (cont.isActive) {
                    cont.resumeWithException(
                        Exception("StoreKit purchase failed: $error"),
                    )
                }
            },
        )
    }
