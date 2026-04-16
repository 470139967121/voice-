package com.shyden.shytalk.ui.theme

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class SeasonalThemeTest {
    @Test
    fun `activeEvent returns KhmerNewYear during April 13-16`() {
        val event = SeasonalTheme.activeEventForDate(2026, 4, 14)
        assertNotNull(event)
        assertEquals("khmer-new-year-2026", event.slug)
    }

    @Test
    fun `activeEvent returns null outside event dates`() {
        val event = SeasonalTheme.activeEventForDate(2026, 1, 15)
        assertNull(event)
    }

    @Test
    fun `activeEvent returns null on end date (exclusive)`() {
        val event = SeasonalTheme.activeEventForDate(2026, 4, 17)
        assertNull(event)
    }

    @Test
    fun `activeEvent returns event on start date (inclusive)`() {
        val event = SeasonalTheme.activeEventForDate(2026, 4, 13)
        assertNotNull(event)
        assertEquals("khmer-new-year-2026", event.slug)
    }

    @Test
    fun `activeEvent returns event on last day (April 16)`() {
        val event = SeasonalTheme.activeEventForDate(2026, 4, 16)
        assertNotNull(event)
    }

    @Test
    fun `activeEvent returns null day before start`() {
        val event = SeasonalTheme.activeEventForDate(2026, 4, 12)
        assertNull(event)
    }
}
