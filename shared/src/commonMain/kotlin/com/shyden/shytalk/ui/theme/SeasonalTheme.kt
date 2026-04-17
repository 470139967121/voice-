package com.shyden.shytalk.ui.theme

import androidx.compose.ui.graphics.Color
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Clock

data class SeasonalEvent(
    val slug: String,
    val name: String,
    val startMonth: Int,
    val startDay: Int,
    val endMonth: Int,
    val endDay: Int,
    val primaryColor: Color,
    val accentColor: Color,
)

object SeasonalTheme {
    private val events =
        listOf(
            SeasonalEvent(
                slug = "khmer-new-year-2026",
                name = "Khmer New Year 2026",
                startMonth = 4,
                startDay = 13,
                endMonth = 4,
                endDay = 17, // exclusive — event runs April 13-16 inclusive
                primaryColor = Color(0xFFD4A017),
                accentColor = Color(0xFFE67E22),
            ),
        )

    /**
     * Check if a seasonal event is active for the given date.
     * Used directly for testability (avoids mocking system clock).
     */
    fun activeEventForDate(
        year: Int,
        month: Int,
        day: Int,
    ): SeasonalEvent? {
        val dayOfYear = dayOfYear(month, day)
        return events.firstOrNull { event ->
            val start = dayOfYear(event.startMonth, event.startDay)
            val end = dayOfYear(event.endMonth, event.endDay)
            dayOfYear in start until end
        }
    }

    /**
     * Check if a seasonal event is active right now.
     * Returns null when no event is active — the default theme should be used.
     */
    fun activeEvent(): SeasonalEvent? {
        val now =
            Clock.System
                .now()
                .toLocalDateTime(TimeZone.currentSystemDefault())
                .date
        return activeEventForDate(now.year, now.month.ordinal + 1, now.day)
    }

    private fun dayOfYear(
        month: Int,
        day: Int,
    ): Int {
        val daysBeforeMonth = intArrayOf(0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334)
        return daysBeforeMonth[month - 1] + day
    }
}
