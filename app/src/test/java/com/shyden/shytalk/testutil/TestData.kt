package com.shyden.shytalk.testutil

import com.google.firebase.Timestamp
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.MessageType
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.Seat
import com.shyden.shytalk.core.model.SeatRequest
import com.shyden.shytalk.core.model.SeatRequestStatus
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.model.User
import java.util.Date

object TestData {

    val BASE_TIMESTAMP = Timestamp(Date(1_000_000_000L))
    val LATER_TIMESTAMP = Timestamp(Date(2_000_000_000L))

    fun createTestUser(
        uid: String = "user-1",
        displayName: String = "Test User",
        blockedUserIds: Set<String> = emptySet(),
        profilePhotoUrl: String? = null,
        coverPhotoUrl: String? = null,
        uniqueId: Long = 12345L
    ) = User(
        uid = uid,
        displayName = displayName,
        blockedUserIds = blockedUserIds,
        profilePhotoUrl = profilePhotoUrl,
        coverPhotoUrl = coverPhotoUrl,
        uniqueId = uniqueId,
        createdAt = BASE_TIMESTAMP,
        lastSeenAt = BASE_TIMESTAMP
    )

    fun createTestSeat(
        userId: String? = null,
        state: SeatState = if (userId != null) SeatState.OCCUPIED else SeatState.EMPTY,
        isMuted: Boolean = false
    ) = Seat(userId = userId, state = state, isMuted = isMuted)

    fun createDefaultSeats(): Map<String, Seat> = ChatRoom.DEFAULT_SEATS

    fun createSeatsWithOwner(ownerId: String): Map<String, Seat> {
        val seats = createDefaultSeats().toMutableMap()
        seats["0"] = createTestSeat(userId = ownerId)
        return seats
    }

    fun createTestRoom(
        roomId: String = "room-1",
        name: String = "Test Room",
        ownerId: String = "owner-1",
        state: RoomState = RoomState.ACTIVE,
        participantIds: Set<String> = setOf(ownerId),
        hostIds: Set<String> = emptySet(),
        requireApproval: Boolean = false,
        bannedUserIds: Set<String> = emptySet(),
        pendingInvites: Map<String, String> = emptyMap(),
        seats: Map<String, Seat> = createSeatsWithOwner(ownerId),
        agoraChannelName: String = "channel-1",
        firstJoinTimestamps: Map<String, Timestamp> = emptyMap(),
        ownerLeftAt: Timestamp? = null,
        closedAt: Timestamp? = null
    ) = ChatRoom(
        roomId = roomId,
        name = name,
        ownerId = ownerId,
        state = state,
        participantIds = participantIds,
        hostIds = hostIds,
        requireApproval = requireApproval,
        bannedUserIds = bannedUserIds,
        pendingInvites = pendingInvites,
        seats = seats,
        agoraChannelName = agoraChannelName,
        firstJoinTimestamps = firstJoinTimestamps,
        createdAt = BASE_TIMESTAMP,
        ownerLeftAt = ownerLeftAt,
        closedAt = closedAt
    )

    fun createTestMessage(
        messageId: String = "msg-1",
        senderId: String = "user-1",
        senderName: String = "Test User",
        text: String = "Hello",
        type: MessageType = MessageType.TEXT,
        createdAt: Timestamp = BASE_TIMESTAMP
    ) = Message(
        messageId = messageId,
        senderId = senderId,
        senderName = senderName,
        text = text,
        type = type,
        createdAt = createdAt
    )

    fun createTestSeatRequest(
        requestId: String = "req-1",
        userId: String = "user-1",
        userName: String = "Test User",
        seatIndex: Int = 3,
        status: SeatRequestStatus = SeatRequestStatus.PENDING,
        createdAt: Timestamp = BASE_TIMESTAMP,
        resolvedBy: String? = null,
        resolvedAt: Timestamp? = null
    ) = SeatRequest(
        requestId = requestId,
        userId = userId,
        userName = userName,
        seatIndex = seatIndex,
        status = status,
        createdAt = createdAt,
        resolvedBy = resolvedBy,
        resolvedAt = resolvedAt
    )
}
