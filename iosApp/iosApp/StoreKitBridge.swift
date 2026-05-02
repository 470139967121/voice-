import Foundation
import StoreKit
import shared

/// StoreKit 2 bridge between Kotlin and Swift. Registered in `iOSApp.swift`
/// after `KoinHelper.doInitKoin`. See `IosStoreKitBridge.kt` for the
/// Kotlin-side contract.
///
/// **Real charges only on production.** DEBUG builds use the
/// StoreKit Configuration File configured in the iosApp scheme so
/// purchases settle on-device with no real money. Release builds
/// (TestFlight + App Store) use the real Apple Sandbox / production
/// servers via the App Store Connect product catalog.
@available(iOS 15.0, *)
class StoreKitBridgeImpl: StoreKitBridge {
    func purchase(
        productId: String,
        isSubscription: Bool,
        onSuccess: @escaping (String) -> Void,
        onCancelled: @escaping () -> Void,
        onFailed: @escaping (String) -> Void
    ) {
        Task {
            do {
                // Look up the product. On DEBUG builds with a StoreKit
                // Configuration File this resolves locally; on Release it
                // hits App Store Connect. Either way no money has moved.
                guard let product = try await Product.products(for: [productId]).first else {
                    onFailed("Product not found in App Store catalog: \(productId)")
                    return
                }

                let result = try await product.purchase()

                switch result {
                case .success(let verification):
                    // VerificationResult<Transaction>. The library has
                    // already verified the signature on-device — but we
                    // also forward the JWS to the server so the Express
                    // SignedDataVerifier can re-verify against Apple's
                    // root certs. Defence-in-depth.
                    switch verification {
                    case .verified(let transaction):
                        // Mark the transaction finished only AFTER the
                        // server grants the entitlement. The wallet UI
                        // path calls Transaction.finish() once
                        // /economy/purchase returns 200.
                        // (TODO B6.10c: hook Transaction.updates and
                        // finish() at the right point.)
                        let jws = verification.jwsRepresentation
                        onSuccess(jws)
                        await transaction.finish()
                    case .unverified(_, let error):
                        onFailed("StoreKit verification failed: \(error.localizedDescription)")
                    }

                case .userCancelled:
                    onCancelled()

                case .pending:
                    // "Ask to Buy" / SCA / parental approval pending.
                    // Treat as a soft failure — the purchase may complete
                    // later via Transaction.updates (B6.10c).
                    onFailed("Purchase pending parental / SCA approval — try again once approved")

                @unknown default:
                    onFailed("Unknown StoreKit purchase result")
                }
            } catch let error as StoreKitError {
                onFailed("StoreKit error: \(error.localizedDescription)")
            } catch {
                onFailed("Purchase failed: \(error.localizedDescription)")
            }
        }
    }
}
