package com.shyden.shytalk.core.util

import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class MapExtTest {
    // ── Type-drift logger swap (saved + restored per test) ──────────
    private val capturedDrifts = mutableListOf<Pair<String, Boolean>>()
    private var savedLogger: ((String, Boolean) -> Unit)? = null

    @BeforeTest
    fun installCapturingLogger() {
        savedLogger = asBoolTypeDriftLogger
        capturedDrifts.clear()
        asBoolTypeDriftLogger = { typeName, default ->
            capturedDrifts += typeName to default
        }
    }

    @AfterTest
    fun restoreLogger() {
        savedLogger?.let { asBoolTypeDriftLogger = it }
    }

    // ── Boolean values ──────────────────────────────────────────────

    @Test
    fun `asBool returns true for Boolean true`() {
        val value: Any? = true
        assertTrue(value.asBool())
    }

    @Test
    fun `asBool returns false for Boolean false`() {
        val value: Any? = false
        assertFalse(value.asBool())
    }

    // ── Number values ───────────────────────────────────────────────

    @Test
    fun `asBool returns true for Int 1`() {
        val value: Any? = 1
        assertTrue(value.asBool())
    }

    @Test
    fun `asBool returns false for Int 0`() {
        val value: Any? = 0
        assertFalse(value.asBool())
    }

    @Test
    fun `asBool returns true for Long 1`() {
        val value: Any? = 1L
        assertTrue(value.asBool())
    }

    @Test
    fun `asBool returns false for Long 0`() {
        val value: Any? = 0L
        assertFalse(value.asBool())
    }

    @Test
    fun `asBool returns true for negative number`() {
        val value: Any? = -1
        assertTrue(value.asBool())
    }

    @Test
    fun `asBool returns true for large number`() {
        val value: Any? = 42
        assertTrue(value.asBool())
    }

    @Test
    fun `asBool returns true for Double 1_0`() {
        val value: Any? = 1.0
        assertTrue(value.asBool())
    }

    @Test
    fun `asBool returns false for Double 0_0`() {
        val value: Any? = 0.0
        assertFalse(value.asBool())
    }

    @Test
    fun `asBool returns true for Float 1_0f`() {
        val value: Any? = 1.0f
        assertTrue(value.asBool())
    }

    @Test
    fun `asBool returns false for Float 0_0f`() {
        val value: Any? = 0.0f
        assertFalse(value.asBool())
    }

    // ── Null and other types ────────────────────────────────────────

    @Test
    fun `asBool returns default false for null`() {
        val value: Any? = null
        assertFalse(value.asBool())
    }

    @Test
    fun `asBool returns custom default for null`() {
        val value: Any? = null
        assertTrue(value.asBool(default = true))
    }

    @Test
    fun `asBool returns default for String`() {
        val value: Any? = "true"
        assertFalse(value.asBool())
    }

    @Test
    fun `asBool returns custom default true for String`() {
        val value: Any? = "anything"
        assertTrue(value.asBool(default = true))
    }

    @Test
    fun `asBool returns default for list`() {
        val value: Any? = listOf(1, 2, 3)
        assertFalse(value.asBool())
    }

    @Test
    fun `asBool returns default for map`() {
        val value: Any? = mapOf("key" to "val")
        assertFalse(value.asBool())
    }

    // ── Default parameter ───────────────────────────────────────────

    @Test
    fun `asBool default parameter is false by default`() {
        val value: Any? = null
        assertFalse(value.asBool())
    }

    @Test
    fun `asBool with default true returns true for null`() {
        assertTrue(null.asBool(true))
    }

    @Test
    fun `asBool with default true returns true for unrecognized type`() {
        val value: Any? = object {}
        assertTrue(value.asBool(true))
    }

    @Test
    fun `asBool ignores default when value is Boolean`() {
        val value: Any? = false
        assertFalse(value.asBool(default = true))
    }

    @Test
    fun `asBool ignores default when value is Number`() {
        val value: Any? = 0
        assertFalse(value.asBool(default = true))
    }

    // ── Type-drift logging (security-critical) ──────────────────────
    //
    // Many call sites read security-sensitive flags (`isSuspended`,
    // `suspensionCanAppeal`, `ageVerified`, `pmLocked`) via this
    // helper. Silent fallback to `default` when Firestore returns a
    // String or other unexpected shape would let a corrupted/migrated
    // doc bypass a gate without anyone noticing. The drift logger
    // turns that into a visible signal so we can investigate.

    @Test
    fun `asBool with String value invokes type-drift logger`() {
        val value: Any? = "true"
        value.asBool()
        assertEquals(1, capturedDrifts.size)
        assertEquals("String", capturedDrifts[0].first)
    }

    @Test
    fun `asBool with List value invokes type-drift logger`() {
        val value: Any? = listOf(1, 2, 3)
        value.asBool()
        assertEquals(1, capturedDrifts.size)
    }

    @Test
    fun `asBool with Map value invokes type-drift logger`() {
        val value: Any? = mapOf("k" to "v")
        value.asBool()
        assertEquals(1, capturedDrifts.size)
    }

    @Test
    fun `asBool with arbitrary object invokes type-drift logger`() {
        val value: Any? = object {}
        value.asBool()
        assertEquals(1, capturedDrifts.size)
    }

    @Test
    fun `asBool drift logger receives the default value passed by caller`() {
        val value: Any? = "yes"
        value.asBool(default = true)
        assertEquals(1, capturedDrifts.size)
        assertEquals(true, capturedDrifts[0].second)

        capturedDrifts.clear()
        value.asBool(default = false)
        assertEquals(1, capturedDrifts.size)
        assertEquals(false, capturedDrifts[0].second)
    }

    @Test
    fun `asBool with Boolean does NOT invoke type-drift logger`() {
        true.asBool()
        false.asBool()
        assertTrue(capturedDrifts.isEmpty())
    }

    @Test
    fun `asBool with Number does NOT invoke type-drift logger`() {
        (1).asBool()
        (0L).asBool()
        (1.0).asBool()
        (0.0f).asBool()
        assertTrue(capturedDrifts.isEmpty())
    }

    @Test
    fun `asBool with null does NOT invoke type-drift logger`() {
        // Null is field-absent, not type drift — common and benign.
        val value: Any? = null
        value.asBool()
        assertTrue(capturedDrifts.isEmpty())
    }
}
