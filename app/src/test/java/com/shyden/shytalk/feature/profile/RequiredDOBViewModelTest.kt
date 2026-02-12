package com.shyden.shytalk.feature.profile

import com.google.firebase.Timestamp
import com.google.firebase.auth.FirebaseUser
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.util.Date

@OptIn(ExperimentalCoroutinesApi::class)
class RequiredDOBViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val authRepository = mockk<AuthRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)
    private val userId = "user-1"
    private val testDob = Timestamp(Date(946684800000L))

    @Before
    fun setup() {
        val mockUser = mockk<FirebaseUser> {
            every { uid } returns userId
        }
        every { authRepository.currentUser } returns mockUser
    }

    private fun createViewModel() = RequiredDOBViewModel(
        authRepository = authRepository,
        userRepository = userRepository
    )

    @Test
    fun `saveDateOfBirth - success sets saved`() = runTest {
        coEvery { userRepository.updateProfile(userId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.saveDateOfBirth(testDob)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.saved)
        assertFalse(vm.uiState.value.isLoading)
        coVerify { userRepository.updateProfile(userId, mapOf("dateOfBirth" to testDob)) }
    }

    @Test
    fun `saveDateOfBirth - error sets error`() = runTest {
        coEvery { userRepository.updateProfile(userId, any()) } returns Resource.Error("fail")

        val vm = createViewModel()
        vm.saveDateOfBirth(testDob)
        advanceUntilIdle()

        assertEquals("Failed to save date of birth", vm.uiState.value.error)
        assertFalse(vm.uiState.value.saved)
        assertFalse(vm.uiState.value.isLoading)
    }

    @Test
    fun `saveDateOfBirth - no auth user does nothing`() = runTest {
        every { authRepository.currentUser } returns null

        val vm = createViewModel()
        vm.saveDateOfBirth(testDob)
        advanceUntilIdle()

        assertFalse(vm.uiState.value.saved)
        coVerify(exactly = 0) { userRepository.updateProfile(any(), any()) }
    }

    @Test
    fun `clearError clears error`() = runTest {
        coEvery { userRepository.updateProfile(userId, any()) } returns Resource.Error("fail")

        val vm = createViewModel()
        vm.saveDateOfBirth(testDob)
        advanceUntilIdle()
        assertEquals("Failed to save date of birth", vm.uiState.value.error)

        vm.clearError()
        assertNull(vm.uiState.value.error)
    }
}
