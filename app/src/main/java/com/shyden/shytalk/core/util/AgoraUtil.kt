package com.shyden.shytalk.core.util

/**
 * Derives a positive Agora UID from a user ID string.
 * Agora requires a non-negative 32-bit integer UID.
 */
fun String.toAgoraUid(): Int = hashCode() and 0x7FFFFFFF
