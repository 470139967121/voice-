package com.shyden.shytalk.core

import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class BuildVariantTest {
    @AfterTest
    fun resetState() {
        BuildVariant.initLocalEmulator(false)
        BuildVariant.initIosDeviceId(null)
        BuildVariant.initBuildInfo(environment = "prod", buildVersion = "?", deviceInfo = "?")
    }

    @Test
    fun `defaults to false for production safety`() {
        BuildVariant.initLocalEmulator(false)
        assertFalse(BuildVariant.isLocalEmulator)
    }

    @Test
    fun `can be set to true for local emulator builds`() {
        BuildVariant.initLocalEmulator(true)
        assertTrue(BuildVariant.isLocalEmulator)
    }

    @Test
    fun `can be toggled back to false`() {
        BuildVariant.initLocalEmulator(true)
        BuildVariant.initLocalEmulator(false)
        assertFalse(BuildVariant.isLocalEmulator)
    }

    @Test
    fun `localDevPassword defaults to null`() {
        BuildVariant.initLocalEmulator(false)
        assertNull(BuildVariant.localDevPassword)
    }

    @Test
    fun `localDevPassword captures non-empty value`() {
        BuildVariant.initLocalEmulator(true, "localdev123")
        assertEquals("localdev123", BuildVariant.localDevPassword)
    }

    @Test
    fun `localDevPassword coerces empty string to null so callers can read uniformly`() {
        // Android's BuildConfig.LOCAL_DEV_PASSWORD is "" on dev / prod
        // flavours. The setter coerces to null so SignInScreen can use
        // the same `password.isNullOrEmpty()` guard regardless of source.
        BuildVariant.initLocalEmulator(true, "")
        assertNull(BuildVariant.localDevPassword)
    }

    @Test
    fun `localDevPassword cleared when switched back to non-emulator state`() {
        BuildVariant.initLocalEmulator(true, "localdev123")
        BuildVariant.initLocalEmulator(false)
        assertNull(BuildVariant.localDevPassword)
    }

    @Test
    fun `localDevEmail captures non-empty value`() {
        BuildVariant.initLocalEmulator(value = true, devEmail = "claude-test@shytalk.dev")
        assertEquals("claude-test@shytalk.dev", BuildVariant.localDevEmail)
    }

    @Test
    fun `localDevEmail coerces empty string to null`() {
        BuildVariant.initLocalEmulator(value = true, devEmail = "")
        assertNull(BuildVariant.localDevEmail)
    }

    @Test
    fun `googleWebClientId captures non-empty value`() {
        BuildVariant.initLocalEmulator(
            value = true,
            googleWebClientId = "1234-test.apps.googleusercontent.com",
        )
        assertEquals("1234-test.apps.googleusercontent.com", BuildVariant.googleWebClientId)
    }

    @Test
    fun `googleWebClientId coerces empty string to null`() {
        BuildVariant.initLocalEmulator(value = false, googleWebClientId = "")
        assertNull(BuildVariant.googleWebClientId)
    }

    @Test
    fun `iosDeviceId defaults to null`() {
        assertNull(BuildVariant.iosDeviceId)
    }

    @Test
    fun `iosDeviceId captures non-blank value`() {
        BuildVariant.initIosDeviceId("AAAA-BBBB-CCCC-DDDD")
        assertEquals("AAAA-BBBB-CCCC-DDDD", BuildVariant.iosDeviceId)
    }

    @Test
    fun `iosDeviceId coerces empty string to null so Koin factory fails closed`() {
        BuildVariant.initIosDeviceId("")
        assertNull(BuildVariant.iosDeviceId)
    }

    @Test
    fun `iosDeviceId coerces blank-whitespace string to null`() {
        // Defends against a future Swift bridge bug that forwards "   " for
        // a UUID stringification edge case — the Koin factory's `?: error`
        // fail-closed gate must trigger, not pass a junk ID to the Express
        // API where it would land in deviceBindings/<deviceId>.
        BuildVariant.initIosDeviceId("   ")
        assertNull(BuildVariant.iosDeviceId)
    }

    @Test
    fun `iosDeviceId persists independently of initLocalEmulator state`() {
        // Boot order in iOSApp.swift sets deviceId BEFORE doInitKoin's
        // emulator flag — verify the deviceId isn't clobbered by a
        // subsequent initLocalEmulator(false) reset.
        BuildVariant.initIosDeviceId("device-uuid-1")
        BuildVariant.initLocalEmulator(value = false, devPassword = null)
        assertEquals("device-uuid-1", BuildVariant.iosDeviceId)
    }

    @Test
    fun `all build-time slots cleared on toggle to non-emulator without args`() {
        // Test fixture credentials — emulator-only, see local/seed.js.
        val seedPwd = "localdev123"
        BuildVariant.initLocalEmulator(
            value = true,
            devPassword = seedPwd,
            devEmail = "claude-test@shytalk.dev",
            googleWebClientId = "client-id",
        )
        BuildVariant.initLocalEmulator(false)
        assertNull(BuildVariant.localDevPassword)
        assertNull(BuildVariant.localDevEmail)
        assertNull(BuildVariant.googleWebClientId)
    }

    // ── PreviewWatermark build-info slots ──
    //
    // The non-prod watermark overlay reads `environment` and `buildVersion`
    // from BuildVariant. Defaults must fail-safe to "prod" / "?" so a
    // misconfigured platform initialiser does NOT show the watermark on
    // a real production build (false positives erode trust in the
    // signal); a missed watermark on a misconfigured non-prod build is
    // visually obvious during dev so it self-corrects.

    @Test
    fun `environment defaults to prod for fail-safe production behaviour`() {
        // Reset is via initLocalEmulator(false) only — environment slot
        // must default to "prod" without any initialiser call.
        assertEquals("prod", BuildVariant.environment)
    }

    @Test
    fun `buildVersion defaults to placeholder so initialiser absence is visible`() {
        assertEquals("?", BuildVariant.buildVersion)
    }

    @Test
    fun `initBuildInfo sets environment to local`() {
        BuildVariant.initBuildInfo(environment = "local", buildVersion = "1.0.0 (1)")
        assertEquals("local", BuildVariant.environment)
    }

    @Test
    fun `initBuildInfo sets environment to dev`() {
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.2.3 (456)")
        assertEquals("dev", BuildVariant.environment)
    }

    @Test
    fun `initBuildInfo sets environment to prod`() {
        BuildVariant.initBuildInfo(environment = "prod", buildVersion = "2.0.0 (789)")
        assertEquals("prod", BuildVariant.environment)
    }

    @Test
    fun `initBuildInfo captures buildVersion verbatim`() {
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.2.3 (456)")
        assertEquals("1.2.3 (456)", BuildVariant.buildVersion)
    }

    @Test
    fun `initBuildInfo coerces empty environment to prod for safety`() {
        // Defends against an iOS bridge bug that forwards "" — the
        // PreviewWatermark must NOT show on prod, so an empty
        // environment string falls back to "prod" (not "" rendered as
        // an empty badge).
        BuildVariant.initBuildInfo(environment = "", buildVersion = "1.0")
        assertEquals("prod", BuildVariant.environment)
    }

    @Test
    fun `initBuildInfo coerces blank environment to prod`() {
        BuildVariant.initBuildInfo(environment = "   ", buildVersion = "1.0")
        assertEquals("prod", BuildVariant.environment)
    }

    @Test
    fun `initBuildInfo coerces empty buildVersion to placeholder`() {
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "")
        assertEquals("?", BuildVariant.buildVersion)
    }

    @Test
    fun `isPreviewBuild returns false for prod`() {
        BuildVariant.initBuildInfo(environment = "prod", buildVersion = "2.0.0 (789)")
        assertFalse(BuildVariant.isPreviewBuild)
    }

    @Test
    fun `isPreviewBuild returns true for dev`() {
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.2.3 (456)")
        assertTrue(BuildVariant.isPreviewBuild)
    }

    @Test
    fun `isPreviewBuild returns true for local`() {
        BuildVariant.initBuildInfo(environment = "local", buildVersion = "1.0.0 (1)")
        assertTrue(BuildVariant.isPreviewBuild)
    }

    @Test
    fun `build info slots persist independently of initLocalEmulator`() {
        // Boot order in MainActivity / iOSApp may interleave: emulator
        // flag set first, then build info, OR the other way round.
        // Verify neither slot clobbers the other.
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.2.3 (456)")
        BuildVariant.initLocalEmulator(value = false)
        assertEquals("dev", BuildVariant.environment)
        assertEquals("1.2.3 (456)", BuildVariant.buildVersion)
    }

    // ── Device info for watermark ──
    //
    // The watermark also surfaces the device model + OS so leaked
    // screenshots can be tied back to specific devices (e.g. for
    // QA on a physical phone, or an iOS simulator vs a real iPhone).
    // Android passes `${Build.MANUFACTURER} ${Build.MODEL} · Android
    // ${Build.VERSION.RELEASE}`; iOS passes `${UIDevice.model} · iOS
    // ${UIDevice.systemVersion}`. Default `"?"` keeps the format
    // identical between platforms when an initialiser is missing.

    @Test
    fun `deviceInfo defaults to placeholder so missing initialiser is visible`() {
        assertEquals("?", BuildVariant.deviceInfo)
    }

    @Test
    fun `initBuildInfo captures deviceInfo verbatim`() {
        BuildVariant.initBuildInfo(
            environment = "dev",
            buildVersion = "1.2.3 (456)",
            deviceInfo = "Pixel 6 · Android 14",
        )
        assertEquals("Pixel 6 · Android 14", BuildVariant.deviceInfo)
    }

    @Test
    fun `initBuildInfo coerces empty deviceInfo to placeholder`() {
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.0", deviceInfo = "")
        assertEquals("?", BuildVariant.deviceInfo)
    }

    @Test
    fun `initBuildInfo coerces blank deviceInfo to placeholder`() {
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.0", deviceInfo = "   ")
        assertEquals("?", BuildVariant.deviceInfo)
    }

    @Test
    fun `initBuildInfo deviceInfo defaults to placeholder when omitted`() {
        // Backward compat: existing call sites that omit deviceInfo
        // should not break. The default-arg value yields the placeholder.
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.0")
        assertEquals("?", BuildVariant.deviceInfo)
    }

    // ── PreviewWatermarkConstants — UX guarantees ──
    //
    // The watermark must remain semi-transparent so the underlying UI
    // is legible. The user explicitly required: "we still need to be
    // able to see the app". The contract is alpha ≤ 0.5 (clearly
    // see-through) AND alpha ≥ 0.1 (not so faded it disappears on
    // light backgrounds). Tested as a constant rather than an
    // instrumented Compose render so the contract is enforceable from
    // the JVM unit-test layer that runs in pre-push and CI.

    @Test
    fun `watermark badge alpha is at most half-opaque`() {
        assertTrue(PreviewWatermarkConstants.BADGE_BACKGROUND_ALPHA <= 0.5f)
    }

    @Test
    fun `watermark badge alpha is at least faintly visible`() {
        assertTrue(PreviewWatermarkConstants.BADGE_BACKGROUND_ALPHA >= 0.1f)
    }
}
