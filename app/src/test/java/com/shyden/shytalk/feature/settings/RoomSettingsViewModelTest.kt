package com.shyden.shytalk.feature.settings

import com.google.firebase.auth.FirebaseUser
import com.shyden.shytalk.core.model.SeatRequest
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.MessageRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.SeatRequestRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class RoomSettingsViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val roomRepository = mockk<RoomRepository>(relaxed = true)
    private val seatRequestRepository = mockk<SeatRequestRepository>(relaxed = true)
    private val messageRepository = mockk<MessageRepository>(relaxed = true)
    private val authRepository = mockk<AuthRepository>(relaxed = true)

    private val currentUserId = "current-user"
    private val ownerId = "owner-1"
    private val roomId = "room-1"

    @Before
    fun setup() {
        val mockUser = mockk<FirebaseUser> {
            every { uid } returns currentUserId
        }
        every { authRepository.currentUser } returns mockUser
        every { seatRequestRepository.getPendingRequests(any()) } returns flowOf(emptyList())
    }

    private fun createViewModel() = RoomSettingsViewModel(
        roomRepository = roomRepository,
        seatRequestRepository = seatRequestRepository,
        messageRepository = messageRepository,
        authRepository = authRepository
    )

    private fun loadRoomAsOwner(vm: RoomSettingsViewModel, requireApproval: Boolean = false) {
        val roomFlow = MutableStateFlow(TestData.createTestRoom(
            roomId = roomId,
            ownerId = currentUserId,
            requireApproval = requireApproval
        ))
        every { roomRepository.getRoomFlow(roomId) } returns roomFlow
        vm.loadRoom(roomId)
    }

    private fun loadRoomAsHost(vm: RoomSettingsViewModel, requireApproval: Boolean = false) {
        val roomFlow = MutableStateFlow(TestData.createTestRoom(
            roomId = roomId,
            ownerId = ownerId,
            hostIds = listOf(currentUserId),
            requireApproval = requireApproval
        ))
        every { roomRepository.getRoomFlow(roomId) } returns roomFlow
        vm.loadRoom(roomId)
    }

    private fun loadRoomAsAttendee(vm: RoomSettingsViewModel) {
        val roomFlow = MutableStateFlow(TestData.createTestRoom(
            roomId = roomId,
            ownerId = ownerId
        ))
        every { roomRepository.getRoomFlow(roomId) } returns roomFlow
        vm.loadRoom(roomId)
    }

    // ===== addHost =====

    @Test
    fun `addHost - owner can add host`() = runTest {
        val vm = createViewModel()
        loadRoomAsOwner(vm)
        advanceUntilIdle()

        vm.addHost("user-2")
        advanceUntilIdle()

        coVerify { roomRepository.addHost(roomId, "user-2") }
    }

    @Test
    fun `addHost - non-owner cannot add host`() = runTest {
        val vm = createViewModel()
        loadRoomAsHost(vm)
        advanceUntilIdle()

        vm.addHost("user-2")
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.addHost(any(), any()) }
    }

    // ===== removeHost =====

    @Test
    fun `removeHost - owner can remove host`() = runTest {
        val vm = createViewModel()
        loadRoomAsOwner(vm)
        advanceUntilIdle()

        vm.removeHost("user-2")
        advanceUntilIdle()

        coVerify { roomRepository.removeHost(roomId, "user-2") }
    }

    @Test
    fun `removeHost - non-owner cannot remove host`() = runTest {
        val vm = createViewModel()
        loadRoomAsHost(vm)
        advanceUntilIdle()

        vm.removeHost("user-2")
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.removeHost(any(), any()) }
    }

    // ===== inviteUser =====

    @Test
    fun `inviteUser - owner can always invite`() = runTest {
        val vm = createViewModel()
        loadRoomAsOwner(vm, requireApproval = true)
        advanceUntilIdle()

        vm.inviteUser("user-2", "User 2")
        advanceUntilIdle()

        coVerify { roomRepository.sendInvite(roomId, "user-2", currentUserId) }
    }

    @Test
    fun `inviteUser - host invites when requireApproval OFF`() = runTest {
        val vm = createViewModel()
        loadRoomAsHost(vm, requireApproval = false)
        advanceUntilIdle()

        vm.inviteUser("user-2", "User 2")
        advanceUntilIdle()

        coVerify { roomRepository.sendInvite(roomId, "user-2", currentUserId) }
    }

    @Test
    fun `inviteUser - host blocked when requireApproval ON`() = runTest {
        val vm = createViewModel()
        loadRoomAsHost(vm, requireApproval = true)
        advanceUntilIdle()

        vm.inviteUser("user-2", "User 2")
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.sendInvite(any(), any(), any()) }
    }

    @Test
    fun `inviteUser - attendee cannot invite`() = runTest {
        val vm = createViewModel()
        loadRoomAsAttendee(vm)
        advanceUntilIdle()

        vm.inviteUser("user-2", "User 2")
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.sendInvite(any(), any(), any()) }
    }

    // ===== approveRequest =====

    @Test
    fun `approveRequest - owner approves when requireApproval ON`() = runTest {
        val vm = createViewModel()
        loadRoomAsOwner(vm, requireApproval = true)
        advanceUntilIdle()
        val request = TestData.createTestSeatRequest()
        coEvery { seatRequestRepository.approveRequest(any(), any(), any()) } returns Resource.Success(request)

        vm.approveRequest(request)
        advanceUntilIdle()

        coVerify { seatRequestRepository.approveRequest(roomId, request.requestId, currentUserId) }
        coVerify { roomRepository.takeSeat(roomId, request.seatIndex, request.userId) }
    }

    @Test
    fun `approveRequest - host blocked when requireApproval ON`() = runTest {
        val vm = createViewModel()
        loadRoomAsHost(vm, requireApproval = true)
        advanceUntilIdle()
        val request = TestData.createTestSeatRequest()

        vm.approveRequest(request)
        advanceUntilIdle()

        coVerify(exactly = 0) { seatRequestRepository.approveRequest(any(), any(), any()) }
    }

    @Test
    fun `approveRequest - host approves when requireApproval OFF`() = runTest {
        val vm = createViewModel()
        loadRoomAsHost(vm, requireApproval = false)
        advanceUntilIdle()
        val request = TestData.createTestSeatRequest()
        coEvery { seatRequestRepository.approveRequest(any(), any(), any()) } returns Resource.Success(request)

        vm.approveRequest(request)
        advanceUntilIdle()

        coVerify { seatRequestRepository.approveRequest(roomId, request.requestId, currentUserId) }
    }

    @Test
    fun `approveRequest - attendee cannot approve`() = runTest {
        val vm = createViewModel()
        loadRoomAsAttendee(vm)
        advanceUntilIdle()
        val request = TestData.createTestSeatRequest()

        vm.approveRequest(request)
        advanceUntilIdle()

        coVerify(exactly = 0) { seatRequestRepository.approveRequest(any(), any(), any()) }
    }

    @Test
    fun `approveRequest - error sets error state`() = runTest {
        val vm = createViewModel()
        loadRoomAsOwner(vm)
        advanceUntilIdle()
        val request = TestData.createTestSeatRequest()
        coEvery { seatRequestRepository.approveRequest(any(), any(), any()) } returns Resource.Error("failed")

        vm.approveRequest(request)
        advanceUntilIdle()

        assertNotNull(vm.uiState.value.error)
    }

    // ===== closeRoom =====

    @Test
    fun `closeRoom - owner can close`() = runTest {
        val vm = createViewModel()
        loadRoomAsOwner(vm)
        advanceUntilIdle()

        vm.closeRoom()
        advanceUntilIdle()

        coVerify { roomRepository.closeRoom(roomId) }
    }

    @Test
    fun `closeRoom - non-owner cannot close`() = runTest {
        val vm = createViewModel()
        loadRoomAsHost(vm)
        advanceUntilIdle()

        vm.closeRoom()
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.closeRoom(any()) }
    }

    // ===== toggleRequireApproval =====

    @Test
    fun `toggleRequireApproval toggles value`() = runTest {
        val vm = createViewModel()
        loadRoomAsOwner(vm, requireApproval = false)
        advanceUntilIdle()

        vm.toggleRequireApproval()
        advanceUntilIdle()

        coVerify { roomRepository.setRequireApproval(roomId, true) }
    }

    // ===== clearError =====

    @Test
    fun `clearError clears error state`() = runTest {
        val vm = createViewModel()
        loadRoomAsOwner(vm)
        advanceUntilIdle()
        val request = TestData.createTestSeatRequest()
        coEvery { seatRequestRepository.approveRequest(any(), any(), any()) } returns Resource.Error("err")
        vm.approveRequest(request)
        advanceUntilIdle()

        vm.clearError()

        assertNull(vm.uiState.value.error)
    }
}
