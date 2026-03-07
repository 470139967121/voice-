package com.shyden.shytalk.data.remote

import com.shyden.shytalk.core.util.TraceManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkerApiClientTraceTest {
    @Test
    fun `TraceManager sessionTraceId is available for header injection`() {
        val traceId = TraceManager.sessionTraceId
        assertNotNull(traceId)
        assertTrue(traceId.isNotEmpty())
        // Verify it's a valid UUID
        val uuidRegex = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
        assertTrue(uuidRegex.matches(traceId))
    }

    @Test
    fun `TraceManager returns consistent ID across calls`() {
        val id1 = TraceManager.sessionTraceId
        val id2 = TraceManager.sessionTraceId
        assertEquals(id1, id2)
    }
}
