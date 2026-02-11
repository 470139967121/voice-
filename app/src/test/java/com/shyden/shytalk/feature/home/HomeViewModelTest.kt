package com.shyden.shytalk.feature.home

import com.google.firebase.auth.FirebaseUser
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class HomeViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val roomRepository = mockk<RoomRepository>(relaxed = true)
    private val authRepository = mockk<AuthRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)

    private val roomsFlow = MutableSharedFlow<List<ChatRoom>>()
    private val currentUserId = "current-user"

    @Before
    fun setup() {
        val mockUser = mockk<FirebaseUser> {
            every { uid } returns currentUserId
        }
        every { authRepository.currentUser } returns mockUser
        every { roomRepository.getActiveRooms() } returns roomsFlow
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())
    }

    private fun createViewModel() = HomeViewModel(
        roomRepository = roomRepository,
        authRepository = authRepository,
        userRepository = userRepository
    )

    @Test
    fun `room owned by blocked user is excluded`() = runTest {
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(setOf("blocked-owner"))
        coEvery { userRepository.getUser("blocked-owner") } returns Resource.Success(
            TestData.createTestUser(uid = "blocked-owner")
        )
        val vm = createViewModel()
        advanceUntilIdle()

        roomsFlow.emit(listOf(TestData.createTestRoom(ownerId = "blocked-owner")))
        advanceUntilIdle()

        assertTrue(vm.uiState.value.rooms.isEmpty())
    }

    @Test
    fun `room whose owner blocked current user is excluded`() = runTest {
        coEvery { userRepository.getUser("hostile-owner") } returns Resource.Success(
            TestData.createTestUser(uid = "hostile-owner", blockedUserIds = setOf(currentUserId))
        )
        val vm = createViewModel()
        advanceUntilIdle()

        roomsFlow.emit(listOf(TestData.createTestRoom(ownerId = "hostile-owner")))
        advanceUntilIdle()

        assertTrue(vm.uiState.value.rooms.isEmpty())
    }

    @Test
    fun `normal room is included`() = runTest {
        coEvery { userRepository.getUser("good-owner") } returns Resource.Success(
            TestData.createTestUser(uid = "good-owner")
        )
        val vm = createViewModel()
        advanceUntilIdle()

        roomsFlow.emit(listOf(TestData.createTestRoom(ownerId = "good-owner")))
        advanceUntilIdle()

        assertEquals(1, vm.uiState.value.rooms.size)
    }

    @Test
    fun `createRoom closes existing rooms first`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()
        coEvery { roomRepository.createRoom(any(), any()) } returns Resource.Success("new-room-id")

        vm.createRoom("My Room")
        advanceUntilIdle()

        coVerify { roomRepository.closeAllRoomsByOwner(currentUserId) }
        coVerify { roomRepository.createRoom("My Room", currentUserId) }
        assertEquals("new-room-id", vm.uiState.value.createdRoomId)
    }

    @Test
    fun `createRoom error sets error`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()
        coEvery { roomRepository.createRoom(any(), any()) } returns Resource.Error("failed")

        vm.createRoom("My Room")
        advanceUntilIdle()

        assertNotNull(vm.uiState.value.error)
        assertNull(vm.uiState.value.createdRoomId)
    }

    @Test
    fun `onRoomNavigated clears createdRoomId`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()
        coEvery { roomRepository.createRoom(any(), any()) } returns Resource.Success("new-room")
        vm.createRoom("Room")
        advanceUntilIdle()

        vm.onRoomNavigated()

        assertNull(vm.uiState.value.createdRoomId)
    }

    @Test
    fun `clearError clears error`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()
        coEvery { roomRepository.createRoom(any(), any()) } returns Resource.Error("err")
        vm.createRoom("Room")
        advanceUntilIdle()

        vm.clearError()

        assertNull(vm.uiState.value.error)
    }

    @Test
    fun `signOut calls auth signOut`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.signOut()

        verify { authRepository.signOut() }
    }

    @Test
    fun `isLoading becomes false after rooms emit`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        roomsFlow.emit(emptyList())
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isLoading)
    }
}
