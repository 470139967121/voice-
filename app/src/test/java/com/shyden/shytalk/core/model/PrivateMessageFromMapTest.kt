package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Date

class PrivateMessageFromMapTest {

    private val tsMillis = 1_000_000_000L
    private val ts = Timestamp(Date(tsMillis))

    @Test
    fun `fromMap parses complete valid map`() {
        val map = mapOf<String, Any?>(
            "senderId" to "user-1",
            "senderName" to "Alice",
            "text" to "Hello!",
            "imageUrls" to listOf("https://img1.png", "https://img2.png"),
            "type" to "IMAGE",
            "createdAt" to ts,
            "editedAt" to ts,
            "editCount" to 2L,
            "readBy" to listOf("user-2", "user-3"),
            "replyToMessageId" to "msg-99",
            "replyToText" to "Original",
            "replyToSenderName" to "Bob",
            "reactions" to mapOf("👍" to listOf("user-2"), "❤️" to listOf("user-1", "user-3"))
        )
        val msg = PrivateMessage.fromMap(map, "pm-1")

        assertEquals("pm-1", msg.messageId)
        assertEquals("user-1", msg.senderId)
        assertEquals("Alice", msg.senderName)
        assertEquals("Hello!", msg.text)
        assertEquals(listOf("https://img1.png", "https://img2.png"), msg.imageUrls)
        assertEquals(PrivateMessageType.IMAGE, msg.type)
        assertEquals(tsMillis, msg.createdAt)
        assertEquals(tsMillis, msg.editedAt)
        assertEquals(2L, msg.editCount)
        assertEquals(listOf("user-2", "user-3"), msg.readBy)
        assertEquals("msg-99", msg.replyToMessageId)
        assertEquals("Original", msg.replyToText)
        assertEquals("Bob", msg.replyToSenderName)
        assertEquals(mapOf("👍" to listOf("user-2"), "❤️" to listOf("user-1", "user-3")), msg.reactions)
    }

    @Test
    fun `fromMap handles empty map with all defaults`() {
        val msg = PrivateMessage.fromMap(emptyMap(), "pm-1")

        assertEquals("pm-1", msg.messageId)
        assertEquals("", msg.senderId)
        assertEquals("", msg.senderName)
        assertEquals("", msg.text)
        assertEquals(emptyList<String>(), msg.imageUrls)
        assertEquals(PrivateMessageType.TEXT, msg.type)
        assertEquals(0L, msg.editCount)
        assertEquals(emptyList<String>(), msg.readBy)
        assertNull(msg.replyToMessageId)
        assertNull(msg.replyToText)
        assertNull(msg.replyToSenderName)
        assertEquals(emptyMap<String, List<String>>(), msg.reactions)
    }

    @Test
    fun `fromMap defaults type to TEXT for invalid value`() {
        val map = mapOf<String, Any?>("type" to "INVALID_TYPE")
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertEquals(PrivateMessageType.TEXT, msg.type)
    }

    @Test
    fun `fromMap defaults type to TEXT when missing`() {
        val map = mapOf<String, Any?>("type" to null)
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertEquals(PrivateMessageType.TEXT, msg.type)
    }

    @Test
    fun `fromMap filters non-string items from imageUrls`() {
        val map = mapOf<String, Any?>(
            "imageUrls" to listOf("https://img1.png", 42, null, "https://img2.png")
        )
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertEquals(listOf("https://img1.png", "https://img2.png"), msg.imageUrls)
    }

    @Test
    fun `fromMap defaults imageUrls to empty when null`() {
        val map = mapOf<String, Any?>("imageUrls" to null)
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertEquals(emptyList<String>(), msg.imageUrls)
    }

    @Test
    fun `fromMap filters non-string items from readBy`() {
        val map = mapOf<String, Any?>(
            "readBy" to listOf("user-1", 99, null, "user-2")
        )
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertEquals(listOf("user-1", "user-2"), msg.readBy)
    }

    @Test
    fun `fromMap defaults readBy to empty when null`() {
        val map = mapOf<String, Any?>("readBy" to null)
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertEquals(emptyList<String>(), msg.readBy)
    }

    @Test
    fun `fromMap parses reactions with valid nested map`() {
        val map = mapOf<String, Any?>(
            "reactions" to mapOf("👍" to listOf("user-1", "user-2"), "🔥" to listOf("user-3"))
        )
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertEquals(2, msg.reactions.size)
        assertEquals(listOf("user-1", "user-2"), msg.reactions["👍"])
        assertEquals(listOf("user-3"), msg.reactions["🔥"])
    }

    @Test
    fun `fromMap defaults reactions to empty when null`() {
        val map = mapOf<String, Any?>("reactions" to null)
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertEquals(emptyMap<String, List<String>>(), msg.reactions)
    }

    @Test
    fun `fromMap skips reaction entries with non-string keys`() {
        val map = mapOf<String, Any?>(
            "reactions" to mapOf(42 to listOf("user-1"), "👍" to listOf("user-2"))
        )
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertEquals(1, msg.reactions.size)
        assertEquals(listOf("user-2"), msg.reactions["👍"])
    }

    @Test
    fun `fromMap handles nullable reply fields`() {
        val map = mapOf<String, Any?>(
            "replyToMessageId" to null,
            "replyToText" to null,
            "replyToSenderName" to null
        )
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertNull(msg.replyToMessageId)
        assertNull(msg.replyToText)
        assertNull(msg.replyToSenderName)
    }

    @Test
    fun `fromMap handles editedAt when null`() {
        val map = mapOf<String, Any?>("editedAt" to null)
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertNull(msg.editedAt)
    }

    @Test
    fun `fromMap of toMap produces equivalent message`() {
        val original = PrivateMessage(
            messageId = "pm-1",
            senderId = "user-1",
            senderName = "Alice",
            text = "Hello!",
            imageUrls = listOf("https://img1.png"),
            type = PrivateMessageType.IMAGE,
            createdAt = tsMillis,
            editedAt = tsMillis,
            editCount = 1,
            readBy = listOf("user-2"),
            replyToMessageId = "msg-99",
            replyToText = "Original",
            replyToSenderName = "Bob",
            reactions = mapOf("👍" to listOf("user-2"))
        )
        val roundtripped = PrivateMessage.fromMap(original.toMap(), "pm-1")
        assertEquals(original, roundtripped)
    }
}
