package com.shyden.shytalk.feature.settings

import com.google.firebase.Timestamp
import com.google.firebase.auth.FirebaseUser
import com.shyden.shytalk.core.model.SeatRequest
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.MessageRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.SeatRequestRepository
import com.shyden.shytalk.data.repository.UserRepository
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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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
    private val userRepository = mockk<UserRepository>(relaxed = true)

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
        authRepository = authRepository,
        userRepository = userRepository
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
            hostIds = setOf(currentUserId),
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
        val request = TestData.createTestSeatRequest(createdAt = Timestamp.now())
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
        val request = TestData.createTestSeatRequest(createdAt = Timestamp.now())
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
    fun `approveRequest - after 5s does NOT call takeSeat`() = runTest {
        val vm = createViewModel()
        loadRoomAsOwner(vm)
        advanceUntilIdle()
        // Request created 10 seconds ago
        val oldTimestamp = Timestamp(java.util.Date(System.currentTimeMillis() - 10_000L))
        val request = TestData.createTestSeatRequest(createdAt = oldTimestamp)
        coEvery { seatRequestRepository.approveRequest(any(), any(), any()) } returns Resource.Success(request)

        vm.approveRequest(request)
        advanceUntilIdle()

        coVerify { seatRequestRepository.approveRequest(roomId, request.requestId, currentUserId) }
        coVerify(exactly = 0) { roomRepository.takeSeat(any(), any(), any()) }
        coVerify { messageRepository.sendSystemMessage(roomId, "${request.userName}'s seat request was approved") }
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

    // ===== toggleRequireApproval owner-only (v0.18 fix) =====

    @Test
    fun `toggleRequireApproval - host cannot toggle`() = runTest {
        val vm = createViewModel()
        loadRoomAsHost(vm, requireApproval = false)
        advanceUntilIdle()

        vm.toggleRequireApproval()
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.setRequireApproval(any(), any()) }
    }

    @Test
    fun `toggleRequireApproval - attendee cannot toggle`() = runTest {
        val vm = createViewModel()
        loadRoomAsAttendee(vm)
        advanceUntilIdle()

        vm.toggleRequireApproval()
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.setRequireApproval(any(), any()) }
    }

    @Test
    fun `toggleRequireApproval - owner toggles ON to OFF`() = runTest {
        val vm = createViewModel()
        loadRoomAsOwner(vm, requireApproval = true)
        advanceUntilIdle()

        vm.toggleRequireApproval()
        advanceUntilIdle()

        coVerify { roomRepository.setRequireApproval(roomId, false) }
    }

    // ===== resolveUserNames =====

    @Test
    fun `loadRoom resolves user names for participants`() = runTest {
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(
            TestData.createTestUser(uid = currentUserId, displayName = "Current User")
        )
        val vm = createViewModel()
        loadRoomAsOwner(vm)
        advanceUntilIdle()

        val names = vm.uiState.value.userNames
        assertTrue(names.containsKey(currentUserId))
        assertEquals("Current User", names[currentUserId])
    }

    @Test
    fun `resolveUserNames falls back to ID prefix for empty displayName`() = runTest {
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(
            TestData.createTestUser(uid = currentUserId, displayName = "")
        )
        val vm = createViewModel()
        loadRoomAsOwner(vm)
        advanceUntilIdle()

        val names = vm.uiState.value.userNames
        assertEquals(currentUserId.take(8), names[currentUserId])
    }

    @Test
    fun `resolveUserNames skips already resolved IDs on subsequent emissions`() = runTest {
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(
            TestData.createTestUser(uid = currentUserId, displayName = "Current User")
        )
        val roomFlow = MutableStateFlow(TestData.createTestRoom(
            roomId = roomId,
            ownerId = currentUserId
        ))
        every { roomRepository.getRoomFlow(roomId) } returns roomFlow
        val vm = createViewModel()
        vm.loadRoom(roomId)
        advanceUntilIdle()

        // Re-emit the same room (e.g. a field changed)
        roomFlow.value = TestData.createTestRoom(
            roomId = roomId,
            ownerId = currentUserId,
            name = "Updated Name"
        )
        advanceUntilIdle()

        // getUser should only be called once for the same ID
        coVerify(exactly = 1) { userRepository.getUser(currentUserId) }
    }

    @Test
    fun `resolveUserNames handles failed lookup gracefully`() = runTest {
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Error("not found")
        val vm = createViewModel()
        loadRoomAsOwner(vm)
        advanceUntilIdle()

        // Name not added on failure, no crash
        assertFalse(vm.uiState.value.userNames.containsKey(currentUserId))
        assertNull(vm.uiState.value.error) // no global error set
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
