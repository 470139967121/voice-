package com.shyden.shytalk.core.room

import android.content.Context
import com.google.firebase.auth.FirebaseUser
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.data.remote.AgoraVoiceService
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.MessageRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.SeatRequestRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ActiveRoomManagerTest {

    private val testDispatcher = UnconfinedTestDispatcher()

    private lateinit var roomRepository: RoomRepository
    private lateinit var messageRepository: MessageRepository
    private lateinit var authRepository: AuthRepository
    private lateinit var userRepository: UserRepository
    private lateinit var seatRequestRepository: SeatRequestRepository
    private lateinit var agoraVoiceService: AgoraVoiceService
    private lateinit var context: Context
    private lateinit var manager: ActiveRoomManager

    private val currentUserId = "user-1"

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)

        roomRepository = mockk(relaxed = true)
        messageRepository = mockk(relaxed = true)
        authRepository = mockk(relaxed = true)
        userRepository = mockk(relaxed = true)
        seatRequestRepository = mockk(relaxed = true)
        agoraVoiceService = mockk(relaxed = true)
        context = mockk(relaxed = true)

        val firebaseUser = mockk<FirebaseUser>()
        every { firebaseUser.uid } returns currentUserId
        every { authRepository.currentUser } returns firebaseUser

        manager = ActiveRoomManager(
            roomRepository = roomRepository,
            messageRepository = messageRepository,
            authRepository = authRepository,
            userRepository = userRepository,
            seatRequestRepository = seatRequestRepository,
            agoraVoiceService = agoraVoiceService,
            context = context
        )
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // --- resolveRole ---

    @Test
    fun `resolveRole returns OWNER when userId matches ownerId`() {
        val room = TestData.createTestRoom(ownerId = currentUserId)
        assertEquals(RoomRole.OWNER, manager.resolveRole(room, currentUserId))
    }

    @Test
    fun `resolveRole returns HOST when userId in hostIds`() {
        val room = TestData.createTestRoom(ownerId = "other", hostIds = listOf(currentUserId))
        assertEquals(RoomRole.HOST, manager.resolveRole(room, currentUserId))
    }

    @Test
    fun `resolveRole returns ATTENDEE for regular user`() {
        val room = TestData.createTestRoom(ownerId = "other")
        assertEquals(RoomRole.ATTENDEE, manager.resolveRole(room, currentUserId))
    }

    @Test
    fun `resolveRole returns ATTENDEE for null room`() {
        assertEquals(RoomRole.ATTENDEE, manager.resolveRole(null, currentUserId))
    }

    // --- trackRoom / untrackRoom ---

    @Test
    fun `trackRoom sets activeRoomId`() {
        manager.trackRoom("room-1")
        assertEquals("room-1", manager.activeRoomId.value)
    }

    @Test
    fun `untrackRoom clears all state`() {
        manager.trackRoom("room-1")
        manager.updateTrackedRoom(TestData.createTestRoom())
        manager.untrackRoom()

        assertNull(manager.activeRoomId.value)
        assertNull(manager.activeRoom.value)
        assertEquals(emptyList<Any>(), manager.messages.value)
        assertEquals(0L, manager.ownerAwayRemainingMs.value)
        assertFalse(manager.roomClosed.value)
    }

    @Test
    fun `isInRoom returns true when matching room tracked`() {
        manager.trackRoom("room-1")
        assertTrue(manager.isInRoom("room-1"))
        assertFalse(manager.isInRoom("room-2"))
    }

    @Test
    fun `isInAnyRoom returns true when any room tracked`() {
        assertFalse(manager.isInAnyRoom())
        manager.trackRoom("room-1")
        assertTrue(manager.isInAnyRoom())
    }

    @Test
    fun `updateTrackedRoom sets activeRoom`() {
        val room = TestData.createTestRoom()
        manager.updateTrackedRoom(room)
        assertEquals(room, manager.activeRoom.value)
    }

    // --- takeSeat ---

    @Test
    fun `takeSeat - owner takes seat 0 calls repository`() = runTest {
        manager.trackRoom("room-1")
        val room = TestData.createTestRoom(ownerId = currentUserId, seats = TestData.createDefaultSeats())
        manager.updateTrackedRoom(room)

        manager.takeSeat(Constants.OWNER_SEAT_INDEX)

        coVerify { roomRepository.takeSeat("room-1", Constants.OWNER_SEAT_INDEX, currentUserId) }
    }

    @Test
    fun `takeSeat - owner cannot take non-zero seat`() = runTest {
        manager.trackRoom("room-1")
        val room = TestData.createTestRoom(ownerId = currentUserId)
        manager.updateTrackedRoom(room)

        manager.takeSeat(3)

        coVerify(exactly = 0) { roomRepository.takeSeat(any(), any(), any()) }
    }

    @Test
    fun `takeSeat - non-owner cannot take seat 0`() = runTest {
        manager.trackRoom("room-1")
        val room = TestData.createTestRoom(
            ownerId = "other-owner",
            participantIds = listOf("other-owner", currentUserId)
        )
        manager.updateTrackedRoom(room)

        manager.takeSeat(Constants.OWNER_SEAT_INDEX)

        coVerify(exactly = 0) { roomRepository.takeSeat(any(), any(), any()) }
    }

    @Test
    fun `takeSeat - attendee creates request instead`() = runTest {
        manager.trackRoom("room-1")
        val room = TestData.createTestRoom(
            ownerId = "other-owner",
            participantIds = listOf("other-owner", currentUserId)
        )
        manager.updateTrackedRoom(room)

        manager.takeSeat(3)

        coVerify { seatRequestRepository.createRequest("room-1", currentUserId, any(), 3) }
        coVerify(exactly = 0) { roomRepository.takeSeat(any(), any(), any()) }
    }

    @Test
    fun `takeSeat - host with requireApproval ON is blocked`() = runTest {
        manager.trackRoom("room-1")
        val room = TestData.createTestRoom(
            ownerId = "other-owner",
            hostIds = listOf(currentUserId),
            requireApproval = true
        )
        manager.updateTrackedRoom(room)

        manager.takeSeat(3)

        coVerify(exactly = 0) { roomRepository.takeSeat(any(), any(), any()) }
    }

    @Test
    fun `takeSeat - occupied seat is rejected`() = runTest {
        manager.trackRoom("room-1")
        val seats = TestData.createDefaultSeats().toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "someone")
        val room = TestData.createTestRoom(
            ownerId = currentUserId,
            seats = seats
        )
        manager.updateTrackedRoom(room)

        // Owner tries seat 3 — but owner can only take seat 0
        // Use a host to test the occupied check
        every { authRepository.currentUser?.uid } returns "host-1"
        val hostManager = ActiveRoomManager(
            roomRepository, messageRepository, authRepository,
            userRepository, seatRequestRepository, agoraVoiceService, context
        )
        hostManager.trackRoom("room-1")
        val hostRoom = TestData.createTestRoom(
            ownerId = "other-owner",
            hostIds = listOf("host-1"),
            seats = seats
        )
        hostManager.updateTrackedRoom(hostRoom)
        hostManager.takeSeat(3)

        coVerify(exactly = 0) { roomRepository.takeSeat(any(), eq(3), any()) }
    }

    // --- leaveSeat ---

    @Test
    fun `leaveSeat - owner cannot leave seat 0`() = runTest {
        manager.trackRoom("room-1")
        val room = TestData.createTestRoom(ownerId = currentUserId)
        manager.updateTrackedRoom(room)

        manager.leaveSeat(Constants.OWNER_SEAT_INDEX)

        coVerify(exactly = 0) { roomRepository.leaveSeat(any(), any()) }
    }

    @Test
    fun `leaveSeat - non-owner seat calls repository`() = runTest {
        manager.trackRoom("room-1")
        val room = TestData.createTestRoom(ownerId = "other-owner")
        manager.updateTrackedRoom(room)

        manager.leaveSeat(3)

        coVerify { roomRepository.leaveSeat("room-1", 3) }
    }

    // --- removeFromSeat ---

    @Test
    fun `removeFromSeat - attendee is blocked`() = runTest {
        manager.trackRoom("room-1")
        val seats = TestData.createDefaultSeats().toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "target")
        val room = TestData.createTestRoom(
            ownerId = "other-owner",
            participantIds = listOf("other-owner", currentUserId, "target"),
            seats = seats
        )
        manager.updateTrackedRoom(room)

        manager.removeFromSeat(3)

        coVerify(exactly = 0) { roomRepository.removeFromSeat(any(), any()) }
    }

    @Test
    fun `removeFromSeat - cannot remove from owner seat`() = runTest {
        manager.trackRoom("room-1")
        val room = TestData.createTestRoom(
            ownerId = "other-owner",
            hostIds = listOf(currentUserId)
        )
        manager.updateTrackedRoom(room)

        manager.removeFromSeat(Constants.OWNER_SEAT_INDEX)

        coVerify(exactly = 0) { roomRepository.removeFromSeat(any(), any()) }
    }

    @Test
    fun `removeFromSeat - host cannot remove another host`() = runTest {
        manager.trackRoom("room-1")
        val seats = TestData.createDefaultSeats().toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "other-host")
        val room = TestData.createTestRoom(
            ownerId = "the-owner",
            hostIds = listOf(currentUserId, "other-host"),
            seats = seats
        )
        manager.updateTrackedRoom(room)

        manager.removeFromSeat(3)

        coVerify(exactly = 0) { roomRepository.removeFromSeat(any(), any()) }
    }

    // --- kickUser ---

    @Test
    fun `kickUser - cannot kick owner`() = runTest {
        manager.trackRoom("room-1")
        val seats = TestData.createDefaultSeats().toMutableMap()
        seats["0"] = TestData.createTestSeat(userId = "the-owner")
        val room = TestData.createTestRoom(
            ownerId = "the-owner",
            hostIds = listOf(currentUserId),
            seats = seats
        )
        manager.updateTrackedRoom(room)

        manager.kickUser(0)

        coVerify(exactly = 0) { roomRepository.kickUser(any(), any(), any()) }
    }

    @Test
    fun `kickUser - cannot kick host`() = runTest {
        manager.trackRoom("room-1")
        val seats = TestData.createDefaultSeats().toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "a-host")
        val room = TestData.createTestRoom(
            ownerId = "the-owner",
            hostIds = listOf(currentUserId, "a-host"),
            seats = seats
        )
        manager.updateTrackedRoom(room)

        manager.kickUser(3)

        coVerify(exactly = 0) { roomRepository.kickUser(any(), any(), any()) }
    }

    // --- inviteUser ---

    @Test
    fun `inviteUser - attendee is blocked`() = runTest {
        manager.trackRoom("room-1")
        val room = TestData.createTestRoom(
            ownerId = "other-owner",
            participantIds = listOf("other-owner", currentUserId)
        )
        manager.updateTrackedRoom(room)

        manager.inviteUser("target", "Target Name")

        coVerify(exactly = 0) { roomRepository.sendInvite(any(), any(), any()) }
    }

    @Test
    fun `inviteUser - owner can invite`() = runTest {
        manager.trackRoom("room-1")
        val room = TestData.createTestRoom(ownerId = currentUserId)
        manager.updateTrackedRoom(room)

        manager.inviteUser("target", "Target Name")

        coVerify { roomRepository.sendInvite("room-1", "target", currentUserId) }
    }

    // --- acceptInvite / declineInvite ---

    @Test
    fun `acceptInvite - finds first empty seat`() = runTest {
        manager.trackRoom("room-1")
        val seats = TestData.createDefaultSeats().toMutableMap()
        seats["0"] = TestData.createTestSeat(userId = "owner")
        seats["1"] = TestData.createTestSeat(userId = "someone")
        // Seat 2 is empty
        val room = TestData.createTestRoom(
            ownerId = "owner",
            participantIds = listOf("owner", "someone", currentUserId),
            pendingInvites = mapOf(currentUserId to "owner"),
            seats = seats
        )
        manager.updateTrackedRoom(room)

        manager.acceptInvite()

        coVerify { roomRepository.acceptInvite("room-1", currentUserId, 2) }
    }

    @Test
    fun `declineInvite calls cancelInvite`() = runTest {
        manager.trackRoom("room-1")

        manager.declineInvite()

        coVerify { roomRepository.cancelInvite("room-1", currentUserId) }
    }

    // --- sendMessage ---

    @Test
    fun `sendMessage - blank text is ignored`() = runTest {
        manager.trackRoom("room-1")

        manager.sendMessage("   ")

        coVerify(exactly = 0) { messageRepository.sendMessage(any(), any(), any(), any()) }
    }

    @Test
    fun `sendMessage - valid text forwards to repository`() = runTest {
        manager.trackRoom("room-1")

        manager.sendMessage("Hello!")

        coVerify { messageRepository.sendMessage("room-1", currentUserId, any(), "Hello!") }
    }

    // --- toggleSelfMute ---

    @Test
    fun `toggleSelfMute - only works for own seat`() = runTest {
        manager.trackRoom("room-1")
        val seats = TestData.createDefaultSeats().toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = "someone-else", isMuted = false)
        val room = TestData.createTestRoom(ownerId = "owner", seats = seats)
        manager.updateTrackedRoom(room)

        manager.toggleSelfMute(3)

        coVerify(exactly = 0) { roomRepository.toggleMute(any(), any(), any()) }
    }

    @Test
    fun `toggleSelfMute - toggles mute state for own seat`() = runTest {
        manager.trackRoom("room-1")
        val seats = TestData.createDefaultSeats().toMutableMap()
        seats["3"] = TestData.createTestSeat(userId = currentUserId, isMuted = false)
        val room = TestData.createTestRoom(ownerId = "owner", seats = seats)
        manager.updateTrackedRoom(room)

        manager.toggleSelfMute(3)

        coVerify { roomRepository.toggleMute("room-1", 3, true) }
        coVerify { agoraVoiceService.muteLocalAudio(true) }
    }

    // --- forceMuteUser ---

    @Test
    fun `forceMuteUser - cannot mute owner`() = runTest {
        manager.trackRoom("room-1")
        val seats = TestData.createDefaultSeats().toMutableMap()
        seats["0"] = TestData.createTestSeat(userId = "the-owner")
        val room = TestData.createTestRoom(
            ownerId = "the-owner",
            hostIds = listOf(currentUserId),
            seats = seats
        )
        manager.updateTrackedRoom(room)

        manager.forceMuteUser(0)

        coVerify(exactly = 0) { roomRepository.toggleMute(any(), any(), any()) }
    }

    // --- moveSeat ---

    @Test
    fun `moveSeat - cannot move from owner seat`() = runTest {
        manager.trackRoom("room-1")
        val room = TestData.createTestRoom(
            ownerId = "owner",
            hostIds = listOf(currentUserId)
        )
        manager.updateTrackedRoom(room)

        manager.moveSeat(Constants.OWNER_SEAT_INDEX, 3)

        coVerify(exactly = 0) { roomRepository.moveSeat(any(), any(), any(), any()) }
    }

    @Test
    fun `moveSeat - cannot move to occupied seat`() = runTest {
        manager.trackRoom("room-1")
        val seats = TestData.createDefaultSeats().toMutableMap()
        seats["2"] = TestData.createTestSeat(userId = "target")
        seats["3"] = TestData.createTestSeat(userId = "occupied")
        val room = TestData.createTestRoom(
            ownerId = currentUserId,
            seats = seats
        )
        manager.updateTrackedRoom(room)

        manager.moveSeat(2, 3)

        coVerify(exactly = 0) { roomRepository.moveSeat(any(), any(), any(), any()) }
    }
}
