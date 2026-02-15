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

fun formatDateForDisplay(millis: Long): String {
    val tz = TimeZone.currentSystemDefault()
    val date = Instant.fromEpochMilliseconds(millis).toLocalDateTime(tz).date
    val month = date.month.name.lowercase().replaceFirstChar { it.uppercase() }.take(3)
    return "$month ${date.dayOfMonth.toString().padStart(2, '0')}, ${date.year}"
}
