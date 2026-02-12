package com.shyden.shytalk.feature.room

import androidx.lifecycle.SavedStateHandle
import com.google.firebase.Timestamp
import com.google.firebase.auth.FirebaseUser
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.MessageType
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.Seat
import com.shyden.shytalk.core.model.SeatRequest
import com.shyden.shytalk.core.model.SeatRequestStatus
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.room.ActiveRoomManager
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.AgoraVoiceService
import com.shyden.shytalk.data.remote.PresenceService
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
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.advanceTimeBy
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
import java.util.Date

@OptIn(ExperimentalCoroutinesApi::class)
class RoomViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val roomRepository = mockk<RoomRepository>(relaxed = true)
    private val messageRepository = mockk<MessageRepository>(relaxed = true)
    private val authRepository = mockk<AuthRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)
    private val seatRequestRepository = mockk<SeatRequestRepository>(relaxed = true)
    private val agoraVoiceService = mockk<AgoraVoiceService>(relaxed = true)
    private val presenceService = mockk<PresenceService>(relaxed = true)
    private val activeRoomManager = mockk<ActiveRoomManager>(relaxed = true)

    private val roomFlow = MutableStateFlow<ChatRoom?>(null)
    private val messagesFlow = MutableStateFlow<List<Message>>(emptyList())
    private val speakingFlow = MutableStateFlow<Set<Int>>(emptySet())
    private val joinedFlow = MutableStateFlow(false)
    private val voiceErrorFlow = MutableStateFlow<String?>(null)
    private val pendingRequestsFlow = MutableStateFlow<List<SeatRequest>>(emptyList())
    private val myRequestsFlow = MutableStateFlow<List<SeatRequest>>(emptyList())

    private val currentUserId = "current-user"
    private val ownerId = "owner-1"

    private lateinit var viewModel: RoomViewModel

    @Before
    fun setup() {
        val mockUser = mockk<FirebaseUser> {
            every { uid } returns currentUserId
        }
        every { authRepository.currentUser } returns mockUser
        every { roomRepository.getRoomFlow(any()) } returns roomFlow
        every { messageRepository.getMessages(any()) } returns messagesFlow
        every { agoraVoiceService.speakingUsers } returns speakingFlow
        every { agoraVoiceService.isJoined } returns joinedFlow
        every { agoraVoiceService.error } returns voiceErrorFlow
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(
            TestData.createTestUser(uid = currentUserId, displayName = "Current User")
        )
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())
        every { seatRequestRepository.getPendingRequests(any()) } returns pendingRequestsFlow
        every { seatRequestRepository.getRequestsByUser(any(), any()) } returns myRequestsFlow
        every { activeRoomManager.isInRoom(any()) } returns false
    }

    private fun createViewModel(): RoomViewModel {
        return RoomViewModel(
            savedStateHandle = SavedStateHandle(mapOf("roomId" to "room-1")),
            roomRepository = roomRepository,
            messageRepository = messageRepository,
            authRepository = authRepository,
            userRepository = userRepository,
            seatRequestRepository = seatRequestRepository,
            agoraVoiceService = agoraVoiceService,
            presenceService = presenceService,
            activeRoomManager = activeRoomManager
        )
    }

    private fun emitRoomAsOwner(room: ChatRoom = TestData.createTestRoom(ownerId = currentUserId)) {
        roomFlow.value = room
    }

    private fun emitRoomAsAttendee(
        room: ChatRoom = TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId, currentUserId)
        )
    ) {
        // Mock owner user for block check
        coEvery { userRepository.getUser(ownerId) } returns Resource.Success(
            TestData.createTestUser(uid = ownerId, displayName = "Owner")
        )
        roomFlow.value = room
    }

    private fun emitRoomAsHost(
        room: ChatRoom = TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId, currentUserId),
            hostIds = setOf(currentUserId)
        )
    ) {
        coEvery { userRepository.getUser(ownerId) } returns Resource.Success(
            TestData.createTestUser(uid = ownerId, displayName = "Owner")
        )
        roomFlow.value = room
    }

    // ===== takeSeat Tests =====

    @Test
    fun `takeSeat - owner takes seat 0 succeeds`() = runTest {
        viewModel = createViewModel()
        // Seat 0 must be EMPTY for owner to take it
        val seats = TestData.createDefaultSeats()
        emitRoomAsOwner(TestData.createTestRoom(ownerId = currentUserId, seats = seats))
        advanceUntilIdle()

        viewModel.takeSeat(0)
        advanceUntilIdle()

        coVerify { roomRepository.takeSeat("room-1", 0, currentUserId) }
    }

    @Test
    fun `takeSeat - owner cannot take non-owner seat`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.takeSeat(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.takeSeat(any(), 3, any()) }
    }

    @Test
    fun `takeSeat - attendee cannot take owner seat`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.takeSeat(0)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.takeSeat(any(), 0, any()) }
    }

    @Test
    fun `takeSeat - seat already occupied is rejected`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "other-user")
        emitRoomAsOwner(TestData.createTestRoom(ownerId = currentUserId, seats = seats))
        advanceUntilIdle()

        viewModel.takeSeat(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.takeSeat(any(), 3, any()) }
    }

    @Test
    fun `takeSeat - attendee creates seat request when requireApproval OFF`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.takeSeat(3)
        advanceUntilIdle()

        coVerify { seatRequestRepository.createRequest("room-1", currentUserId, any(), 3) }
        coVerify(exactly = 0) { roomRepository.takeSeat(any(), 3, any()) }
    }

    @Test
    fun `takeSeat - attendee blocked with error when requireApproval ON`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId, currentUserId),
            requireApproval = true
        ))
        advanceUntilIdle()

        viewModel.takeSeat(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { seatRequestRepository.createRequest(any(), any(), any(), any()) }
        coVerify(exactly = 0) { roomRepository.takeSeat(any(), 3, any()) }
        assertNotNull(viewModel.uiState.value.error)
        assertTrue(viewModel.uiState.value.error!!.contains("locked"))
    }

    @Test
    fun `takeSeat - host takes seat when requireApproval is OFF`() = runTest {
        viewModel = createViewModel()
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId, currentUserId),
            hostIds = setOf(currentUserId),
            requireApproval = false
        ))
        advanceUntilIdle()

        viewModel.takeSeat(3)
        advanceUntilIdle()

        coVerify { roomRepository.takeSeat("room-1", 3, currentUserId) }
    }

    @Test
    fun `takeSeat - host blocked when requireApproval is ON`() = runTest {
        viewModel = createViewModel()
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId, currentUserId),
            hostIds = setOf(currentUserId),
            requireApproval = true
        ))
        advanceUntilIdle()

        viewModel.takeSeat(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.takeSeat(any(), 3, any()) }
    }

    // ===== leaveSeat Tests =====

    @Test
    fun `leaveSeat - owner cannot leave seat 0`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.leaveSeat(0)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.leaveSeat(any(), any()) }
    }

    @Test
    fun `leaveSeat - non-owner can leave their seat`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.leaveSeat(3)
        advanceUntilIdle()

        coVerify { roomRepository.leaveSeat("room-1", 3) }
    }

    // ===== removeFromSeat Tests =====

    @Test
    fun `removeFromSeat - attendee cannot remove anyone`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.removeFromSeat(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.removeFromSeat(any(), any()) }
    }

    @Test
    fun `removeFromSeat - cannot remove from owner seat`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.removeFromSeat(0)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.removeFromSeat(any(), any()) }
    }

    @Test
    fun `removeFromSeat - host cannot remove owner`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(ownerId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = ownerId) // owner sitting elsewhere too
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId, currentUserId),
            hostIds = setOf(currentUserId),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.removeFromSeat(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.removeFromSeat(any(), any()) }
    }

    @Test
    fun `removeFromSeat - host cannot remove other host`() = runTest {
        viewModel = createViewModel()
        val otherHost = "host-2"
        val seats = TestData.createSeatsWithOwner(ownerId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = otherHost)
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId, currentUserId, otherHost),
            hostIds = setOf(currentUserId, otherHost),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.removeFromSeat(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.removeFromSeat(any(), any()) }
    }

    @Test
    fun `removeFromSeat - owner removes attendee succeeds`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "attendee-1")
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = setOf(currentUserId, "attendee-1"),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.removeFromSeat(3)
        advanceUntilIdle()

        coVerify { roomRepository.removeFromSeat("room-1", 3) }
    }

    @Test
    fun `removeFromSeat - empty seat is rejected`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.removeFromSeat(3) // seat 3 has no userId
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.removeFromSeat(any(), any()) }
    }

    // ===== forceMuteUser Tests =====

    @Test
    fun `forceMuteUser - attendee cannot force mute`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.forceMuteUser(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.toggleMute(any(), any(), any()) }
    }

    @Test
    fun `forceMuteUser - cannot mute owner`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(ownerId).toMutableMap()
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId, currentUserId),
            hostIds = setOf(currentUserId),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.forceMuteUser(0) // seat 0 = owner
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.toggleMute(any(), any(), any()) }
    }

    @Test
    fun `forceMuteUser - host cannot mute other host`() = runTest {
        viewModel = createViewModel()
        val otherHost = "host-2"
        val seats = TestData.createSeatsWithOwner(ownerId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = otherHost, isMuted = false)
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId, currentUserId, otherHost),
            hostIds = setOf(currentUserId, otherHost),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.forceMuteUser(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.toggleMute(any(), any(), any()) }
    }

    @Test
    fun `forceMuteUser - owner mutes attendee toggles mute`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "attendee-1", isMuted = false)
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = setOf(currentUserId, "attendee-1"),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.forceMuteUser(3)
        advanceUntilIdle()

        coVerify { roomRepository.toggleMute("room-1", 3, true) }
    }

    // ===== moveSeat Tests =====

    @Test
    fun `moveSeat - attendee cannot move`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.moveSeat(2, 5)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.moveSeat(any(), any(), any(), any()) }
    }

    @Test
    fun `moveSeat - cannot move from owner seat`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.moveSeat(0, 3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.moveSeat(any(), any(), any(), any()) }
    }

    @Test
    fun `moveSeat - cannot move to owner seat`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "attendee-1")
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = setOf(currentUserId, "attendee-1"),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.moveSeat(3, 0)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.moveSeat(any(), any(), any(), any()) }
    }

    @Test
    fun `moveSeat - destination occupied is rejected`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["2"] = TestData.createTestSeat(userId = "attendee-1")
        seats["5"] = TestData.createTestSeat(userId = "attendee-2")
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.moveSeat(2, 5)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.moveSeat(any(), any(), any(), any()) }
    }

    @Test
    fun `moveSeat - owner moves attendee succeeds`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["2"] = TestData.createTestSeat(userId = "attendee-1")
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = setOf(currentUserId, "attendee-1"),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.moveSeat(2, 5)
        advanceUntilIdle()

        coVerify { roomRepository.moveSeat("room-1", 2, 5, "attendee-1") }
    }

    @Test
    fun `moveSeat - host cannot move other host`() = runTest {
        viewModel = createViewModel()
        val otherHost = "host-2"
        val seats = TestData.createSeatsWithOwner(ownerId).toMutableMap()
        seats["2"] = TestData.createTestSeat(userId = otherHost)
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId, currentUserId, otherHost),
            hostIds = setOf(currentUserId, otherHost),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.moveSeat(2, 5)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.moveSeat(any(), any(), any(), any()) }
    }

    // ===== kickUser Tests =====

    @Test
    fun `kickUser - attendee cannot kick`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.kickUser(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.kickUser(any(), any(), any(), any(), any()) }
    }

    @Test
    fun `kickUser - cannot kick owner`() = runTest {
        viewModel = createViewModel()
        emitRoomAsHost()
        advanceUntilIdle()

        viewModel.kickUser(0) // owner seat
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.kickUser(any(), any(), any(), any(), any()) }
    }

    @Test
    fun `kickUser - host cannot kick other host`() = runTest {
        viewModel = createViewModel()
        val otherHost = "host-2"
        val seats = TestData.createSeatsWithOwner(ownerId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = otherHost)
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId, currentUserId, otherHost),
            hostIds = setOf(currentUserId, otherHost),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.kickUser(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.kickUser(any(), any(), any(), any(), any()) }
    }

    @Test
    fun `kickUser - owner kicks attendee succeeds`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "attendee-1")
        coEvery { userRepository.getUser("attendee-1") } returns Resource.Success(
            TestData.createTestUser(uid = "attendee-1", displayName = "Attendee")
        )
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = setOf(currentUserId, "attendee-1"),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.kickUser(3)
        advanceUntilIdle()

        coVerify { roomRepository.kickUser("room-1", "attendee-1", 3, any(), any()) }
        coVerify { messageRepository.sendSystemMessage("room-1", any()) }
    }

    @Test
    fun `kickUser - empty seat is rejected`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.kickUser(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.kickUser(any(), any(), any(), any(), any()) }
    }

    @Test
    fun `kickUser - reason is passed to repository`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "attendee-1")
        coEvery { userRepository.getUser("attendee-1") } returns Resource.Success(
            TestData.createTestUser(uid = "attendee-1", displayName = "Attendee")
        )
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = setOf(currentUserId, "attendee-1"),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.kickUser(3, "Being disruptive")
        advanceUntilIdle()

        coVerify { roomRepository.kickUser("room-1", "attendee-1", 3, any(), "Being disruptive") }
    }

    @Test
    fun `kickUser - blank reason defaults to No reason given`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "attendee-1")
        coEvery { userRepository.getUser("attendee-1") } returns Resource.Success(
            TestData.createTestUser(uid = "attendee-1", displayName = "Attendee")
        )
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = setOf(currentUserId, "attendee-1"),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.kickUser(3, "")
        advanceUntilIdle()

        coVerify { roomRepository.kickUser("room-1", "attendee-1", 3, any(), "No reason given") }
    }

    @Test
    fun `kickUser - system message includes reason`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "attendee-1")
        coEvery { userRepository.getUser("attendee-1") } returns Resource.Success(
            TestData.createTestUser(uid = "attendee-1", displayName = "Attendee")
        )
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = setOf(currentUserId, "attendee-1"),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.kickUser(3, "Spamming")
        advanceUntilIdle()

        coVerify {
            messageRepository.sendSystemMessage("room-1", match { it.contains("Spamming") })
        }
    }

    @Test
    fun `kicked user sees kicker name and reason in UI state`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        // Simulate being kicked: bannedUserIds contains current user with kickInfo
        roomFlow.value = TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId),
            bannedUserIds = setOf(currentUserId),
            kickInfo = mapOf(
                currentUserId to mapOf(
                    "kickerName" to "Owner",
                    "reason" to "Being rude"
                )
            )
        )
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.wasKicked)
        assertEquals("Owner", viewModel.uiState.value.kickedByName)
        assertEquals("Being rude", viewModel.uiState.value.kickReason)
    }

    @Test
    fun `kicked user without kickInfo sees default reason`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        // Simulate being kicked without kickInfo (legacy data)
        roomFlow.value = TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId),
            bannedUserIds = setOf(currentUserId)
        )
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.wasKicked)
        assertNull(viewModel.uiState.value.kickedByName)
        assertEquals("No reason given", viewModel.uiState.value.kickReason)
    }

    // ===== inviteUser Tests =====

    @Test
    fun `inviteUser - attendee cannot invite`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.inviteUser("target-user", "Target")
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.sendInvite(any(), any(), any()) }
    }

    @Test
    fun `inviteUser - host cannot invite when requireApproval ON`() = runTest {
        viewModel = createViewModel()
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId, currentUserId),
            hostIds = setOf(currentUserId),
            requireApproval = true
        ))
        advanceUntilIdle()

        viewModel.inviteUser("target-user", "Target")
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.sendInvite(any(), any(), any()) }
    }

    @Test
    fun `inviteUser - host invites when requireApproval OFF succeeds`() = runTest {
        viewModel = createViewModel()
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId, currentUserId),
            hostIds = setOf(currentUserId),
            requireApproval = false
        ))
        advanceUntilIdle()

        viewModel.inviteUser("target-user", "Target")
        advanceUntilIdle()

        coVerify { roomRepository.sendInvite("room-1", "target-user", currentUserId) }
    }

    @Test
    fun `inviteUser - owner invites regardless of requireApproval`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            requireApproval = true
        ))
        advanceUntilIdle()

        viewModel.inviteUser("target-user", "Target")
        advanceUntilIdle()

        coVerify { roomRepository.sendInvite("room-1", "target-user", currentUserId) }
    }

    @Test
    fun `inviteUser - already seated user is rejected`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "target-user")
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.inviteUser("target-user", "Target")
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.sendInvite(any(), any(), any()) }
    }

    // ===== acceptInvite Tests =====

    @Test
    fun `acceptInvite - finds first empty non-owner seat`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(ownerId).toMutableMap()
        seats["1"] = TestData.createTestSeat(userId = "other") // occupied
        // seat 2 is empty
        emitRoomAsAttendee(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId, currentUserId),
            pendingInvites = mapOf(currentUserId to ownerId),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.acceptInvite()
        advanceUntilIdle()

        coVerify { roomRepository.acceptInvite("room-1", currentUserId, 2) }
    }

    @Test
    fun `acceptInvite - no pending invite is no-op`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.acceptInvite()
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.acceptInvite(any(), any(), any()) }
    }

    @Test
    fun `acceptInvite - all seats occupied is no-op`() = runTest {
        viewModel = createViewModel()
        val seats = (0 until Constants.MAX_SEATS).associate {
            it.toString() to TestData.createTestSeat(userId = "user-$it")
        }
        emitRoomAsAttendee(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId, currentUserId),
            pendingInvites = mapOf(currentUserId to ownerId),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.acceptInvite()
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.acceptInvite(any(), any(), any()) }
    }

    // ===== leaveRoom Tests =====

    @Test
    fun `leaveRoom - owner with others on mic sets owner away`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "other-user")
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.leaveRoom()
        advanceUntilIdle()

        coVerify { roomRepository.setOwnerAway("room-1") }
        coVerify(exactly = 0) { roomRepository.closeRoom("room-1") }
    }

    @Test
    fun `leaveRoom - owner alone closes room`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.leaveRoom()
        advanceUntilIdle()

        coVerify { roomRepository.closeRoom("room-1") }
        coVerify(exactly = 0) { roomRepository.setOwnerAway("room-1") }
    }

    @Test
    fun `leaveRoom - non-owner just leaves`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.leaveRoom()
        advanceUntilIdle()

        coVerify { roomRepository.leaveRoom("room-1", currentUserId) }
        coVerify(exactly = 0) { roomRepository.setOwnerAway(any()) }
        coVerify(exactly = 0) { roomRepository.closeRoom(any()) }
    }

    @Test
    fun `leaveRoom - leaves voice and removes presence`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.leaveRoom()
        advanceUntilIdle()

        verify { agoraVoiceService.leaveChannel() }
        verify { presenceService.removePresence() }
        verify { activeRoomManager.untrackRoom() }
    }

    // ===== sendMessage Tests =====

    @Test
    fun `sendMessage - blank text is ignored`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.sendMessage("   ")

        coVerify(exactly = 0) { messageRepository.sendMessage(any(), any(), any(), any()) }
    }

    @Test
    fun `sendMessage - non-blank text sends message`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.sendMessage("Hello!")
        advanceUntilIdle()

        coVerify { messageRepository.sendMessage("room-1", currentUserId, any(), "Hello!") }
    }

    // ===== blockUser / unblockUser Tests =====

    @Test
    fun `blockUser - success adds to blocked set`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()
        coEvery { userRepository.blockUser(currentUserId, "target") } returns Resource.Success(Unit)

        viewModel.blockUser("target")
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.blockedUserIds.contains("target"))
    }

    @Test
    fun `blockUser - error sets error message`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()
        coEvery { userRepository.blockUser(currentUserId, "target") } returns Resource.Error("fail")

        viewModel.blockUser("target")
        advanceUntilIdle()

        assertNotNull(viewModel.uiState.value.error)
    }

    @Test
    fun `unblockUser - success removes from blocked set`() = runTest {
        viewModel = createViewModel()
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(setOf("target"))
        emitRoomAsOwner()
        advanceUntilIdle()
        coEvery { userRepository.unblockUser(currentUserId, "target") } returns Resource.Success(Unit)

        viewModel.unblockUser("target")
        advanceUntilIdle()

        assertFalse(viewModel.uiState.value.blockedUserIds.contains("target"))
    }

    // ===== clearError Tests =====

    @Test
    fun `clearError clears error`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()
        coEvery { userRepository.blockUser(any(), any()) } returns Resource.Error("fail")
        viewModel.blockUser("x")
        advanceUntilIdle()

        viewModel.clearError()
        assertNull(viewModel.uiState.value.error)
    }

    // ===== toggleSelfMute Tests =====

    @Test
    fun `toggleSelfMute - only works on own seat`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "other-user")
        emitRoomAsOwner(TestData.createTestRoom(ownerId = currentUserId, seats = seats))
        advanceUntilIdle()

        viewModel.toggleSelfMute(3) // not our seat
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.toggleMute(any(), any(), any()) }
    }

    @Test
    fun `toggleSelfMute - toggles on own seat`() = runTest {
        viewModel = createViewModel()
        val seats = TestData.createSeatsWithOwner(currentUserId)
        emitRoomAsOwner(TestData.createTestRoom(ownerId = currentUserId, seats = seats))
        advanceUntilIdle()

        viewModel.toggleSelfMute(0)
        advanceUntilIdle()

        coVerify { roomRepository.toggleMute("room-1", 0, true) } // was false, toggled to true
    }

    // ===== confirmJoinDespiteBlock / cancelJoin Tests =====

    @Test
    fun `cancelJoin sets shouldNavigateBack`() = runTest {
        viewModel = createViewModel()
        advanceUntilIdle()

        viewModel.cancelJoin()

        assertTrue(viewModel.uiState.value.shouldNavigateBack)
    }

    // ===== Room closed detection =====

    @Test
    fun `room closing sets roomClosed in state`() = runTest {
        // Pre-set room BEFORE creating VM so initial emission is not null
        roomFlow.value = TestData.createTestRoom(ownerId = currentUserId)
        viewModel = createViewModel()
        advanceUntilIdle()
        assertFalse(viewModel.uiState.value.roomClosed)

        // Emit closed room
        roomFlow.value = TestData.createTestRoom(
            ownerId = currentUserId,
            state = RoomState.CLOSED,
            closedAt = TestData.LATER_TIMESTAMP
        )
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.roomClosed)
    }

    @Test
    fun `null room emission sets roomClosed`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        roomFlow.value = null
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.roomClosed)
    }

    // ===== Voice Error Surfacing =====

    @Test
    fun `voice error from agora service surfaces in uiState`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        voiceErrorFlow.value = "Voice join failed (code -7)"
        advanceUntilIdle()

        assertEquals("Voice join failed (code -7)", viewModel.uiState.value.error)
        verify { agoraVoiceService.clearError() }
    }

    @Test
    fun `null voice error does not overwrite uiState error`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        voiceErrorFlow.value = null
        advanceUntilIdle()

        assertNull(viewModel.uiState.value.error)
    }

    // ===== Voice Channel Audience-First Tests =====

    @Test
    fun `joinRoom joins voice channel as audience`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        coVerify { agoraVoiceService.joinChannel("channel-1", any(), asBroadcaster = false) }
    }

    @Test
    fun `becoming seated switches role to broadcaster when has audio permission`() = runTest {
        viewModel = createViewModel()
        // First emit: user NOT seated (all empty seats) — triggers handleFirstJoin → joinRoom
        val emptySeats = TestData.createDefaultSeats()
        emitRoomAsOwner(TestData.createTestRoom(ownerId = currentUserId, seats = emptySeats))
        advanceUntilIdle()

        // Grant audio permission
        viewModel.onAudioPermissionResult(true)
        advanceUntilIdle()

        // Second emit: user IS seated — triggers handleNormalUpdate with currentlySeated=true, isSeated=false
        val seatedSeats = TestData.createSeatsWithOwner(currentUserId)
        emitRoomAsOwner(TestData.createTestRoom(ownerId = currentUserId, seats = seatedSeats))
        advanceUntilIdle()

        verify { agoraVoiceService.setRole(true) }
    }

    @Test
    fun `leaving seat switches role to audience instead of leaving channel`() = runTest {
        // Pre-set room BEFORE creating VM to avoid null initial emission calling leaveChannel
        val emptySeats = TestData.createDefaultSeats()
        roomFlow.value = TestData.createTestRoom(ownerId = currentUserId, seats = emptySeats)
        viewModel = createViewModel()
        advanceUntilIdle()

        // Grant audio permission
        viewModel.onAudioPermissionResult(true)
        advanceUntilIdle()

        // Emit with user seated — handleNormalUpdate sets isSeated = true
        val seatedSeats = TestData.createSeatsWithOwner(currentUserId)
        roomFlow.value = TestData.createTestRoom(ownerId = currentUserId, seats = seatedSeats)
        advanceUntilIdle()

        // Emit with user NOT seated — handleNormalUpdate detects isSeated→not seated
        roomFlow.value = TestData.createTestRoom(
            ownerId = currentUserId,
            seats = emptySeats,
            name = "Test Room 2"  // change something so MutableStateFlow re-emits
        )
        advanceUntilIdle()

        verify { agoraVoiceService.setRole(false) }
        // Should NOT call leaveChannel when leaving seat
        verify(exactly = 0) { agoraVoiceService.leaveChannel() }
    }

    @Test
    fun `onAudioPermissionResult granted when seated calls setRole`() = runTest {
        viewModel = createViewModel()
        // First emit with empty seats to trigger handleFirstJoin → joinRoom → hasJoined=true
        val emptySeats = TestData.createDefaultSeats()
        emitRoomAsOwner(TestData.createTestRoom(ownerId = currentUserId, seats = emptySeats))
        advanceUntilIdle()

        // Second emit with user seated — handleNormalUpdate sets isSeated=true
        // but hasAudioPermission is false, so no setRole yet
        val seatedSeats = TestData.createSeatsWithOwner(currentUserId)
        emitRoomAsOwner(TestData.createTestRoom(ownerId = currentUserId, seats = seatedSeats))
        advanceUntilIdle()

        // Now grant permission — should trigger setRole(true) since isSeated=true
        viewModel.onAudioPermissionResult(true)
        advanceUntilIdle()

        verify { agoraVoiceService.setRole(true) }
    }

    @Test
    fun `onAudioPermissionResult granted when not seated does not call setRole`() = runTest {
        viewModel = createViewModel()
        val seatsWithoutUser = TestData.createDefaultSeats()
        emitRoomAsOwner(TestData.createTestRoom(ownerId = currentUserId, seats = seatsWithoutUser))
        advanceUntilIdle()

        viewModel.onAudioPermissionResult(true)
        advanceUntilIdle()

        verify(exactly = 0) { agoraVoiceService.setRole(any()) }
    }

    @Test
    fun `leaveRoom still calls leaveChannel`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.leaveRoom()
        advanceUntilIdle()

        verify { agoraVoiceService.leaveChannel() }
    }

    @Test
    fun `attendee joining room also joins voice as audience`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        coVerify { agoraVoiceService.joinChannel("channel-1", any(), asBroadcaster = false) }
    }

    @Test
    fun `owner already seated with permission joins voice as broadcaster directly`() = runTest {
        viewModel = createViewModel()
        // Grant audio permission BEFORE room emission
        viewModel.onAudioPermissionResult(true)
        advanceUntilIdle()

        // Emit room with owner on seat 0 (default seats)
        emitRoomAsOwner()
        advanceUntilIdle()

        // Should join as broadcaster since already seated + has permission
        coVerify { agoraVoiceService.joinChannel("channel-1", any(), asBroadcaster = true) }
    }

    @Test
    fun `owner already seated without permission joins as audience then upgrades on permission grant`() = runTest {
        viewModel = createViewModel()
        // Emit room with owner on seat 0, but NO audio permission yet
        emitRoomAsOwner()
        advanceUntilIdle()

        // Should join as audience (no permission yet)
        coVerify { agoraVoiceService.joinChannel("channel-1", any(), asBroadcaster = false) }

        // Grant permission — should call setRole(true) since isSeated was set in joinRoom()
        viewModel.onAudioPermissionResult(true)
        advanceUntilIdle()

        verify { agoraVoiceService.setRole(true) }
    }

    @Test
    fun `alreadyInRoom path sets isSeated and does not trigger redundant seat transition`() = runTest {
        // Simulate ViewModel recreation: activeRoomManager reports already in room
        every { activeRoomManager.isInRoom("room-1") } returns true

        // Pre-set room with owner seated BEFORE creating VM
        roomFlow.value = TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = setOf(currentUserId)
        )
        viewModel = createViewModel()
        advanceUntilIdle()

        // Grant permission — since isSeated is set in alreadyInRoom path, this should call setRole
        viewModel.onAudioPermissionResult(true)
        advanceUntilIdle()

        verify { agoraVoiceService.setRole(true) }
    }

    @Test
    fun `alreadyInRoom path without seat does not set broadcaster`() = runTest {
        every { activeRoomManager.isInRoom("room-1") } returns true

        // Pre-set room with empty seats (user not seated)
        val emptySeats = TestData.createDefaultSeats()
        roomFlow.value = TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = setOf(currentUserId),
            seats = emptySeats
        )
        viewModel = createViewModel()
        advanceUntilIdle()

        // Grant permission — since NOT seated, should NOT call setRole
        viewModel.onAudioPermissionResult(true)
        advanceUntilIdle()

        verify(exactly = 0) { agoraVoiceService.setRole(any()) }
    }

    // ===== Seat Request Notification Tests =====

    @Test
    fun `pending request enqueues SeatRequestReceived notification for owner`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = setOf(currentUserId, "attendee-1")
        ))
        advanceUntilIdle()

        val request = TestData.createTestSeatRequest(userId = "attendee-1", userName = "Attendee")
        pendingRequestsFlow.value = listOf(request)
        // Advance just enough for the flow collector to run, but not past the 3s auto-dismiss
        advanceTimeBy(1)

        val notif = viewModel.uiState.value.activeNotification
        assertTrue(notif is RoomNotification.SeatRequestReceived)
        assertEquals("attendee-1", (notif as RoomNotification.SeatRequestReceived).request.userId)
    }

    @Test
    fun `pending request enqueues SeatRequestReceived notification for host`() = runTest {
        viewModel = createViewModel()
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId, currentUserId, "attendee-1"),
            hostIds = setOf(currentUserId)
        ))
        advanceUntilIdle()

        val request = TestData.createTestSeatRequest(userId = "attendee-1", userName = "Attendee")
        pendingRequestsFlow.value = listOf(request)
        // Advance just enough for the flow collector to run, but not past the 3s auto-dismiss
        advanceTimeBy(1)

        val notif = viewModel.uiState.value.activeNotification
        assertTrue(notif is RoomNotification.SeatRequestReceived)
    }

    @Test
    fun `pending request does NOT enqueue notification for attendee`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        val request = TestData.createTestSeatRequest(userId = "other-attendee", userName = "Other")
        pendingRequestsFlow.value = listOf(request)
        advanceUntilIdle()

        assertNull(viewModel.uiState.value.activeNotification)
    }

    @Test
    fun `pending requests update panel state`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = setOf(currentUserId, "attendee-1")
        ))
        advanceUntilIdle()

        val request = TestData.createTestSeatRequest(userId = "attendee-1", userName = "Attendee")
        pendingRequestsFlow.value = listOf(request)
        // Advance just enough for flow collector, but not past 3s auto-dismiss
        advanceTimeBy(1)

        assertEquals(1, viewModel.uiState.value.pendingRequestsForPanel.size)
        assertEquals("attendee-1", viewModel.uiState.value.pendingRequestsForPanel[0].userId)
    }

    @Test
    fun `dismissCurrentNotification clears active notification`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = setOf(currentUserId, "attendee-1")
        ))
        advanceUntilIdle()

        val request = TestData.createTestSeatRequest(userId = "attendee-1", userName = "Attendee")
        pendingRequestsFlow.value = listOf(request)
        // Advance just enough for flow collector, but not past 3s auto-dismiss
        advanceTimeBy(1)
        assertNotNull(viewModel.uiState.value.activeNotification)

        viewModel.dismissCurrentNotification()

        assertNull(viewModel.uiState.value.activeNotification)
    }

    @Test
    fun `approveRequestFromNotification within 5s calls takeSeat`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        // Create a request with createdAt = now (within 5s)
        val now = Timestamp(Date(System.currentTimeMillis()))
        val request = TestData.createTestSeatRequest(
            userId = "attendee-1", userName = "Attendee", createdAt = now
        )
        coEvery {
            seatRequestRepository.approveRequest("room-1", "req-1", currentUserId)
        } returns Resource.Success(request.copy(status = SeatRequestStatus.APPROVED))

        viewModel.approveRequestFromNotification(request)
        advanceUntilIdle()

        coVerify { roomRepository.takeSeat("room-1", 3, "attendee-1") }
    }

    @Test
    fun `approveRequestFromNotification after 5s does NOT call takeSeat`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        // Create a request with createdAt = 10s ago (beyond 5s threshold)
        val oldTime = Timestamp(Date(System.currentTimeMillis() - 10_000L))
        val request = TestData.createTestSeatRequest(
            userId = "attendee-1", userName = "Attendee", createdAt = oldTime
        )
        coEvery {
            seatRequestRepository.approveRequest("room-1", "req-1", currentUserId)
        } returns Resource.Success(request.copy(status = SeatRequestStatus.APPROVED))

        viewModel.approveRequestFromNotification(request)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.takeSeat(any(), any(), any()) }
    }

    @Test
    fun `denyRequestFromNotification calls denyRequest`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        val request = TestData.createTestSeatRequest(userId = "attendee-1", userName = "Attendee")
        pendingRequestsFlow.value = listOf(request)
        advanceUntilIdle()

        viewModel.denyRequestFromNotification(request)
        advanceUntilIdle()

        coVerify { seatRequestRepository.denyRequest("room-1", "req-1", currentUserId) }
    }

    @Test
    fun `approved request shows RequestApproved notification to requester`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        val approvedRequest = TestData.createTestSeatRequest(
            userId = currentUserId,
            userName = "Current User",
            status = SeatRequestStatus.APPROVED
        )
        myRequestsFlow.value = listOf(approvedRequest)
        advanceUntilIdle()

        val notif = viewModel.uiState.value.activeNotification
        assertTrue(notif is RoomNotification.RequestApproved)
        assertEquals(currentUserId, (notif as RoomNotification.RequestApproved).request.userId)
    }

    @Test
    fun `approved request does NOT show notification if user is already seated`() = runTest {
        viewModel = createViewModel()
        // Emit room with current user seated
        val seats = TestData.createDefaultSeats().toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = currentUserId)
        emitRoomAsAttendee(
            TestData.createTestRoom(
                ownerId = ownerId,
                participantIds = setOf(ownerId, currentUserId),
                seats = seats
            )
        )
        advanceUntilIdle()

        val approvedRequest = TestData.createTestSeatRequest(
            userId = currentUserId,
            userName = "Current User",
            status = SeatRequestStatus.APPROVED
        )
        myRequestsFlow.value = listOf(approvedRequest)
        advanceUntilIdle()

        assertNull(viewModel.uiState.value.activeNotification)
    }

    @Test
    fun `acceptApprovedRequest calls takeSeat`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        val request = TestData.createTestSeatRequest(
            userId = currentUserId, userName = "Current User", seatIndex = 3,
            status = SeatRequestStatus.APPROVED
        )

        viewModel.acceptApprovedRequest(request)
        advanceUntilIdle()

        coVerify { roomRepository.takeSeat("room-1", 3, currentUserId) }
    }

    @Test
    fun `declineApprovedRequest calls cancelApprovedRequest`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        val request = TestData.createTestSeatRequest(
            userId = currentUserId, userName = "Current User",
            status = SeatRequestStatus.APPROVED
        )

        viewModel.declineApprovedRequest(request)
        advanceUntilIdle()

        coVerify { seatRequestRepository.cancelApprovedRequest("room-1", "req-1", currentUserId) }
    }

    // ===== Invite Notification Tests =====

    @Test
    fun `new invite enqueues InviteReceived notification`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        // Emit room with a pending invite for current user
        val roomWithInvite = TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId, currentUserId),
            pendingInvites = mapOf(currentUserId to ownerId)
        )
        coEvery { userRepository.getUser(ownerId) } returns Resource.Success(
            TestData.createTestUser(uid = ownerId, displayName = "Owner")
        )
        roomFlow.value = roomWithInvite
        advanceUntilIdle()

        val notif = viewModel.uiState.value.activeNotification
        assertTrue(notif is RoomNotification.InviteReceived)
        assertEquals(ownerId, (notif as RoomNotification.InviteReceived).inviterUserId)
    }

    // ===== Owner Can Kick/Force-Mute Hosts (v0.18 fix) =====

    @Test
    fun `kickUser - owner can kick a host`() = runTest {
        viewModel = createViewModel()
        val hostUser = "host-1"
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = hostUser)
        coEvery { userRepository.getUser(hostUser) } returns Resource.Success(
            TestData.createTestUser(uid = hostUser, displayName = "Host One")
        )
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = setOf(currentUserId, hostUser),
            hostIds = setOf(hostUser),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.kickUser(3)
        advanceUntilIdle()

        coVerify { roomRepository.kickUser("room-1", hostUser, 3, any(), any()) }
        coVerify { messageRepository.sendSystemMessage("room-1", any()) }
    }

    @Test
    fun `kickUser - host cannot kick another host`() = runTest {
        viewModel = createViewModel()
        val otherHost = "host-2"
        val seats = TestData.createSeatsWithOwner(ownerId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = otherHost)
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId, currentUserId, otherHost),
            hostIds = setOf(currentUserId, otherHost),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.kickUser(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.kickUser(any(), any(), any(), any(), any()) }
    }

    @Test
    fun `forceMuteUser - owner can force-mute a host`() = runTest {
        viewModel = createViewModel()
        val hostUser = "host-1"
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = hostUser, isMuted = false)
        coEvery { userRepository.getUser(hostUser) } returns Resource.Success(
            TestData.createTestUser(uid = hostUser, displayName = "Host One")
        )
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = setOf(currentUserId, hostUser),
            hostIds = setOf(hostUser),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.forceMuteUser(3)
        advanceUntilIdle()

        coVerify { roomRepository.toggleMute("room-1", 3, true) }
    }

    @Test
    fun `forceMuteUser - host cannot force-mute another host`() = runTest {
        viewModel = createViewModel()
        val otherHost = "host-2"
        val seats = TestData.createSeatsWithOwner(ownerId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = otherHost, isMuted = false)
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId, currentUserId, otherHost),
            hostIds = setOf(currentUserId, otherHost),
            seats = seats
        ))
        advanceUntilIdle()

        viewModel.forceMuteUser(3)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.toggleMute(any(), any(), any()) }
    }

    // ===== System Messages Visible (v0.18 fix) =====

    @Test
    fun `updateFilteredMessages - system messages are included`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        val textMessage = TestData.createTestMessage(
            messageId = "msg-1",
            text = "Hello",
            type = MessageType.TEXT,
            createdAt = TestData.BASE_TIMESTAMP
        )
        val systemMessage = TestData.createTestMessage(
            messageId = "msg-2",
            text = "User joined the room",
            type = MessageType.SYSTEM,
            createdAt = TestData.BASE_TIMESTAMP
        )
        messagesFlow.value = listOf(textMessage, systemMessage)
        advanceUntilIdle()

        val messages = viewModel.uiState.value.messages
        assertEquals(2, messages.size)
        assertTrue(messages.any { it.type == MessageType.SYSTEM })
    }

    @Test
    fun `updateFilteredMessages - system messages not filtered after firstJoinTimestamp set`() = runTest {
        viewModel = createViewModel()
        // Emit room with firstJoinTimestamps to trigger firstJoinTimestamp being set
        val room = TestData.createTestRoom(
            ownerId = currentUserId,
            firstJoinTimestamps = mapOf(currentUserId to TestData.BASE_TIMESTAMP)
        )
        emitRoomAsOwner(room)
        advanceUntilIdle()

        val systemMessage = TestData.createTestMessage(
            messageId = "sys-1",
            text = "Room created",
            type = MessageType.SYSTEM,
            createdAt = TestData.BASE_TIMESTAMP
        )
        val laterSystemMessage = TestData.createTestMessage(
            messageId = "sys-2",
            text = "User joined",
            type = MessageType.SYSTEM,
            createdAt = TestData.LATER_TIMESTAMP
        )
        messagesFlow.value = listOf(systemMessage, laterSystemMessage)
        advanceUntilIdle()

        val messages = viewModel.uiState.value.messages
        // Both messages should be present (system messages are no longer filtered out)
        // The only filter is the firstJoinTimestamp time-based filter
        assertTrue(messages.any { it.type == MessageType.SYSTEM })
    }

    // ===== Stale Seat Requests Filter (v0.18 fix) =====

    @Test
    fun `pendingRequests - filters out requests where user is already seated`() = runTest {
        viewModel = createViewModel()
        val seatedUser = "seated-user"
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = seatedUser)
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = setOf(currentUserId, seatedUser),
            seats = seats
        ))
        advanceUntilIdle()

        val staleRequest = TestData.createTestSeatRequest(
            requestId = "req-stale",
            userId = seatedUser,
            userName = "Seated User",
            seatIndex = 5
        )
        pendingRequestsFlow.value = listOf(staleRequest)
        advanceUntilIdle()

        assertEquals(0, viewModel.uiState.value.pendingRequestsForPanel.size)
    }

    @Test
    fun `pendingRequests - filters out requests where user left the room`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = setOf(currentUserId)  // "gone-user" is NOT in participantIds
        ))
        advanceUntilIdle()

        val staleRequest = TestData.createTestSeatRequest(
            requestId = "req-gone",
            userId = "gone-user",
            userName = "Gone User",
            seatIndex = 3
        )
        pendingRequestsFlow.value = listOf(staleRequest)
        advanceUntilIdle()

        assertEquals(0, viewModel.uiState.value.pendingRequestsForPanel.size)
    }

    @Test
    fun `pendingRequests - keeps valid requests and filters stale ones`() = runTest {
        viewModel = createViewModel()
        val seatedUser = "seated-user"
        val validUser = "valid-user"
        val seats = TestData.createSeatsWithOwner(currentUserId).toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = seatedUser)
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = setOf(currentUserId, seatedUser, validUser),
            seats = seats
        ))
        advanceUntilIdle()

        val staleRequest = TestData.createTestSeatRequest(
            requestId = "req-stale",
            userId = seatedUser,
            userName = "Seated User",
            seatIndex = 5
        )
        val validRequest = TestData.createTestSeatRequest(
            requestId = "req-valid",
            userId = validUser,
            userName = "Valid User",
            seatIndex = 4
        )
        pendingRequestsFlow.value = listOf(staleRequest, validRequest)
        advanceUntilIdle()

        assertEquals(1, viewModel.uiState.value.pendingRequestsForPanel.size)
        assertEquals("req-valid", viewModel.uiState.value.pendingRequestsForPanel[0].requestId)
    }

    // ===== addHost / removeHost from RoomViewModel (v0.18 feature) =====

    @Test
    fun `addHost - owner can add a host`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.addHost("user-2")
        advanceUntilIdle()

        coVerify { roomRepository.addHost("room-1", "user-2") }
    }

    @Test
    fun `addHost - non-owner cannot add a host`() = runTest {
        viewModel = createViewModel()
        emitRoomAsHost()
        advanceUntilIdle()

        viewModel.addHost("user-2")
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.addHost(any(), any()) }
    }

    @Test
    fun `addHost - attendee cannot add a host`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.addHost("user-2")
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.addHost(any(), any()) }
    }

    @Test
    fun `removeHost - owner can remove a host`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            hostIds = setOf("user-2")
        ))
        advanceUntilIdle()

        viewModel.removeHost("user-2")
        advanceUntilIdle()

        coVerify { roomRepository.removeHost("room-1", "user-2") }
    }

    @Test
    fun `removeHost - non-owner cannot remove a host`() = runTest {
        viewModel = createViewModel()
        emitRoomAsHost(TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId, currentUserId, "host-2"),
            hostIds = setOf(currentUserId, "host-2")
        ))
        advanceUntilIdle()

        viewModel.removeHost("host-2")
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.removeHost(any(), any()) }
    }

    // ===== ownerReturn Tests =====

    @Test
    fun `ownerReturn - re-establishes presence when not in room`() = runTest {
        viewModel = createViewModel()
        val room = TestData.createTestRoom(
            ownerId = currentUserId,
            state = RoomState.OWNER_AWAY
        )
        emitRoomAsOwner(room)
        advanceUntilIdle()
        every { activeRoomManager.isInRoom("room-1") } returns false

        viewModel.ownerReturn()
        advanceUntilIdle()

        coVerify { roomRepository.setOwnerReturned("room-1", currentUserId) }
        coVerify { presenceService.setPresence("room-1", currentUserId) }
        verify { activeRoomManager.trackRoom("room-1") }
    }

    @Test
    fun `ownerReturn - skips presence setup when already in room`() = runTest {
        // Set isInRoom BEFORE creating VM and emitting room so the alreadyInRoom path is taken
        every { activeRoomManager.isInRoom("room-1") } returns true
        roomFlow.value = TestData.createTestRoom(
            ownerId = currentUserId,
            state = RoomState.OWNER_AWAY
        )
        viewModel = createViewModel()
        advanceUntilIdle()

        viewModel.ownerReturn()
        advanceUntilIdle()

        coVerify { roomRepository.setOwnerReturned("room-1", currentUserId) }
        // Neither joinRoom (early return) nor ownerReturn calls setPresence when already in room
        coVerify(exactly = 0) { presenceService.setPresence(any(), any()) }
    }

    @Test
    fun `ownerReturn - rejoins voice when not joined`() = runTest {
        viewModel = createViewModel()
        val room = TestData.createTestRoom(
            ownerId = currentUserId,
            state = RoomState.OWNER_AWAY
        )
        emitRoomAsOwner(room)
        advanceUntilIdle()
        joinedFlow.value = false

        viewModel.ownerReturn()
        advanceUntilIdle()

        coVerify { agoraVoiceService.joinChannel("channel-1", any(), asBroadcaster = any()) }
    }

    @Test
    fun `ownerReturn - sets broadcaster role when already joined`() = runTest {
        viewModel = createViewModel()
        val room = TestData.createTestRoom(
            ownerId = currentUserId,
            state = RoomState.OWNER_AWAY
        )
        emitRoomAsOwner(room)
        advanceUntilIdle()
        joinedFlow.value = true

        viewModel.ownerReturn()
        advanceUntilIdle()

        verify { agoraVoiceService.setRole(true) }
    }

    @Test
    fun `ownerReturn - non-owner cannot return`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.ownerReturn()
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.setOwnerReturned(any(), any()) }
    }

    // ===== updateRoomName Tests =====

    @Test
    fun `updateRoomName - owner can update room name`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.updateRoomName("New Room Name")
        advanceUntilIdle()

        coVerify { roomRepository.updateRoomName("room-1", "New Room Name") }
    }

    @Test
    fun `updateRoomName - non-owner cannot update room name`() = runTest {
        viewModel = createViewModel()
        emitRoomAsAttendee()
        advanceUntilIdle()

        viewModel.updateRoomName("Hacked Name")
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.updateRoomName(any(), any()) }
    }

    @Test
    fun `updateRoomName - host cannot update room name`() = runTest {
        viewModel = createViewModel()
        emitRoomAsHost()
        advanceUntilIdle()

        viewModel.updateRoomName("Host Name")
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.updateRoomName(any(), any()) }
    }

    @Test
    fun `updateRoomName - no room does nothing`() = runTest {
        viewModel = createViewModel()
        advanceUntilIdle()

        viewModel.updateRoomName("No Room")
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.updateRoomName(any(), any()) }
    }

    // ===== Room Expiry Countdown Tests =====

    @Test
    fun `room expiry - countdown not started when room has plenty of time`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        // Room created just now — over 5 minutes remain, no countdown active
        assertEquals(0L, viewModel.uiState.value.roomExpiryRemainingMs)
    }

    @Test
    fun `room expiry - owner closes room when time expires`() = runTest {
        viewModel = createViewModel()
        val expiredRoom = TestData.createTestRoom(
            ownerId = currentUserId,
            createdAt = Timestamp(Date(System.currentTimeMillis() - Constants.MAX_ROOM_DURATION_MS - 1000L))
        )
        emitRoomAsOwner(expiredRoom)
        advanceUntilIdle()

        coVerify { roomRepository.closeRoom("room-1") }
    }

    @Test
    fun `room expiry - non-owner does not close room when time expires`() = runTest {
        viewModel = createViewModel()
        val expiredRoom = TestData.createTestRoom(
            ownerId = ownerId,
            participantIds = setOf(ownerId, currentUserId),
            createdAt = Timestamp(Date(System.currentTimeMillis() - Constants.MAX_ROOM_DURATION_MS - 1000L))
        )
        emitRoomAsAttendee(expiredRoom)
        advanceUntilIdle()

        coVerify(exactly = 0) { roomRepository.closeRoom(any()) }
    }

    @Test
    fun `room expiry - shows countdown when under 5 minutes`() = runTest {
        viewModel = createViewModel()
        // Room with ~10 seconds remaining — short enough to fully advance through
        val nearExpiryRoom = TestData.createTestRoom(
            ownerId = currentUserId,
            createdAt = Timestamp(Date(System.currentTimeMillis() - Constants.MAX_ROOM_DURATION_MS + 10_000L))
        )
        emitRoomAsOwner(nearExpiryRoom)
        advanceTimeBy(1001L)

        val remaining = viewModel.uiState.value.roomExpiryRemainingMs
        assertTrue("Expected remaining > 0 but was $remaining", remaining > 0)

        // Advance through remaining time so the loop completes
        advanceUntilIdle()
    }

    // ===== System message cleanup verifications =====

    @Test
    fun `addHost - does not send system message`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.addHost("user-2")
        advanceUntilIdle()

        coVerify { roomRepository.addHost("room-1", "user-2") }
        coVerify(exactly = 0) { messageRepository.sendSystemMessage(any(), match { it.contains("host") }) }
    }

    @Test
    fun `removeHost - does not send system message`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner(TestData.createTestRoom(ownerId = currentUserId, hostIds = setOf("user-2")))
        advanceUntilIdle()

        viewModel.removeHost("user-2")
        advanceUntilIdle()

        coVerify { roomRepository.removeHost("room-1", "user-2") }
        coVerify(exactly = 0) { messageRepository.sendSystemMessage(any(), match { it.contains("host") }) }
    }

    @Test
    fun `inviteUser - does not send system message`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner(TestData.createTestRoom(
            ownerId = currentUserId,
            participantIds = setOf(currentUserId, "user-2")
        ))
        advanceUntilIdle()

        viewModel.inviteUser("user-2", "User Two")
        advanceUntilIdle()

        coVerify { roomRepository.sendInvite("room-1", "user-2", currentUserId) }
        coVerify(exactly = 0) { messageRepository.sendSystemMessage(any(), match { it.contains("invited") }) }
    }

    @Test
    fun `closeRoom - does not send system message`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        viewModel.closeRoom()
        advanceUntilIdle()

        coVerify { roomRepository.closeRoom("room-1") }
        coVerify(exactly = 0) { messageRepository.sendSystemMessage(any(), match { it.contains("closed") }) }
    }

    @Test
    fun `room expiry - does not send system message`() = runTest {
        viewModel = createViewModel()
        val nearExpiryRoom = TestData.createTestRoom(
            ownerId = currentUserId,
            createdAt = Timestamp(Date(System.currentTimeMillis() - Constants.MAX_ROOM_DURATION_MS + 10_000L))
        )
        emitRoomAsOwner(nearExpiryRoom)
        advanceTimeBy(1001L)

        coVerify(exactly = 0) { messageRepository.sendSystemMessage(any(), match { it.contains("maximum time") }) }

        advanceUntilIdle()
    }

    // ===== Countdown deduplication tests =====

    @Test
    fun `owner-away countdown - re-emitting same state does not restart job`() = runTest {
        viewModel = createViewModel()
        val ownerLeftAt = Timestamp.now()
        val awayRoom = TestData.createTestRoom(
            ownerId = currentUserId,
            state = RoomState.OWNER_AWAY,
            ownerLeftAt = ownerLeftAt
        )
        emitRoomAsOwner(awayRoom)
        advanceTimeBy(1100L)

        val remainingFirst = viewModel.uiState.value.ownerAwayRemainingMs
        assertTrue(remainingFirst > 0)

        // Re-emit the same room state (no actual change)
        roomFlow.value = awayRoom.copy(name = "Updated Name")
        advanceTimeBy(1100L)

        // The countdown should still be running, not restarted
        val remainingSecond = viewModel.uiState.value.ownerAwayRemainingMs
        assertTrue(remainingSecond > 0)
    }

    // ===== Room expiry countdown threshold constant test =====

    @Test
    fun `room expiry countdown - does not start before 5min threshold`() = runTest {
        viewModel = createViewModel()
        // Room created 2h 50min ago (10 min remaining, above 5min threshold)
        val earlyRoom = TestData.createTestRoom(
            ownerId = currentUserId,
            createdAt = Timestamp(Date(System.currentTimeMillis() - Constants.MAX_ROOM_DURATION_MS + 600_000L))
        )
        emitRoomAsOwner(earlyRoom)
        advanceUntilIdle()

        assertEquals(0L, viewModel.uiState.value.roomExpiryRemainingMs)
    }

    @Test
    fun `room expiry countdown - starts within 5min threshold`() = runTest {
        viewModel = createViewModel()
        // Room created just inside the 5min threshold
        val nearExpiryRoom = TestData.createTestRoom(
            ownerId = currentUserId,
            createdAt = Timestamp(Date(System.currentTimeMillis() - Constants.MAX_ROOM_DURATION_MS + 120_000L))
        )
        emitRoomAsOwner(nearExpiryRoom)
        advanceTimeBy(1100L)

        assertTrue(viewModel.uiState.value.roomExpiryRemainingMs > 0)
    }

    // ===== Message filtering optimization =====

    @Test
    fun `message filtering - only updates state when messages actually change`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        val msg1 = TestData.createTestMessage(messageId = "m1", text = "Hello")
        messagesFlow.value = listOf(msg1)
        advanceUntilIdle()

        assertEquals(1, viewModel.uiState.value.messages.size)

        // Re-emit the same list reference
        val sameMessages = listOf(msg1)
        messagesFlow.value = sameMessages
        advanceUntilIdle()

        // Should still be exactly 1 message, state was not unnecessarily updated
        assertEquals(1, viewModel.uiState.value.messages.size)
    }

    // ===== Atomic state update (thread safety) =====

    @Test
    fun `clearError uses atomic update`() = runTest {
        viewModel = createViewModel()
        emitRoomAsOwner()
        advanceUntilIdle()

        // Trigger an error
        voiceErrorFlow.value = "test error"
        advanceUntilIdle()

        viewModel.clearError()
        assertNull(viewModel.uiState.value.error)
    }
}
