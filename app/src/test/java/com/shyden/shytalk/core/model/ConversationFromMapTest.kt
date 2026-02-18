package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Date

class ConversationFromMapTest {

    private val tsMillis = 1_000_000_000L
    private val ts = Timestamp(Date(tsMillis))

    // ===== fromMap / toMap =====

    @Test
    fun `fromMap parses 1-on-1 conversation`() {
        val map = mapOf<String, Any?>(
            "participantIds" to listOf("user-1", "user-2"),
            "lastMessageAt" to ts,
            "createdAt" to ts,
            "isGroup" to false
        )
        val conv = Conversation.fromMap(map, "conv-1")

        assertEquals("conv-1", conv.conversationId)
        assertEquals(listOf("user-1", "user-2"), conv.participantIds)
        assertNull(conv.lastMessage)
        assertEquals(tsMillis, conv.lastMessageAt)
        assertEquals(tsMillis, conv.createdAt)
        assertFalse(conv.isGroup)
        assertNull(conv.groupName)
        assertNull(conv.groupPhotoUrl)
        assertEquals(emptyList<String>(), conv.groupAdminIds)
        assertNull(conv.createdBy)
    }

    @Test
    fun `fromMap parses group conversation`() {
        val map = mapOf<String, Any?>(
            "participantIds" to listOf("user-1", "user-2", "user-3"),
            "lastMessageAt" to ts,
            "createdAt" to ts,
            "isGroup" to true,
            "groupName" to "Cool Group",
            "groupPhotoUrl" to "https://group.png",
            "groupAdminIds" to listOf("user-1"),
            "createdBy" to "user-1"
        )
        val conv = Conversation.fromMap(map, "conv-1")

        assertTrue(conv.isGroup)
        assertEquals("Cool Group", conv.groupName)
        assertEquals("https://group.png", conv.groupPhotoUrl)
        assertEquals(listOf("user-1"), conv.groupAdminIds)
        assertEquals("user-1", conv.createdBy)
    }

    @Test
    fun `fromMap handles empty map with defaults`() {
        val conv = Conversation.fromMap(emptyMap(), "conv-1")

        assertEquals("conv-1", conv.conversationId)
        assertEquals(emptyList<String>(), conv.participantIds)
        assertNull(conv.lastMessage)
        assertFalse(conv.isGroup)
        assertNull(conv.groupName)
        assertNull(conv.groupPhotoUrl)
        assertEquals(emptyList<String>(), conv.groupAdminIds)
        assertNull(conv.createdBy)
    }

    @Test
    fun `fromMap parses lastMessage sub-map`() {
        val lastMsgMap = mapOf<String, Any?>(
            "text" to "Hey!",
            "senderId" to "user-1",
            "senderName" to "Alice",
            "createdAt" to ts,
            "type" to "TEXT"
        )
        val map = mapOf<String, Any?>(
            "lastMessage" to lastMsgMap,
            "lastMessageAt" to ts,
            "createdAt" to ts
        )
        val conv = Conversation.fromMap(map, "conv-1")

        val lm = conv.lastMessage
        assertEquals("Hey!", lm?.text)
        assertEquals("user-1", lm?.senderId)
        assertEquals("Alice", lm?.senderName)
        assertEquals(tsMillis, lm?.createdAt)
        assertEquals("TEXT", lm?.type)
    }

    @Test
    fun `fromMap handles lastMessage null`() {
        val map = mapOf<String, Any?>("lastMessage" to null)
        val conv = Conversation.fromMap(map, "conv-1")
        assertNull(conv.lastMessage)
    }

    @Test
    fun `fromMap filters non-string items from participantIds`() {
        val map = mapOf<String, Any?>(
            "participantIds" to listOf("user-1", 42, null, "user-2")
        )
        val conv = Conversation.fromMap(map, "conv-1")
        assertEquals(listOf("user-1", "user-2"), conv.participantIds)
    }

    @Test
    fun `fromMap filters non-string items from groupAdminIds`() {
        val map = mapOf<String, Any?>(
            "groupAdminIds" to listOf("user-1", 99, null)
        )
        val conv = Conversation.fromMap(map, "conv-1")
        assertEquals(listOf("user-1"), conv.groupAdminIds)
    }

    @Test
    fun `toMap includes group fields only for group conversations`() {
        val group = Conversation(
            conversationId = "conv-1",
            isGroup = true,
            groupName = "Group",
            groupPhotoUrl = "https://photo.png",
            groupAdminIds = listOf("user-1"),
            createdBy = "user-1",
            lastMessageAt = tsMillis,
            createdAt = tsMillis
        )
        val groupMap = group.toMap()
        assertTrue(groupMap.containsKey("groupName"))
        assertTrue(groupMap.containsKey("groupPhotoUrl"))
        assertTrue(groupMap.containsKey("groupAdminIds"))
        assertTrue(groupMap.containsKey("createdBy"))
    }

    @Test
    fun `toMap omits group fields for 1-on-1 conversations`() {
        val oneOnOne = Conversation(
            conversationId = "conv-1",
            isGroup = false,
            lastMessageAt = tsMillis,
            createdAt = tsMillis
        )
        val map = oneOnOne.toMap()
        assertFalse(map.containsKey("groupName"))
        assertFalse(map.containsKey("groupPhotoUrl"))
        assertFalse(map.containsKey("groupAdminIds"))
        assertFalse(map.containsKey("createdBy"))
    }

    @Test
    fun `fromMap of toMap round-trip for 1-on-1`() {
        val original = Conversation(
            conversationId = "conv-1",
            participantIds = listOf("user-1", "user-2"),
            lastMessage = ConversationPreview(
                text = "Hi",
                senderId = "user-1",
                senderName = "Alice",
                createdAt = tsMillis,
                type = "TEXT"
            ),
            lastMessageAt = tsMillis,
            createdAt = tsMillis,
            isGroup = false
        )
        val roundtripped = Conversation.fromMap(original.toMap(), "conv-1")
        assertEquals(original, roundtripped)
    }

    @Test
    fun `fromMap of toMap round-trip for group`() {
        val original = Conversation(
            conversationId = "conv-g",
            participantIds = listOf("user-1", "user-2", "user-3"),
            lastMessage = null,
            lastMessageAt = tsMillis,
            createdAt = tsMillis,
            isGroup = true,
            groupName = "Test Group",
            groupPhotoUrl = "https://group.png",
            groupAdminIds = listOf("user-1"),
            createdBy = "user-1"
        )
        val roundtripped = Conversation.fromMap(original.toMap(), "conv-g")
        assertEquals(original, roundtripped)
    }

    // ===== Helper methods =====

    @Test
    fun `generateId sorts UIDs alphabetically`() {
        assertEquals("abc_xyz", Conversation.generateId("xyz", "abc"))
        assertEquals("abc_xyz", Conversation.generateId("abc", "xyz"))
    }

    @Test
    fun `generateId is symmetric`() {
        val id1 = Conversation.generateId("user-1", "user-2")
        val id2 = Conversation.generateId("user-2", "user-1")
        assertEquals(id1, id2)
    }

    @Test
    fun `otherUserId returns the other participant`() {
        val conv = Conversation(participantIds = listOf("user-1", "user-2"))
        assertEquals("user-2", conv.otherUserId("user-1"))
        assertEquals("user-1", conv.otherUserId("user-2"))
    }

    @Test
    fun `otherUserId returns first non-matching for non-participant`() {
        val conv = Conversation(participantIds = listOf("user-1", "user-2"))
        // "user-3" is not a participant, so firstOrNull { it != "user-3" } returns "user-1"
        assertEquals("user-1", conv.otherUserId("user-3"))
    }

    @Test
    fun `isAdmin checks groupAdminIds and createdBy`() {
        val conv = Conversation(
            isGroup = true,
            groupAdminIds = listOf("admin-1"),
            createdBy = "creator-1"
        )
        assertTrue(conv.isAdmin("admin-1"))
        assertTrue(conv.isAdmin("creator-1"))
        assertFalse(conv.isAdmin("user-99"))
    }

    @Test
    fun `isOneOnOne reflects isGroup`() {
        val oneOnOne = Conversation(isGroup = false)
        assertTrue(oneOnOne.isOneOnOne)

        val group = Conversation(isGroup = true)
        assertFalse(group.isOneOnOne)
    }
}
