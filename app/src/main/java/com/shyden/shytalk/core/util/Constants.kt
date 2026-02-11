package com.shyden.shytalk.core.util

object Constants {
    const val MAX_SEATS = 8
    const val OWNER_LEAVE_TIMEOUT_MS = 300_000L // 5 minutes
    const val OWNER_SEAT_INDEX = 0
    const val AGORA_DISCONNECT_GRACE_PERIOD_MS = 30_000L // 30 seconds
    const val PRESENCE_TIMEOUT_MS = 30_000L // 30 seconds
    const val ROOM_NOTIFICATION_ID = 1001
    const val ROOM_NOTIFICATION_CHANNEL_ID = "room_service_channel"
    const val ACTIVE_ROOMS_QUERY_LIMIT = 100L

    // Seat request notification timing
    const val SEAT_REQUEST_AUTO_DISMISS_MS = 3000L
    const val SEAT_REQUEST_IMMEDIATE_THRESHOLD_MS = 5000L

    // Agora voice settings
    const val AGORA_SPEAKING_VOLUME_THRESHOLD = 50  // local mic (raw capture)
    const val AGORA_REMOTE_SPEAKING_THRESHOLD = 10  // remote (decoded playback)
    const val AGORA_RECORDING_SIGNAL_VOLUME = 400
    const val AGORA_VOLUME_INDICATION_INTERVAL_MS = 300
    const val AGORA_VOLUME_INDICATION_SMOOTH = 3
}
