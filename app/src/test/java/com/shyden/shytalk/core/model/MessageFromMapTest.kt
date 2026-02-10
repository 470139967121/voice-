package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Date

class MessageFromMapTest {

    private val ts = Timestamp(Date(1_000_000_000L))

    @Test
    fun `fromMap parses complete valid map`() {
        val map = mapOf<String, Any?>(
            "senderId" to "user-1",
            "senderName" to "Alice",
            "text" to "Hello",
            "createdAt" to ts,
            "type" to "TEXT"
        )
        val msg = Message.fromMap(map, "msg-1")
        assertEquals("msg-1", msg.messageId)
        assertEquals("user-1", msg.senderId)
        assertEquals("Alice", msg.senderName)
        assertEquals("Hello", msg.text)
        assertEquals(ts, msg.createdAt)
        assertEquals(MessageType.TEXT, msg.type)
    }

    @Test
    fun `fromMap defaults type to TEXT for invalid value`() {
        val map = mapOf<String, Any?>("type" to "INVALID")
        val msg = Message.fromMap(map, "msg-1")
        assertEquals(MessageType.TEXT, msg.type)
    }

    @Test
    fun `fromMap defaults type to TEXT when missing`() {
        val msg = Message.fromMap(emptyMap(), "msg-1")
        assertEquals(MessageType.TEXT, msg.type)
    }

    @Test
    fun `fromMap parses SYSTEM type`() {
        val map = mapOf<String, Any?>("type" to "SYSTEM")
        val msg = Message.fromMap(map, "msg-1")
        assertEquals(MessageType.SYSTEM, msg.type)
    }

    @Test
    fun `fromMap parses JOIN type`() {
        val map = mapOf<String, Any?>("type" to "JOIN")
        val msg = Message.fromMap(map, "msg-1")
        assertEquals(MessageType.JOIN, msg.type)
    }

    @Test
    fun `fromMap handles empty map with all defaults`() {
        val msg = Message.fromMap(emptyMap(), "msg-1")
        assertEquals("msg-1", msg.messageId)
        assertEquals("", msg.senderId)
        assertEquals("", msg.senderName)
        assertEquals("", msg.text)
        assertEquals(MessageType.TEXT, msg.type)
    }

    @Test
    fun `toMap produces correct map`() {
        val msg = Message(
            messageId = "msg-1",
            senderId = "user-1",
            senderName = "Alice",
            text = "Hello",
            createdAt = ts,
            type = MessageType.SYSTEM
        )
        val map = msg.toMap()
        assertEquals("msg-1", map["messageId"])
        assertEquals("user-1", map["senderId"])
        assertEquals("Alice", map["senderName"])
        assertEquals("Hello", map["text"])
        assertEquals(ts, map["createdAt"])
        assertEquals("SYSTEM", map["type"])
    }
}
