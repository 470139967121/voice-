package com.shyden.shytalk.core.util

/** Returns the current time in epoch milliseconds. */
expect fun currentTimeMillis(): Long

/**
 * Converts a platform-specific timestamp value (e.g. Firebase Timestamp) to epoch millis.
 * Falls back to [currentTimeMillis] if the value is null or unrecognized.
 */
expect fun timestampToMillis(value: Any?): Long

/**
 * Converts epoch millis to a platform-native timestamp object for Firestore writes.
 * On Android this returns a Firebase Timestamp; on iOS a Firebase FIRTimestamp.
 */
expect fun millisToTimestamp(millis: Long): Any

/** Returns the platform-native "now" timestamp for Firestore writes. */
expect fun nowTimestamp(): Any
