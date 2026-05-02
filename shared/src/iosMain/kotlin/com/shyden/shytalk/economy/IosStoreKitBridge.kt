package com.shyden.shytalk.economy

/**
 * Bridge interface for StoreKit 2 on iOS. Mirrors `LiveKitBridge` /
 * `PushTokenBridge`. Swift app registers an impl at startup wrapping
 * StoreKit 2's `Product.purchase()` API.
 *
 * **Real charges only on production.** The Swift implementation MUST
 * use a `StoreKit Configuration File` for `local`/`dev` builds (so
 * purchases settle on-device with no real money) and switch to real
 * App Store sandbox / production for the `prod` flavour. See
 * `feedback-no-real-charges-non-prod.md`.
 */
interface StoreKitBridgeHandler {
    /**
     * Initiate a StoreKit purchase. Exactly one of the three callbacks
     * will fire per call. `onSuccess` receives the signed JWS payload
     * from `Transaction.jwsRepresentation` — forward to Express
     * `/api/economy/purchase` with `platform: 'apple'`.
     */
    fun purchase(
        productId: String,
        isSubscription: Boolean,
        onSuccess: (signedTransactionInfo: String) -> Unit,
        onCancelled: () -> Unit,
        onFailed: (error: String) -> Unit,
    )
}

interface StoreKitBridge : StoreKitBridgeHandler

@kotlin.concurrent.Volatile
private var storeKitBridge: StoreKitBridge? = null

fun registerStoreKitBridge(bridge: StoreKitBridge) {
    storeKitBridge = bridge
}

fun getStoreKitBridge(): StoreKitBridge? = storeKitBridge

/**
 * Thrown when StoreKit reports user-cancelled. The wallet UI catches
 * this typed exception and stays silent — no error toast — matching
 * Android's `USER_CANCELED` handling.
 */
class StoreKitCancelledException : Exception("StoreKit purchase cancelled by user")
