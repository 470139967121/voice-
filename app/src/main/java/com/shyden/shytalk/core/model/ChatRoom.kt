package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.Constants
import com.google.firebase.Timestamp

data class ChatRoom(
    val roomId: String = "",
    val name: String = "",
    val ownerId: String = "",
    val state: RoomState = RoomState.ACTIVE,
    val ownerLeftAt: Timestamp? = null,
    val createdAt: Timestamp = Timestamp.now(),
    val closedAt: Timestamp? = null,
    val participantIds: Set<String> = emptySet(),
    val hostIds: Set<String> = emptySet(),
    val requireApproval: Boolean = false,
    val bannedUserIds: Set<String> = emptySet(),
    val kickInfo: Map<String, Map<String, String>> = emptyMap(),
    val pendingInvites: Map<String, String> = emptyMap(),
    val seats: Map<String, Seat> = DEFAULT_SEATS,
    val agoraChannelName: String = "",
    val firstJoinTimestamps: Map<String, Timestamp> = emptyMap()
) {
    fun resolveRole(userId: String): RoomRole = when {
        ownerId == userId -> RoomRole.OWNER
        userId in hostIds -> RoomRole.HOST
        else -> RoomRole.ATTENDEE
    }

    /** Finds the seat entry occupied by the given user, or null if not seated. */
    fun findUserSeat(userId: String): Map.Entry<String, Seat>? =
        seats.entries.find { it.value.isOccupiedBy(userId) }

    fun toMap(): Map<String, Any?> = mapOf(
        "roomId" to roomId,
        "name" to name,
        "ownerId" to ownerId,
        "state" to state.name,
        "ownerLeftAt" to ownerLeftAt,
        "createdAt" to createdAt,
        "closedAt" to closedAt,
        "participantIds" to participantIds.toList(),
        "hostIds" to hostIds.toList(),
        "requireApproval" to requireApproval,
        "bannedUserIds" to bannedUserIds.toList(),
        "kickInfo" to kickInfo,
        "pendingInvites" to pendingInvites,
        "seats" to seats.mapValues { it.value.toMap() },
        "agoraChannelName" to agoraChannelName,
        "firstJoinTimestamps" to firstJoinTimestamps
    )

    companion object {
        val DEFAULT_SEATS: Map<String, Seat> =
            (0 until Constants.MAX_SEATS).associate { it.toString() to Seat() }

        fun fromMap(map: Map<String, Any?>, roomId: String): ChatRoom {
            val seatsRaw = (map["seats"] as? Map<*, *>) ?: emptyMap<String, Any>()
            val seats = (0 until Constants.MAX_SEATS).associate { i ->
                val key = i.toString()
                val seatMap = (seatsRaw[key] as? Map<*, *>)?.let { raw ->
                    raw.entries.associate { (k, v) -> k.toString() to v }
                } ?: emptyMap()
                key to Seat.fromMap(seatMap)
            }

            return ChatRoom(
                roomId = roomId,
                name = map["name"] as? String ?: "",
                ownerId = map["ownerId"] as? String ?: "",
                state = (map["state"] as? String)?.let {
                    try { RoomState.valueOf(it) } catch (_: Exception) { RoomState.ACTIVE }
                } ?: RoomState.ACTIVE,
                ownerLeftAt = map["ownerLeftAt"] as? Timestamp,
                createdAt = map["createdAt"] as? Timestamp ?: Timestamp.now(),
                closedAt = map["closedAt"] as? Timestamp,
                participantIds = (map["participantIds"] as? List<*>)?.filterIsInstance<String>()?.toSet() ?: emptySet(),
                hostIds = (map["hostIds"] as? List<*>)?.filterIsInstance<String>()?.toSet() ?: emptySet(),
                requireApproval = map["requireApproval"] as? Boolean ?: false,
                bannedUserIds = (map["bannedUserIds"] as? List<*>)?.filterIsInstance<String>()?.toSet() ?: emptySet(),
                kickInfo = (map["kickInfo"] as? Map<*, *>)?.entries?.associate { entry ->
                    entry.key.toString() to ((entry.value as? Map<*, *>)?.entries?.associate {
                        it.key.toString() to (it.value as? String ?: "")
                    } ?: emptyMap())
                } ?: emptyMap(),
                pendingInvites = (map["pendingInvites"] as? Map<*, *>)?.entries?.associate {
                    it.key.toString() to (it.value as? String ?: "")
                } ?: emptyMap(),
                seats = seats,
                agoraChannelName = map["agoraChannelName"] as? String ?: "",
                firstJoinTimestamps = (map["firstJoinTimestamps"] as? Map<*, *>)?.entries?.associate {
                    it.key.toString() to (it.value as? Timestamp ?: Timestamp.now())
                } ?: emptyMap()
            )
        }
    }
}
