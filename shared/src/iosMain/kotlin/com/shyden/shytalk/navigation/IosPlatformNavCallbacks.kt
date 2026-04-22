package com.shyden.shytalk.navigation

import com.shyden.shytalk.core.util.logW
import platform.Foundation.NSCharacterSet
import platform.Foundation.NSString
import platform.Foundation.NSURL
import platform.Foundation.URLQueryAllowedCharacterSet
import platform.Foundation.stringByAddingPercentEncodingWithAllowedCharacters
import platform.Foundation.stringByRemovingPercentEncoding

/**
 * iOS implementation of [PlatformNavCallbacks].
 *
 * v1: Most callbacks are no-ops (FCM, permissions, billing, sync service).
 * URL encoding uses Foundation's percent-encoding APIs.
 * Media picking stubs will be replaced with PHPicker in a future PR.
 */
class IosPlatformNavCallbacks : PlatformNavCallbacks {
    // ── Push notifications (no-op v1 — APNs integration in future PR) ──

    override fun saveFcmToken(userId: String) {
        // No-op: APNs token management will be added later
    }

    override fun removeFcmToken(userId: String) {
        // No-op
    }

    // ── Background services (no-op v1) ──

    override fun startMessageSyncService() {
        // No-op: iOS background fetch will be added later
    }

    override fun stopMessageSyncService() {
        // No-op
    }

    // ── Permissions (no-op v1 — iOS handles permissions differently) ──

    override fun requestPermissions() {
        // No-op: iOS permissions are requested at point of use (microphone, notifications)
    }

    override fun canDrawOverlays(): Boolean = false // Not applicable on iOS

    // ── Media picking (stubs v1) ──

    override fun pickImages(
        maxCount: Int,
        onResult: (List<ByteArray>) -> Unit,
    ) {
        logW("IosPlatformNavCallbacks", "pickImages($maxCount) — PHPickerViewController not yet integrated")
        onResult(emptyList())
    }

    override fun pickStickerImage(onResult: (ByteArray?) -> Unit) {
        logW("IosPlatformNavCallbacks", "pickStickerImage — PHPickerViewController not yet integrated")
        onResult(null)
    }

    override fun pickAndCropPhoto(onResult: (ByteArray?) -> Unit) {
        logW("IosPlatformNavCallbacks", "pickAndCropPhoto — PHPickerViewController not yet integrated")
        onResult(null)
    }

    // ── Billing (no-op v1 — StoreKit integration in future PR) ──

    override fun purchasePackage(productId: String) {
        logW("IosPlatformNavCallbacks", "purchasePackage($productId) — StoreKit not yet integrated")
    }

    override fun purchaseSubscription(productId: String) {
        logW("IosPlatformNavCallbacks", "purchaseSubscription($productId) — StoreKit not yet integrated")
    }

    // ── URL encoding (real implementation using Foundation) ──

    @Suppress("CAST_NEVER_SUCCEEDS")
    override fun encodeUrl(url: String): String =
        (url as NSString)
            .stringByAddingPercentEncodingWithAllowedCharacters(
                NSCharacterSet.URLQueryAllowedCharacterSet,
            ) ?: url

    @Suppress("CAST_NEVER_SUCCEEDS")
    override fun decodeUrl(encoded: String): String = (encoded as NSString).stringByRemovingPercentEncoding ?: encoded
}
