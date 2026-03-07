package com.shyden.shytalk.core.util

import org.junit.Assert.*
import org.junit.Test

class TraceManagerTest {
    @Test
    fun `generates non-empty sessionTraceId`() {
        val traceId = TraceManager.sessionTraceId
        assertNotNull(traceId)
        assertTrue(traceId.isNotEmpty())
    }

    @Test
    fun `returns same traceId within session`() {
        val id1 = TraceManager.sessionTraceId
        val id2 = TraceManager.sessionTraceId
        assertEquals(id1, id2)
    }

    @Test
    fun `traceId follows UUID format`() {
        val traceId = TraceManager.sessionTraceId
        // UUID format: 8-4-4-4-12 hex chars
        val uuidRegex = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
        assertTrue("TraceId should be UUID format: $traceId", uuidRegex.matches(traceId))
    }
}
