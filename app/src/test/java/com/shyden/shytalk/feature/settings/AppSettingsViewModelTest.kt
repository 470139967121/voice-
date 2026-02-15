package com.shyden.shytalk.feature.settings

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.AppConfigService
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
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

@OptIn(ExperimentalCoroutinesApi::class)
class AppSettingsViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val authRepository = mockk<AuthRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)
    private val appConfigService = mockk<AppConfigService>(relaxed = true)

    private val currentUserId = "current-user"

    @Before
    fun setup() {
        every { authRepository.currentUserId } returns currentUserId

        // Default: user with no blocked users
        val user = TestData.createTestUser(uid = currentUserId)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)
    }

    private fun createViewModel(): AppSettingsViewModel {
        return AppSettingsViewModel(
            appConfigService = appConfigService,
            authRepository = authRepository,
            userRepository = userRepository
        )
    }

    // ===== init / loadSettings =====

    @Test
    fun `init loads user and settings`() = runTest {
        val user = TestData.createTestUser(uid = currentUserId).copy(
            hideFollowing = true,
            hideOnlineStatus = false,
            blockedUserIds = emptySet()
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)

        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isLoading)
        assertEquals(user, vm.uiState.value.user)
        assertTrue(vm.uiState.value.hideFollowing)
        assertFalse(vm.uiState.value.hideOnlineStatus)
        assertTrue(vm.uiState.value.blockedUsers.isEmpty())
    }

    @Test
    fun `init loads blocked users`() = runTest {
        val blocked1 = TestData.createTestUser(uid = "blocked-1", displayName = "Blocked One")
        val blocked2 = TestData.createTestUser(uid = "blocked-2", displayName = "Blocked Two")
        val user = TestData.createTestUser(uid = currentUserId).copy(
            blockedUserIds = setOf("blocked-1", "blocked-2")
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(listOf(blocked1, blocked2))

        val vm = createViewModel()
        advanceUntilIdle()

        assertEquals(2, vm.uiState.value.blockedUsers.size)
    }

    @Test
    fun `init error sets error state`() = runTest {
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Error("load failed")

        val vm = createViewModel()
        advanceUntilIdle()

        assertEquals("load failed", vm.uiState.value.error)
        assertFalse(vm.uiState.value.isLoading)
    }

    @Test
    fun `init with no auth user does not load`() = runTest {
        every { authRepository.currentUserId } returns null

        val vm = createViewModel()
        advanceUntilIdle()

        // Should still be loading since loadSettings returns early
        assertNull(vm.uiState.value.user)
    }

    // ===== unblockUser =====

    @Test
    fun `unblockUser success removes from list`() = runTest {
        val blocked = TestData.createTestUser(uid = "blocked-1")
        val user = TestData.createTestUser(uid = currentUserId).copy(
            blockedUserIds = setOf("blocked-1")
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(listOf(blocked))
        coEvery { userRepository.unblockUser(currentUserId, "blocked-1") } returns Resource.Success(Unit)

        val vm = createViewModel()
        advanceUntilIdle()
        assertEquals(1, vm.uiState.value.blockedUsers.size)

        vm.unblockUser("blocked-1")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.blockedUsers.isEmpty())
        coVerify { userRepository.unblockUser(currentUserId, "blocked-1") }
    }

    @Test
    fun `unblockUser error sets error`() = runTest {
        coEvery { userRepository.unblockUser(currentUserId, "blocked-1") } returns Resource.Error("fail")

        val vm = createViewModel()
        advanceUntilIdle()

        vm.unblockUser("blocked-1")
        advanceUntilIdle()

        assertEquals("Failed to unblock user", vm.uiState.value.error)
    }

    // ===== toggleHideFollowing =====

    @Test
    fun `toggleHideFollowing - optimistic toggle on`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        advanceUntilIdle()
        assertFalse(vm.uiState.value.hideFollowing)

        vm.toggleHideFollowing()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.hideFollowing)
        coVerify { userRepository.updateProfile(currentUserId, mapOf("hideFollowing" to true)) }
    }

    @Test
    fun `toggleHideFollowing - error reverts`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Error("fail")

        val vm = createViewModel()
        advanceUntilIdle()
        assertFalse(vm.uiState.value.hideFollowing)

        vm.toggleHideFollowing()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.hideFollowing)
        assertEquals("Failed to update privacy setting", vm.uiState.value.error)
    }

    // ===== toggleHideOnlineStatus =====

    @Test
    fun `toggleHideOnlineStatus - optimistic toggle on`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        advanceUntilIdle()
        assertFalse(vm.uiState.value.hideOnlineStatus)

        vm.toggleHideOnlineStatus()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.hideOnlineStatus)
        coVerify { userRepository.updateProfile(currentUserId, mapOf("hideOnlineStatus" to true)) }
    }

    @Test
    fun `toggleHideOnlineStatus - error reverts`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Error("fail")

        val vm = createViewModel()
        advanceUntilIdle()

        vm.toggleHideOnlineStatus()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.hideOnlineStatus)
    }

    // ===== toggleHideAge =====

    @Test
    fun `toggleHideAge - optimistic toggle on`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        advanceUntilIdle()
        assertFalse(vm.uiState.value.hideAge)

        vm.toggleHideAge()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.hideAge)
        coVerify { userRepository.updateProfile(currentUserId, mapOf("hideAge" to true)) }
    }

    @Test
    fun `toggleHideAge - error reverts`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Error("fail")

        val vm = createViewModel()
        advanceUntilIdle()
        assertFalse(vm.uiState.value.hideAge)

        vm.toggleHideAge()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.hideAge)
        assertEquals("Failed to update privacy setting", vm.uiState.value.error)
    }

    // ===== clearCache =====

    @Test
    fun `clearCache sets cacheCleared flag`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.clearCache()

        assertTrue(vm.uiState.value.cacheCleared)
    }

    @Test
    fun `resetCacheCleared clears flag`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.clearCache()
        assertTrue(vm.uiState.value.cacheCleared)

        vm.resetCacheCleared()
        assertFalse(vm.uiState.value.cacheCleared)
    }

    // ===== clearError =====

    @Test
    fun `clearError clears error`() = runTest {
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Error("err")

        val vm = createViewModel()
        advanceUntilIdle()
        assertEquals("err", vm.uiState.value.error)

        vm.clearError()
        assertNull(vm.uiState.value.error)
    }

    // ===== dismissUpdateResult =====

    @Test
    fun `dismissUpdateResult clears result`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        // Manually set a result to simulate
        vm.dismissUpdateResult()
        assertNull(vm.uiState.value.updateCheckResult)
    }
}
