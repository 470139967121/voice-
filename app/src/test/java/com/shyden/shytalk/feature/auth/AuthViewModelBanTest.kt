package com.shyden.shytalk.feature.auth

import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.BanStatus
import com.shyden.shytalk.data.repository.DeviceRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AuthViewModelBanTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val authRepository = mockk<AuthRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)
    private val deviceRepository = mockk<DeviceRepository>(relaxed = true)
    private val deviceId = "test-device-id"
    private val userId = "user-1"
    private val testDob = 946684800000L

    private val activeViewModels = mutableListOf<AuthViewModel>()

    @After
    fun tearDown() {
        activeViewModels.forEach { it.viewModelScope.coroutineContext.cancel() }
        activeViewModels.clear()
    }

    private fun createViewModel() = AuthViewModel(
        authRepository = authRepository,
        userRepository = userRepository,
        deviceRepository = deviceRepository,
        deviceId = deviceId
    ).also { activeViewModels.add(it) }

    @Test
    fun `init - device banned blocks authentication`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUserId } returns userId
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { deviceRepository.checkBanStatus(deviceId) } returns Resource.Success(
            BanStatus(isBanned = true, banType = "device", reason = "Spam", expiresAt = "2026-04-01T00:00:00Z")
        )

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isDeviceBanned)
        assertFalse(vm.uiState.value.isNetworkBanned)
        assertFalse(vm.uiState.value.isAuthenticated)
        assertEquals("Spam", vm.uiState.value.banReason)
        assertEquals("2026-04-01T00:00:00Z", vm.uiState.value.banExpiresAt)
    }

    @Test
    fun `init - network banned blocks authentication`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUserId } returns userId
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { deviceRepository.checkBanStatus(deviceId) } returns Resource.Success(
            BanStatus(isBanned = true, banType = "network_ip", reason = "VPN abuse", expiresAt = null)
        )

        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isDeviceBanned)
        assertTrue(vm.uiState.value.isNetworkBanned)
        assertFalse(vm.uiState.value.isAuthenticated)
        assertEquals("VPN abuse", vm.uiState.value.banReason)
        assertNull(vm.uiState.value.banExpiresAt)
    }

    @Test
    fun `init - not banned proceeds to profile resolution`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUserId } returns userId
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { deviceRepository.checkBanStatus(deviceId) } returns Resource.Success(BanStatus())
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)
        coEvery { userRepository.getUser(userId) } returns Resource.Success(
            TestData.createTestUser(uid = userId, dateOfBirth = testDob)
        )

        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isDeviceBanned)
        assertFalse(vm.uiState.value.isNetworkBanned)
        assertTrue(vm.uiState.value.isAuthenticated)
    }

    @Test
    fun `init - ban check error is lenient`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUserId } returns userId
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { deviceRepository.checkBanStatus(deviceId) } returns Resource.Error("network error")
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)
        coEvery { userRepository.getUser(userId) } returns Resource.Success(
            TestData.createTestUser(uid = userId, dateOfBirth = testDob)
        )

        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isDeviceBanned)
        assertFalse(vm.uiState.value.isNetworkBanned)
        assertTrue(vm.uiState.value.isAuthenticated)
    }

    @Test
    fun `signInWithGoogle - device banned after sign-in`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUserId } returns null
        coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success(userId)
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { deviceRepository.checkBanStatus(deviceId) } returns Resource.Success(
            BanStatus(isBanned = true, banType = "device", reason = "Abuse")
        )

        val vm = createViewModel()
        advanceUntilIdle()
        vm.signInWithGoogle("token")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isDeviceBanned)
        assertFalse(vm.uiState.value.isAuthenticated)
    }

    @Test
    fun `signInWithApple - network banned after sign-in`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUserId } returns null
        coEvery { authRepository.signInWithAppleIdToken("token", "nonce") } returns Resource.Success(userId)
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { deviceRepository.checkBanStatus(deviceId) } returns Resource.Success(
            BanStatus(isBanned = true, banType = "network_asn", reason = "Datacenter IP")
        )

        val vm = createViewModel()
        advanceUntilIdle()
        vm.signInWithApple("token", "nonce")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isNetworkBanned)
        assertFalse(vm.uiState.value.isAuthenticated)
    }

    @Test
    fun `signOut clears ban state`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUserId } returns userId
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { deviceRepository.checkBanStatus(deviceId) } returns Resource.Success(
            BanStatus(isBanned = true, banType = "device", reason = "Spam")
        )

        val vm = createViewModel()
        advanceUntilIdle()
        assertTrue(vm.uiState.value.isDeviceBanned)

        vm.signOut()

        assertFalse(vm.uiState.value.isDeviceBanned)
        assertFalse(vm.uiState.value.isNetworkBanned)
        assertNull(vm.uiState.value.banReason)
    }
}
