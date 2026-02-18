package com.shyden.shytalk.core.util

object Constants {
    const val MAX_SEATS = 8
    const val OWNER_LEAVE_TIMEOUT_MS = 300_000L // 5 minutes
    const val OWNER_SEAT_INDEX = 0
    const val VOICE_DISCONNECT_GRACE_PERIOD_MS = 15_000L // 15 seconds
    const val PRESENCE_TIMEOUT_MS = 15_000L // 15 seconds
    const val ROOM_NOTIFICATION_ID = 1001
    const val ROOM_NOTIFICATION_CHANNEL_ID = "room_service_channel"
    const val MAX_ROOM_DURATION_MS = 3 * 60 * 60 * 1000L // 3 hours
    const val ROOM_EXPIRY_COUNTDOWN_THRESHOLD_MS = 300_000L // 5 minutes before expiry
    const val ACTIVE_ROOMS_QUERY_LIMIT = 100L

    // Seat request notification timing
    const val SEAT_REQUEST_AUTO_DISMISS_MS = 3000L
    const val SEAT_REQUEST_IMMEDIATE_THRESHOLD_MS = 5000L

    // Online status
    const val ONLINE_THRESHOLD_MS = 300_000L // 5 minutes

    // Chat messages
    const val MAX_ROOM_MESSAGES = 50

    // Message flood protection
    const val FLOOD_COOLDOWN_MS = 1_000L       // 1 second between messages
    const val FLOOD_WINDOW_MS = 10_000L        // 10 second sliding window
    const val FLOOD_MAX_MESSAGES = 5           // max 5 messages per window

    // Profile stalkers
    const val STALKER_EXPIRY_MS = 90L * 24 * 60 * 60 * 1000 // 3 months

    // Private messaging
    const val PM_NOTIFICATION_CHANNEL_ID = "pm_notification_channel"
    const val MAX_PM_MESSAGE_LENGTH = 2000
    const val PM_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024L // 5 MB
    const val PM_MAX_IMAGES_PER_MESSAGE = 10
    const val PM_MESSAGES_PAGE_SIZE = 50
    const val PM_EDIT_WINDOW_MS = 900_000L // 15 minutes
    const val TYPING_DEBOUNCE_MS = 5_000L // 5 seconds

    // PM flood protection
    const val PM_FLOOD_COOLDOWN_MS = 1_000L
    const val PM_FLOOD_WINDOW_MS = 10_000L
    const val PM_FLOOD_MAX_MESSAGES = 5
}
