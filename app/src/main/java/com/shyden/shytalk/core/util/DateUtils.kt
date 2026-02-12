package com.shyden.shytalk.core.util

import com.google.firebase.Timestamp
import java.util.Calendar
import java.util.Date

fun calculateAge(dateOfBirth: Timestamp): Int {
    val today = Calendar.getInstance()
    val birth = Calendar.getInstance().apply { time = dateOfBirth.toDate() }
    var age = today.get(Calendar.YEAR) - birth.get(Calendar.YEAR)
    val todayMonth = today.get(Calendar.MONTH)
    val birthMonth = birth.get(Calendar.MONTH)
    if (todayMonth < birthMonth ||
        (todayMonth == birthMonth && today.get(Calendar.DAY_OF_MONTH) < birth.get(Calendar.DAY_OF_MONTH))
    ) {
        age--
    }
    return age
}

fun isAtLeast13(dateOfBirthMillis: Long): Boolean {
    return calculateAge(Timestamp(Date(dateOfBirthMillis))) >= 13
}
