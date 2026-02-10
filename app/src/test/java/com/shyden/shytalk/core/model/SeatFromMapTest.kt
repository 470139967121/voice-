package com.shyden.shytalk.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class SeatFromMapTest {

    @Test
    fun `fromMap parses complete valid map`() {
        val map = mapOf<String, Any?>(
            "userId" to "user-1",
            "state" to "OCCUPIED",
            "isMuted" to true
        )
        val seat = Seat.fromMap(map)
        assertEquals("user-1", seat.userId)
        assertEquals(SeatState.OCCUPIED, seat.state)
        assertEquals(true, seat.isMuted)
    }

    @Test
    fun `fromMap defaults userId to null when missing`() {
        val seat = Seat.fromMap(emptyMap())
        assertNull(seat.userId)
    }

    @Test
    fun `fromMap defaults state to EMPTY for invalid value`() {
        val map = mapOf<String, Any?>("state" to "INVALID")
        val seat = Seat.fromMap(map)
        assertEquals(SeatState.EMPTY, seat.state)
    }

    @Test
    fun `fromMap defaults state to EMPTY when missing`() {
        val seat = Seat.fromMap(emptyMap())
        assertEquals(SeatState.EMPTY, seat.state)
    }

    @Test
    fun `fromMap defaults isMuted to false when missing`() {
        val seat = Seat.fromMap(emptyMap())
        assertFalse(seat.isMuted)
    }

    @Test
    fun `fromMap handles empty map with all defaults`() {
        val seat = Seat.fromMap(emptyMap())
        assertNull(seat.userId)
        assertEquals(SeatState.EMPTY, seat.state)
        assertFalse(seat.isMuted)
    }

    @Test
    fun `toMap produces correct map`() {
        val seat = Seat(userId = "user-1", state = SeatState.OCCUPIED, isMuted = true)
        val map = seat.toMap()
        assertEquals("user-1", map["userId"])
        assertEquals("OCCUPIED", map["state"])
        assertEquals(true, map["isMuted"])
    }
}
