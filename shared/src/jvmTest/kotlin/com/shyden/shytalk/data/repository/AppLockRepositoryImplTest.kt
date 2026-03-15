package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.SecureStorage
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AppLockRepositoryImplTest {
    private val storage = SecureStorage()
    private val repo = AppLockRepositoryImpl(storage)

    @Test
    fun `hasCredential returns false when no credential stored`() {
        assertFalse(repo.hasCredential)
    }

    @Test
    fun `hasCredential returns true after setCredential`() {
        repo.setCredential("12345678", "dev-1", "hashvalue")
        assertTrue(repo.hasCredential)
    }

    @Test
    fun `storedUniqueId returns null when no credential`() {
        assertNull(repo.storedUniqueId)
    }

    @Test
    fun `storedUniqueId returns value after setCredential`() {
        repo.setCredential("12345678", "dev-1", "hash")
        assertEquals("12345678", repo.storedUniqueId)
    }

    @Test
    fun `storedDeviceId returns value after setCredential`() {
        repo.setCredential("12345678", "dev-1", "hash")
        assertEquals("dev-1", repo.storedDeviceId)
    }

    @Test
    fun `localPinHash returns value after setCredential`() {
        repo.setCredential("12345678", "dev-1", "\$2b\$10\$hash")
        assertEquals("\$2b\$10\$hash", repo.localPinHash)
    }

    @Test
    fun `credentialVersion is set by setCredential`() {
        repo.setCredential("12345678", "dev-1", "hash")
        assertEquals(1, repo.credentialVersion)
    }

    @Test
    fun `isAppLockEnabled defaults to true`() {
        assertTrue(repo.isAppLockEnabled)
    }

    @Test
    fun `setAppLockEnabled persists value`() {
        repo.setAppLockEnabled(false)
        assertFalse(repo.isAppLockEnabled)
    }

    @Test
    fun `isBiometricEnabled defaults to false`() {
        assertFalse(repo.isBiometricEnabled)
    }

    @Test
    fun `setBiometricEnabled persists value`() {
        repo.setBiometricEnabled(true)
        assertTrue(repo.isBiometricEnabled)
    }

    @Test
    fun `lockTimeoutMinutes defaults to 5`() {
        assertEquals(5, repo.lockTimeoutMinutes)
    }

    @Test
    fun `setLockTimeoutMinutes persists value`() {
        repo.setLockTimeoutMinutes(15)
        assertEquals(15, repo.lockTimeoutMinutes)
    }

    @Test
    fun `isLockRequired returns false when app lock disabled`() {
        repo.setAppLockEnabled(false)
        assertFalse(repo.isLockRequired())
    }

    @Test
    fun `isLockRequired returns true when no timestamp exists`() {
        repo.setAppLockEnabled(true)
        repo.setLockTimeoutMinutes(5)
        assertTrue(repo.isLockRequired())
    }

    @Test
    fun `isLockRequired returns false when timeout is zero (Never)`() {
        repo.setAppLockEnabled(true)
        repo.setLockTimeoutMinutes(0)
        assertFalse(repo.isLockRequired())
    }

    @Test
    fun `isLockRequired returns false when recently active`() {
        repo.setAppLockEnabled(true)
        repo.setLockTimeoutMinutes(5)
        repo.updateLastActiveTimestamp() // just now
        assertFalse(repo.isLockRequired())
    }

    @Test
    fun `clearCredential removes all data`() {
        repo.setCredential("12345678", "dev-1", "hash")
        repo.setBiometricEnabled(true)
        repo.setLockTimeoutMinutes(30)

        repo.clearCredential()

        assertFalse(repo.hasCredential)
        assertNull(repo.storedUniqueId)
        assertNull(repo.localPinHash)
        assertFalse(repo.isBiometricEnabled)
    }

    @Test
    fun `setCredential updates lastActiveTimestamp`() {
        repo.setCredential("12345678", "dev-1", "hash")
        repo.setAppLockEnabled(true)
        repo.setLockTimeoutMinutes(5)
        // Just set credential, so lastActive is fresh — should not require lock
        assertFalse(repo.isLockRequired())
    }
}
