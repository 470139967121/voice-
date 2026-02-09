package com.shyden.shytalk.core.model

data class Seat(
    val userId: String? = null,
    val state: SeatState = SeatState.EMPTY,
    val isMuted: Boolean = false
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "userId" to userId,
        "state" to state.name,
        "isMuted" to isMuted
    )

    companion object {
        fun fromMap(map: Map<String, Any?>): Seat = Seat(
            userId = map["userId"] as? String,
            state = (map["state"] as? String)?.let {
                try { SeatState.valueOf(it) } catch (_: Exception) { SeatState.EMPTY }
            } ?: SeatState.EMPTY,
            isMuted = map["isMuted"] as? Boolean ?: false
        )
    }
}
