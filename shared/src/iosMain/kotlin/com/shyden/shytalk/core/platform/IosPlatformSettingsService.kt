@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package com.shyden.shytalk.core.platform

import androidx.compose.ui.graphics.ImageBitmap
import platform.Foundation.NSDateFormatter
import platform.Foundation.NSURL
import platform.Foundation.dateWithTimeIntervalSince1970
import platform.UIKit.UIApplication
import platform.UIKit.UIApplicationOpenSettingsURLString
import platform.UserNotifications.UNUserNotificationCenter

class IosPlatformSettingsService : PlatformSettingsService {
    override fun openUrl(url: String) {
        val nsUrl = NSURL.URLWithString(url) ?: return
        UIApplication.sharedApplication.openURL(nsUrl)
    }

    override fun openEmail(email: String) {
        openUrl("mailto:$email")
    }

    override fun openPlayStore(packageId: String) {
        // On iOS, open the App Store page
        openUrl("https://apps.apple.com/app/$packageId")
    }

    override fun openSystemSettings(type: SettingsType) {
        // iOS settings — all go to the app's settings page
        val url = NSURL.URLWithString(UIApplicationOpenSettingsURLString) ?: return
        UIApplication.sharedApplication.openURL(url)
    }

    override fun restartForLanguageChange() {
        // iOS handles language changes at the system level; no app restart needed
    }

    override fun formatDate(
        timestamp: Long,
        pattern: String,
    ): String {
        val formatter = NSDateFormatter()
        formatter.dateFormat = pattern
        val date = platform.Foundation.NSDate.dateWithTimeIntervalSince1970(timestamp / 1000.0)
        return formatter.stringFromDate(date)
    }

    override fun getAppVersionName(): String {
        val bundle = platform.Foundation.NSBundle.mainBundle
        return (bundle.infoDictionary?.get("CFBundleShortVersionString") as? String) ?: "?"
    }

    override fun getAppIcon(): ImageBitmap? {
        // iOS app icon cannot be loaded as ImageBitmap without platform-specific
        // UIImage→Skia conversion. The About page gracefully handles null (hides icon).
        return null
    }

    override fun areNotificationsEnabled(): Boolean {
        // UNUserNotificationCenter requires async check; return true as default
        // Real check would need a suspend function or callback pattern
        return true
    }

    override fun canDrawOverlays(): Boolean = false // No equivalent on iOS

    override fun hasPermission(permission: String): Boolean {
        // iOS permissions are checked through specific framework APIs,
        // not generic string-based like Android
        return true
    }
}
