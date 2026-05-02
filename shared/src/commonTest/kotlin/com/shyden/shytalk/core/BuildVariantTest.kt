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
}
