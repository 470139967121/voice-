package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp
import com.shyden.shytalk.core.util.Constants
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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
        assertEquals(listOf("owner-1", "user-2"), room.participantIds)
        assertEquals(listOf("user-2"), room.hostIds)
        assertEquals(true, room.requireApproval)
        assertEquals(listOf("banned-1"), room.bannedUserIds)
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
        assertEquals(listOf("user-1", "user-2"), room.participantIds)
    }

    @Test
    fun `fromMap defaults participantIds to empty when missing`() {
        val room = ChatRoom.fromMap(emptyMap(), "room-1")
        assertEquals(emptyList<String>(), room.participantIds)
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
        assertEquals(emptyList<String>(), room.participantIds)
        assertEquals(emptyList<String>(), room.hostIds)
        assertFalse(room.requireApproval)
        assertEquals(emptyList<String>(), room.bannedUserIds)
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
            participantIds = listOf("owner-1"),
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
}
