package com.shyden.shytalk.core.util

import kotlinx.datetime.Instant
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime

@OptIn(kotlin.time.ExperimentalTime::class)
fun calculateAge(dateOfBirthMillis: Long): Int {
    val tz = TimeZone.currentSystemDefault()
    val today = Instant.fromEpochMilliseconds(currentTimeMillis()).toLocalDateTime(tz).date
    val birth = Instant.fromEpochMilliseconds(dateOfBirthMillis).toLocalDateTime(tz).date
    var age = today.year - birth.year
    if (today.monthNumber < birth.monthNumber ||
        (today.monthNumber == birth.monthNumber && today.dayOfMonth < birth.dayOfMonth)
    ) {
        age--
    }
    return age
}

fun isAtLeast13(dateOfBirthMillis: Long): Boolean {
    return calculateAge(dateOfBirthMillis) >= 13
}

fun formatRelativeTime(timestampMs: Long): String {
    val diffMs = currentTimeMillis() - timestampMs
    val minutes = diffMs / 60_000
    val hours = minutes / 60
    val days = hours / 24
    return when {
        minutes < 1 -> "just now"
        minutes < 60 -> "$minutes min${if (minutes != 1L) "s" else ""} ago"
        hours < 24 -> "$hours hour${if (hours != 1L) "s" else ""} ago"
        else -> "$days day${if (days != 1L) "s" else ""} ago"
    }
}

fun formatDateForDisplay(millis: Long): String {
    val tz = TimeZone.currentSystemDefault()
    val date = Instant.fromEpochMilliseconds(millis).toLocalDateTime(tz).date
    val month = date.month.name.lowercase().replaceFirstChar { it.uppercase() }.take(3)
    return "$month ${date.dayOfMonth.toString().padStart(2, '0')}, ${date.year}"
}
