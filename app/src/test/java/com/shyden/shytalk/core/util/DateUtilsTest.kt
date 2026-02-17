package com.shyden.shytalk.core.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

class DateUtilsTest {

    @Test
    fun `calculateAge returns correct age for past birthday this year`() {
        val today = Calendar.getInstance()
        val birth = Calendar.getInstance().apply {
            set(Calendar.YEAR, today.get(Calendar.YEAR) - 25)
            set(Calendar.MONTH, Calendar.JANUARY)
            set(Calendar.DAY_OF_MONTH, 1)
        }
        val age = calculateAge(birth.timeInMillis)
        // If today is after Jan 1, age is 25; if today IS Jan 1, still 25
        assertTrue(age >= 25)
    }

    @Test
    fun `calculateAge returns correct age for future birthday this year`() {
        val today = Calendar.getInstance()
        val birth = Calendar.getInstance().apply {
            set(Calendar.YEAR, today.get(Calendar.YEAR) - 20)
            set(Calendar.MONTH, Calendar.DECEMBER)
            set(Calendar.DAY_OF_MONTH, 31)
        }
        val age = calculateAge(birth.timeInMillis)
        // Birthday hasn't happened yet this year (unless today is Dec 31)
        if (today.get(Calendar.MONTH) == Calendar.DECEMBER && today.get(Calendar.DAY_OF_MONTH) == 31) {
            assertEquals(20, age)
        } else {
            assertEquals(19, age)
        }
    }

    @Test
    fun `calculateAge for today returns 0`() {
        val age = calculateAge(System.currentTimeMillis())
        assertEquals(0, age)
    }

    @Test
    fun `isAtLeast13 returns true for 13 year old`() {
        val cal = Calendar.getInstance().apply {
            add(Calendar.YEAR, -13)
            add(Calendar.DAY_OF_YEAR, -1) // One day past 13th birthday
        }
        assertTrue(isAtLeast13(cal.timeInMillis))
    }

    @Test
    fun `isAtLeast13 returns true for 25 year old`() {
        val cal = Calendar.getInstance().apply {
            add(Calendar.YEAR, -25)
        }
        assertTrue(isAtLeast13(cal.timeInMillis))
    }

    @Test
    fun `isAtLeast13 returns false for 12 year old`() {
        val cal = Calendar.getInstance().apply {
            add(Calendar.YEAR, -12)
        }
        assertFalse(isAtLeast13(cal.timeInMillis))
    }

    @Test
    fun `isAtLeast13 returns false for baby`() {
        val cal = Calendar.getInstance().apply {
            add(Calendar.YEAR, -1)
        }
        assertFalse(isAtLeast13(cal.timeInMillis))
    }

    // ===== formatRelativeTime =====

    @Test
    fun `formatRelativeTime - just now for less than 1 minute ago`() {
        val ts = System.currentTimeMillis() - 30_000L // 30 seconds ago
        assertEquals("just now", formatRelativeTime(ts))
    }

    @Test
    fun `formatRelativeTime - singular minute`() {
        val ts = System.currentTimeMillis() - 90_000L // 1.5 minutes ago
        assertEquals("1 min ago", formatRelativeTime(ts))
    }

    @Test
    fun `formatRelativeTime - plural minutes`() {
        val ts = System.currentTimeMillis() - 5 * 60_000L // 5 minutes ago
        assertEquals("5 mins ago", formatRelativeTime(ts))
    }

    @Test
    fun `formatRelativeTime - singular hour`() {
        val ts = System.currentTimeMillis() - 90 * 60_000L // 1.5 hours ago
        assertEquals("1 hour ago", formatRelativeTime(ts))
    }

    @Test
    fun `formatRelativeTime - plural hours`() {
        val ts = System.currentTimeMillis() - 5 * 3600_000L // 5 hours ago
        assertEquals("5 hours ago", formatRelativeTime(ts))
    }

    @Test
    fun `formatRelativeTime - singular day`() {
        val ts = System.currentTimeMillis() - 36 * 3600_000L // 1.5 days ago
        assertEquals("1 day ago", formatRelativeTime(ts))
    }

    @Test
    fun `formatRelativeTime - plural days`() {
        val ts = System.currentTimeMillis() - 3 * 24 * 3600_000L // 3 days ago
        assertEquals("3 days ago", formatRelativeTime(ts))
    }
}
