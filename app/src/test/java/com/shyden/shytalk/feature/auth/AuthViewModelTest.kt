package com.shyden.shytalk.feature.auth

import com.google.firebase.auth.FirebaseUser
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.DeviceRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AuthViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val authRepository = mockk<AuthRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)
    private val deviceRepository = mockk<DeviceRepository>(relaxed = true)
    private val deviceId = "test-device-id"
    private val userId = "user-1"

    private fun mockFirebaseUser(): FirebaseUser = mockk {
        every { uid } returns userId
    }

    private fun createViewModel() = AuthViewModel(
        authRepository = authRepository,
        userRepository = userRepository,
        deviceRepository = deviceRepository,
        deviceId = deviceId
    )

    @Test
    fun `init - not authenticated stays default`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUser } returns null

        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isAuthenticated)
        assertFalse(vm.uiState.value.isLoading)
    }

    @Test
    fun `init - authenticated with profile sets both flags`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUser } returns mockFirebaseUser()
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isAuthenticated)
        assertTrue(vm.uiState.value.hasProfile)
    }

    @Test
    fun `init - device bound to different user locks device`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUser } returns mockFirebaseUser()
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success("other-user")

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isDeviceLocked)
        verify { authRepository.signOut() }
    }

    @Test
    fun `init - no device binding binds new device`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUser } returns mockFirebaseUser()
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(null)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)

        val vm = createViewModel()
        advanceUntilIdle()

        coVerify { deviceRepository.bindDevice(deviceId, userId) }
    }

    @Test
    fun `init - device binding network error is lenient`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUser } returns mockFirebaseUser()
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Error("network")
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isAuthenticated)
        assertFalse(vm.uiState.value.isDeviceLocked)
    }

    @Test
    fun `signInWithGoogle - success with new user`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUser } returns null
        val firebaseUser = mockFirebaseUser()
        coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success(firebaseUser)
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(null)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(false)

        val vm = createViewModel()
        advanceUntilIdle()
        vm.signInWithGoogle("token")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isAuthenticated)
        assertFalse(vm.uiState.value.hasProfile)
        coVerify { deviceRepository.bindDevice(deviceId, userId) }
    }

    @Test
    fun `signInWithGoogle - success with existing user`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUser } returns null
        val firebaseUser = mockFirebaseUser()
        coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success(firebaseUser)
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)

        val vm = createViewModel()
        advanceUntilIdle()
        vm.signInWithGoogle("token")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isAuthenticated)
        assertTrue(vm.uiState.value.hasProfile)
    }

    @Test
    fun `signInWithGoogle - device locked to different user`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUser } returns null
        val firebaseUser = mockFirebaseUser()
        coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Success(firebaseUser)
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success("other-user")

        val vm = createViewModel()
        advanceUntilIdle()
        vm.signInWithGoogle("token")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isDeviceLocked)
    }

    @Test
    fun `signInWithGoogle - auth error sets error`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUser } returns null
        coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Error("auth failed")

        val vm = createViewModel()
        advanceUntilIdle()
        vm.signInWithGoogle("token")
        advanceUntilIdle()

        assertEquals("auth failed", vm.uiState.value.error)
    }

    @Test
    fun `signOut resets state`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUser } returns mockFirebaseUser()
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success(userId)
        coEvery { userRepository.userExists(userId) } returns Resource.Success(true)

        val vm = createViewModel()
        advanceUntilIdle()
        assertTrue(vm.uiState.value.isAuthenticated)

        vm.signOut()

        assertFalse(vm.uiState.value.isAuthenticated)
        verify { authRepository.signOut() }
    }

    @Test
    fun `clearError clears error`() = runTest {
        every { authRepository.isAuthenticated } returns false
        every { authRepository.currentUser } returns null
        coEvery { authRepository.signInWithGoogleIdToken("token") } returns Resource.Error("err")

        val vm = createViewModel()
        vm.signInWithGoogle("token")
        advanceUntilIdle()

        vm.clearError()
        assertNull(vm.uiState.value.error)
    }

    @Test
    fun `clearDeviceLocked clears flag`() = runTest {
        every { authRepository.isAuthenticated } returns true
        every { authRepository.currentUser } returns mockFirebaseUser()
        coEvery { deviceRepository.getDeviceBinding(deviceId) } returns Resource.Success("other-user")

        val vm = createViewModel()
        advanceUntilIdle()
        assertTrue(vm.uiState.value.isDeviceLocked)

        vm.clearDeviceLocked()
        assertFalse(vm.uiState.value.isDeviceLocked)
    }
}
