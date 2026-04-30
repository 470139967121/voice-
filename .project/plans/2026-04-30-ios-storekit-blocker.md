# iOS StoreKit / In-App Purchase Blocker

**Status:** Blocked on Apple Developer account product configuration.
**Last updated:** 2026-04-30

## Summary

iOS in-app purchases (coin packs + Super Shy subscriptions) are stubbed and
return `Resource.Error("iOS purchases not yet implemented (needs StoreKit)")`.
This is a real blocker, not a TODO — three independent pieces of infrastructure
need to land before iOS users can complete a purchase. The **earliest unblock
is Apple Developer account configuration**, which is a manual one-time setup
gated on a real Apple Developer Program membership ($99 USD/year) plus tax,
banking, and identity verification with Apple.

## Current State (in-tree)

### iOS app — `IosEconomyRepositoryImpl`

`shared/src/iosMain/kotlin/com/shyden/shytalk/data/repository/IosEconomyGiftRepositories.kt:185-195`

```kotlin
override suspend fun purchaseCoins(
    productId: String,
    purchaseToken: String,
): Resource<Map<String, Any?>> =
    // iOS uses StoreKit, not Google Play tokens — stub until StoreKit integration
    Resource.Error("iOS purchases not yet implemented (needs StoreKit)")

override suspend fun purchaseSubscription(
    productId: String,
    purchaseToken: String,
): Resource<Map<String, Any?>> = Resource.Error("iOS subscriptions not yet implemented (needs StoreKit)")
```

### iOS navigation — `IosPlatformNavCallbacks`

`shared/src/iosMain/kotlin/com/shyden/shytalk/navigation/IosPlatformNavCallbacks.kt:98-107`

```kotlin
// ── Billing (no-op v1 — StoreKit integration in future PR) ──
override fun purchasePackage(productId: String) {
    logW("IosPlatformNavCallbacks", "purchasePackage($productId) — StoreKit not yet integrated")
}

override fun purchaseSubscription(productId: String) {
    logW("IosPlatformNavCallbacks", "purchaseSubscription($productId) — StoreKit not yet integrated")
}
```

### Express API — `/api/economy/purchase`

`express-api/src/routes/economy.js:1270-1317`

The endpoint validates **Google Play tokens only**:

```javascript
const packageName = 'com.shyden.shytalk';
if (isSubscription) {
  verification = await verifySubscription(packageName, productId, purchaseToken);
} else {
  verification = await verifyProductPurchase(packageName, productId, purchaseToken);
}
```

`verifySubscription` / `verifyProductPurchase` use Google's `androidpublisher`
service-account API. There is no Apple App Store Server API path in this
codebase yet.

## Why This Is Blocked

Three independent pieces of infrastructure must land before a single iOS user
can complete a purchase:

### Block 1 — App Store Connect product configuration

Each product (`small_pack`, `medium_pack`, `large_pack`, `mega_pack`,
`super_shy_monthly`, `super_shy_yearly`, `super_shy_lifetime`) must exist
under **App Store Connect → My Apps → ShyTalk → In-App Purchases**, with:

- Matching product ID (must equal the Google Play SKU for cross-platform
  parity in Express API receipt validation)
- Pricing tier
- Localized name + description in each of the 20 supported locales
- Review screenshot (required for Apple review)
- Tax category
- Subscription group (for the three Super Shy tiers — monthly/yearly/lifetime
  must share a group so users can upgrade/downgrade)

**Prerequisite:** ShyTalk must be registered with App Store Connect. As of
2026-04-30 the iOS build is TestFlight-only; no App Store Connect record
exists. This requires:

1. Active Apple Developer Program membership ($99/year, current status: TBC)
2. App identifier (`com.shyden.shytalk`) registered in the developer portal
3. Bank account + tax forms complete in App Store Connect
   (`Agreements, Tax, and Banking` section — must be `Active` for paid apps)
4. Initial App Store record created (the `New App` form), even if the app
   itself is not published

### Block 2 — Apple App Store Server API integration in Express

Server-side receipt validation must use Apple's verifyReceipt or App Store
Server API. The current Express endpoint is hardcoded to Google Play.

**Required changes** to `express-api/src/routes/economy.js:1270-1317`:

```javascript
// Detect platform from purchase token format OR explicit `platform` field
const platform = body.platform || detectPlatform(purchaseToken);

if (platform === 'apple') {
  verification = await verifyAppleReceipt(productId, purchaseToken, isSubscription);
} else {
  // existing Google Play path
}
```

**New module:** `express-api/src/utils/apple-receipt-validator.js`

- Use `app-store-server-api` npm package (or implement directly against
  `https://api.storekit.itunes.apple.com/inApps/v1/transactions/{transactionId}`)
- Authentication via App Store Connect API key (P8 private key + Issuer ID +
  Key ID — generated in App Store Connect → Users and Access → Keys)
- Verify signed `JWSTransaction` payload (StoreKit 2 format)
- Validate `bundleId` matches `com.shyden.shytalk`
- Validate `productId` is in the known catalog
- Reject if `revocationReason` is set (refund / family-share revoke)

**Secret handling:**

- `APPLE_APP_STORE_KEY_ID`, `APPLE_APP_STORE_ISSUER_ID`,
  `APPLE_APP_STORE_PRIVATE_KEY` — three new env vars
- Stored as Cloud Run secret bindings (matches existing pattern for
  `GOOGLE_PLAY_KEY_FILE`)

### Block 3 — iOS StoreKit 2 client integration in Kotlin/Swift

`IosEconomyRepositoryImpl.purchaseCoins` / `purchaseSubscription` must be
wired up to a Swift `StoreKitManager` that:

1. Loads the product catalog via `Product.products(for: productIds)`
2. Triggers the purchase via `product.purchase()`
3. Receives a `VerificationResult<Transaction>` and forwards the signed JWS
   to the Express API for server-side validation
4. Calls `transaction.finish()` only after Express returns 200
   (idempotent, so retry-safe on app relaunch via `Transaction.unfinished`)
5. Listens to `Transaction.updates` for refunds/upgrades

**Bridge pattern** (matches existing `LiveKitBridge` / `PushBridge`):

- Top-level `registerStoreKitBridge(...)` in
  `shared/src/iosMain/.../economy/IosStoreKitBridge.kt`
- Swift impl `iosApp/iosApp/StoreKitBridge.swift` registered from `iOSApp.swift`
  during init (after Koin)
- Volatile `MutableStateFlow` for `productCatalog` so the wallet UI can
  observe when products load

**Files to create/modify:**

- `shared/src/iosMain/kotlin/com/shyden/shytalk/economy/IosStoreKitBridge.kt` (new)
- `iosApp/iosApp/StoreKitBridge.swift` (new)
- `iosApp/iosApp/iOSApp.swift` — register bridge after Koin init
- `iosApp/iosApp/iosApp.entitlements` — add `com.apple.developer.in-app-payments`
  if not present (StoreKit 2 doesn't strictly need it, but the legacy entitlement
  is wise for forward-compat)
- `shared/src/iosMain/kotlin/com/shyden/shytalk/data/repository/IosEconomyGiftRepositories.kt:185-195`
  — replace stubs with bridge calls
- `shared/src/iosMain/kotlin/com/shyden/shytalk/navigation/IosPlatformNavCallbacks.kt:100-106`
  — replace logW with bridge `purchase(productId)` call
- `shared/src/iosMain/kotlin/com/shyden/shytalk/core/di/IosPlatformModule.kt`
  — add `single { StoreKitManager(bridgeProvider = ::getStoreKitBridge) }`

## Action Plan (in order)

The iOS economy stays stubbed until **Step 1** lands. Steps 2-4 can ship
incrementally once products exist.

| Step | Action | Owner | Blocked by |
|------|--------|-------|-----------|
| 1 | Apple Developer Program membership active + App Store Connect record + 7 IAP products configured | User (manual, $99 + tax/banking forms) | — |
| 2 | Add Apple receipt validator to Express API (env vars + `verifyAppleReceipt` + branch in `/economy/purchase`) | Code | Step 1 (need product IDs to test against) |
| 3 | iOS StoreKit 2 bridge + Kotlin client (`IosStoreKitBridge`, Swift `StoreKitBridge`, replace `purchaseCoins`/`purchaseSubscription` stubs) | Code | Step 1 (sandbox products needed for end-to-end) |
| 4 | StoreKit `Transaction.updates` listener for refund handling | Code | Steps 1-3 |

## Sandbox Testing

Apple provides StoreKit sandbox accounts for testing without real charges:

- Create at App Store Connect → Users and Access → Sandbox → Testers
- Sandbox tester is a separate Apple ID, not your real one
- Use on a real device or iOS Simulator (Simulator support added in iOS 14)
- Subscriptions accelerate (1 month → 5 minutes, 1 year → 1 hour) so you can
  test renewals + upgrades end-to-end
- StoreKit Configuration File (`*.storekit`) lets you test purchases purely
  locally without App Store Connect — useful before Step 1 lands, but
  doesn't exercise server-side receipt validation against Apple's API

## Risk Assessment

- **User impact while stubbed:** iOS users see a snackbar/error when tapping
  any "Buy" button on the wallet/Super Shy screens. Feature-complete on
  Android, missing on iOS. Acceptable for TestFlight builds; **not** acceptable
  for App Store launch.
- **Apple review:** App Store review will REJECT the app at first submission
  if any "Buy" button visible to users does not actually work. Either disable
  the wallet/Super Shy UI on iOS until Step 3 lands, or block the App Store
  submission entirely until then.
- **Cross-platform parity:** Product IDs MUST match between Google Play and
  App Store Connect. Express API uses the productId as the dispatcher to
  pick the correct tier/grant logic.

## Related Files / Cross-References

- iOS stubs: `shared/src/iosMain/kotlin/com/shyden/shytalk/data/repository/IosEconomyGiftRepositories.kt:185-195`
- iOS billing nav stubs: `shared/src/iosMain/kotlin/com/shyden/shytalk/navigation/IosPlatformNavCallbacks.kt:98-107`
- Express purchase endpoint: `express-api/src/routes/economy.js:1270-1390`
- Android billing impl: `shared/src/androidMain/kotlin/com/shyden/shytalk/billing/` (Google Play Billing v8)
- iOS parity plan: `.project/plans/2026-04-21-ios-feature-parity.md` (StoreKit listed in Risk Register, line 326)
- iOS real-impl plan: `.project/plans/2026-04-23-ios-real-implementations.md:79-85` (PR H decision noted)
