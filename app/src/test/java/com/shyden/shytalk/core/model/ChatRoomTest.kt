package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Date

class ChatRoomTest {

    private val baseTimestamp = Timestamp(Date(1_000_000_000L))

    @Test
    fun `kickInfo round-trips through toMap and fromMap`() {
        val room = ChatRoom(
            roomId = "room-1",
            name = "Test",
            ownerId = "owner",
            createdAt = baseTimestamp,
            kickInfo = mapOf(
                "user-1" to mapOf("kickerName" to "Admin", "reason" to "Spamming"),
                "user-2" to mapOf("kickerName" to "Mod", "reason" to "No reason given")
            )
        )

        val map = room.toMap()
        val restored = ChatRoom.fromMap(map, "room-1")

        assertEquals(2, restored.kickInfo.size)
        assertEquals("Admin", restored.kickInfo["user-1"]?.get("kickerName"))
        assertEquals("Spamming", restored.kickInfo["user-1"]?.get("reason"))
        assertEquals("Mod", restored.kickInfo["user-2"]?.get("kickerName"))
        assertEquals("No reason given", restored.kickInfo["user-2"]?.get("reason"))
    }

    @Test
    fun `missing kickInfo in map defaults to empty`() {
        val map = mapOf<String, Any?>(
            "roomId" to "room-1",
            "name" to "Test",
            "ownerId" to "owner",
            "createdAt" to baseTimestamp
        )

        val room = ChatRoom.fromMap(map, "room-1")

        assertTrue(room.kickInfo.isEmpty())
    }

    @Test
    fun `resolveRole returns correct roles`() {
        val room = ChatRoom(
            roomId = "room-1",
            ownerId = "owner",
            hostIds = setOf("host-1"),
            createdAt = baseTimestamp
        )

        assertEquals(RoomRole.OWNER, room.resolveRole("owner"))
        assertEquals(RoomRole.HOST, room.resolveRole("host-1"))
        assertEquals(RoomRole.ATTENDEE, room.resolveRole("random-user"))
    }

    @Test
    fun `requireApproval defaults to false`() {
        val map = mapOf<String, Any?>(
            "roomId" to "room-1",
            "ownerId" to "owner",
            "createdAt" to baseTimestamp
        )

        val room = ChatRoom.fromMap(map, "room-1")

        assertEquals(false, room.requireApproval)
    }

    @Test
    fun `bannedUserIds round-trips correctly`() {
        val room = ChatRoom(
            roomId = "room-1",
            ownerId = "owner",
            bannedUserIds = setOf("banned-1", "banned-2"),
            createdAt = baseTimestamp
        )

        val map = room.toMap()
        val restored = ChatRoom.fromMap(map, "room-1")

        assertEquals(setOf("banned-1", "banned-2"), restored.bannedUserIds)
    }
}
