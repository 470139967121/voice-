package com.shyden.shytalk.core.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ModerationFilterTest {

    @Before
    fun setup() {
        ModerationFilter.reset()
        ModerationFilter.updateProhibitedWords(emptyList())
    }

    // ===== checkMessage =====

    @Test
    fun `checkMessage returns null for clean text`() {
        ModerationFilter.updateProhibitedWords(listOf("badword"))
        assertNull(ModerationFilter.checkMessage("This is a clean message"))
    }

    @Test
    fun `checkMessage returns warning for prohibited word`() {
        ModerationFilter.updateProhibitedWords(listOf("badword"))
        val result = ModerationFilter.checkMessage("This contains badword here")
        assertNotNull(result)
        assertTrue(result!!.contains("inappropriate"))
    }

    @Test
    fun `checkMessage is case-insensitive`() {
        ModerationFilter.updateProhibitedWords(listOf("badword"))
        assertNotNull(ModerationFilter.checkMessage("This has BADWORD"))
        assertNotNull(ModerationFilter.checkMessage("This has BadWord"))
    }

    @Test
    fun `checkMessage detects substring match`() {
        ModerationFilter.updateProhibitedWords(listOf("bad"))
        assertNotNull(ModerationFilter.checkMessage("This is badness"))
    }

    @Test
    fun `checkMessage returns null when words are cleared`() {
        ModerationFilter.updateProhibitedWords(listOf("badword"))
        assertNotNull(ModerationFilter.checkMessage("badword"))

        ModerationFilter.updateProhibitedWords(emptyList())
        assertNull(ModerationFilter.checkMessage("badword"))
    }

    @Test
    fun `checkMessage returns null with empty prohibited list`() {
        assertNull(ModerationFilter.checkMessage("Any text at all"))
    }

    @Test
    fun `checkMessage detects multiple prohibited words`() {
        ModerationFilter.updateProhibitedWords(listOf("bad", "evil"))
        assertNotNull(ModerationFilter.checkMessage("This is evil"))
        assertNotNull(ModerationFilter.checkMessage("This is bad"))
    }

    // ===== isSpam =====

    @Test
    fun `isSpam first message is not spam`() {
        assertFalse(ModerationFilter.isSpam("Hello"))
    }

    @Test
    fun `isSpam second identical message is not spam`() {
        assertFalse(ModerationFilter.isSpam("Hello"))
        assertFalse(ModerationFilter.isSpam("Hello"))
    }

    @Test
    fun `isSpam third identical message triggers spam`() {
        assertFalse(ModerationFilter.isSpam("Hello"))
        assertFalse(ModerationFilter.isSpam("Hello"))
        assertTrue(ModerationFilter.isSpam("Hello"))
    }

    @Test
    fun `isSpam different messages are not spam`() {
        assertFalse(ModerationFilter.isSpam("Hello"))
        assertFalse(ModerationFilter.isSpam("World"))
        assertFalse(ModerationFilter.isSpam("Foo"))
    }

    @Test
    fun `isSpam reset clears state`() {
        assertFalse(ModerationFilter.isSpam("Hello"))
        assertFalse(ModerationFilter.isSpam("Hello"))
        ModerationFilter.reset()
        // After reset, same message should not be considered spam
        assertFalse(ModerationFilter.isSpam("Hello"))
        assertFalse(ModerationFilter.isSpam("Hello"))
    }
}
