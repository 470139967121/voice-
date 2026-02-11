package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp
import com.shyden.shytalk.core.util.Constants
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import java.util.Date

class ChatRoomFromMapTest {

    private val ts = Timestamp(Date(1_000_000_000L))

    @Test
    fun `fromMap parses complete valid map`() {
        val map = mapOf<String, Any?>(
            "name" to "My Room",
            "ownerId" to "owner-1",
            "state" to "ACTIVE",
            "createdAt" to ts,
            "participantIds" to listOf("owner-1", "user-2"),
            "hostIds" to listOf("user-2"),
            "requireApproval" to true,
            "bannedUserIds" to listOf("banned-1"),
            "agoraChannelName" to "channel-1",
            "seats" to mapOf(
                "0" to mapOf("userId" to "owner-1", "state" to "OCCUPIED", "isMuted" to false)
            )
        )
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals("room-1", room.roomId)
        assertEquals("My Room", room.name)
        assertEquals("owner-1", room.ownerId)
        assertEquals(RoomState.ACTIVE, room.state)
        assertEquals(setOf("owner-1", "user-2"), room.participantIds)
        assertEquals(setOf("user-2"), room.hostIds)
        assertEquals(true, room.requireApproval)
        assertEquals(setOf("banned-1"), room.bannedUserIds)
        assertEquals("channel-1", room.agoraChannelName)
        assertEquals("owner-1", room.seats["0"]?.userId)
    }

    @Test
    fun `fromMap defaults name to empty string when missing`() {
        val room = ChatRoom.fromMap(emptyMap(), "room-1")
        assertEquals("", room.name)
    }

    @Test
    fun `fromMap defaults state to ACTIVE for invalid value`() {
        val map = mapOf<String, Any?>("state" to "INVALID")
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals(RoomState.ACTIVE, room.state)
    }

    @Test
    fun `fromMap defaults state to ACTIVE when missing`() {
        val room = ChatRoom.fromMap(emptyMap(), "room-1")
        assertEquals(RoomState.ACTIVE, room.state)
    }

    @Test
    fun `fromMap parses OWNER_AWAY state`() {
        val map = mapOf<String, Any?>("state" to "OWNER_AWAY")
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals(RoomState.OWNER_AWAY, room.state)
    }

    @Test
    fun `fromMap parses CLOSED state`() {
        val map = mapOf<String, Any?>("state" to "CLOSED")
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals(RoomState.CLOSED, room.state)
    }

    @Test
    fun `fromMap filters non-string items from participantIds`() {
        val map = mapOf<String, Any?>(
            "participantIds" to listOf("user-1", 42, null, "user-2")
        )
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals(setOf("user-1", "user-2"), room.participantIds)
    }

    @Test
    fun `fromMap defaults participantIds to empty when missing`() {
        val room = ChatRoom.fromMap(emptyMap(), "room-1")
        assertEquals(emptySet<String>(), room.participantIds)
    }

    @Test
    fun `fromMap creates all MAX_SEATS seats even when map has partial data`() {
        val map = mapOf<String, Any?>(
            "seats" to mapOf("0" to mapOf("userId" to "owner-1", "state" to "OCCUPIED"))
        )
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals(Constants.MAX_SEATS, room.seats.size)
        assertEquals("owner-1", room.seats["0"]?.userId)
        assertNull(room.seats["1"]?.userId)
    }

    @Test
    fun `fromMap handles empty map with all defaults`() {
        val room = ChatRoom.fromMap(emptyMap(), "room-1")
        assertEquals("room-1", room.roomId)
        assertEquals("", room.name)
        assertEquals("", room.ownerId)
        assertEquals(RoomState.ACTIVE, room.state)
        assertEquals(emptySet<String>(), room.participantIds)
        assertEquals(emptySet<String>(), room.hostIds)
        assertFalse(room.requireApproval)
        assertEquals(emptySet<String>(), room.bannedUserIds)
        assertEquals(emptyMap<String, String>(), room.pendingInvites)
        assertEquals(Constants.MAX_SEATS, room.seats.size)
    }

    @Test
    fun `fromMap parses pendingInvites with string values`() {
        val map = mapOf<String, Any?>(
            "pendingInvites" to mapOf("user-1" to "inviter-1", "user-2" to "inviter-2")
        )
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals("inviter-1", room.pendingInvites["user-1"])
        assertEquals("inviter-2", room.pendingInvites["user-2"])
    }

    @Test
    fun `fromMap defaults requireApproval to false when missing`() {
        val room = ChatRoom.fromMap(emptyMap(), "room-1")
        assertFalse(room.requireApproval)
    }

    @Test
    fun `toMap produces correct map`() {
        val room = ChatRoom(
            roomId = "room-1",
            name = "My Room",
            ownerId = "owner-1",
            state = RoomState.ACTIVE,
            createdAt = ts,
            participantIds = setOf("owner-1"),
            requireApproval = true,
            agoraChannelName = "ch-1"
        )
        val map = room.toMap()
        assertEquals("room-1", map["roomId"])
        assertEquals("My Room", map["name"])
        assertEquals("owner-1", map["ownerId"])
        assertEquals("ACTIVE", map["state"])
        assertEquals(ts, map["createdAt"])
        assertEquals(true, map["requireApproval"])
    }

    @Test
    fun `toMap seats are serialized as nested maps`() {
        val room = ChatRoom(
            roomId = "room-1",
            createdAt = ts,
            seats = mapOf("0" to Seat(userId = "owner-1", state = SeatState.OCCUPIED))
        )
        val map = room.toMap()
        @Suppress("UNCHECKED_CAST")
        val seatsMap = map["seats"] as Map<String, Map<String, Any?>>
        assertEquals("owner-1", seatsMap["0"]?.get("userId"))
        assertEquals("OCCUPIED", seatsMap["0"]?.get("state"))
    }

    @Test
    fun `fromMap of toMap produces equivalent room`() {
        val seats = (0 until Constants.MAX_SEATS).associate { i ->
            i.toString() to if (i == 0) Seat(userId = "owner-1", state = SeatState.OCCUPIED)
            else Seat()
        }
        val original = ChatRoom(
            roomId = "room-1",
            name = "Test Room",
            ownerId = "owner-1",
            state = RoomState.ACTIVE,
            createdAt = ts,
            participantIds = setOf("owner-1", "user-2"),
            hostIds = setOf("user-2"),
            requireApproval = true,
            bannedUserIds = setOf("banned-1"),
            pendingInvites = mapOf("user-3" to "owner-1"),
            seats = seats,
            agoraChannelName = "channel-1",
            firstJoinTimestamps = mapOf("owner-1" to ts)
        )
        val roundtripped = ChatRoom.fromMap(original.toMap(), "room-1")
        assertEquals(original, roundtripped)
    }

    // --- resolveRole ---

    @Test
    fun `resolveRole returns OWNER when userId matches ownerId`() {
        val room = ChatRoom(roomId = "r", ownerId = "user-1")
        assertEquals(RoomRole.OWNER, room.resolveRole("user-1"))
    }

    @Test
    fun `resolveRole returns HOST when userId in hostIds`() {
        val room = ChatRoom(roomId = "r", ownerId = "owner", hostIds = setOf("host-1"))
        assertEquals(RoomRole.HOST, room.resolveRole("host-1"))
    }

    @Test
    fun `resolveRole returns ATTENDEE for regular user`() {
        val room = ChatRoom(roomId = "r", ownerId = "owner")
        assertEquals(RoomRole.ATTENDEE, room.resolveRole("other"))
    }

    @Test
    fun `resolveRole prioritizes OWNER over HOST`() {
        val room = ChatRoom(roomId = "r", ownerId = "user-1", hostIds = setOf("user-1"))
        assertEquals(RoomRole.OWNER, room.resolveRole("user-1"))
    }

    // --- DEFAULT_SEATS ---

    @Test
    fun `DEFAULT_SEATS has MAX_SEATS entries all empty`() {
        val seats = ChatRoom.DEFAULT_SEATS
        assertEquals(Constants.MAX_SEATS, seats.size)
        seats.values.forEach { seat ->
            assertNull(seat.userId)
            assertEquals(SeatState.EMPTY, seat.state)
            assertFalse(seat.isMuted)
        }
    }

    @Test
    fun `default constructor uses DEFAULT_SEATS`() {
        val room = ChatRoom()
        assertEquals(ChatRoom.DEFAULT_SEATS, room.seats)
    }

    @Test
    fun `DEFAULT_SEATS is same instance on repeated access`() {
        // Verifies the constant is not re-computed each time
        assertSame(ChatRoom.DEFAULT_SEATS, ChatRoom.DEFAULT_SEATS)
    }

    @Test
    fun `DEFAULT_SEATS keys are zero-indexed strings`() {
        val expectedKeys = (0 until Constants.MAX_SEATS).map { it.toString() }.toSet()
        assertEquals(expectedKeys, ChatRoom.DEFAULT_SEATS.keys)
    }
}
