package com.example.shytalk.feature.room.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.shytalk.core.model.RoomRole
import com.example.shytalk.core.model.Seat
import com.example.shytalk.core.model.SeatState
import com.example.shytalk.core.model.User
import com.example.shytalk.core.util.Constants

@Composable
fun SeatGrid(
    seats: Map<String, Seat>,
    currentUserId: String,
    currentRole: RoomRole,
    ownerId: String,
    hostIds: List<String>,
    speakingUids: Set<Int>,
    seatUsers: Map<String, User> = emptyMap(),
    onSeatClick: (Int) -> Unit,
    onRemoveFromSeat: (Int) -> Unit,
    onToggleSelfMute: (Int) -> Unit,
    onForceMute: (Int) -> Unit,
    onKickUser: (Int) -> Unit,
    onMoveSeat: (fromIndex: Int, toIndex: Int) -> Unit,
    onTapUser: (String) -> Unit = {},
    modifier: Modifier = Modifier
) {
    // Collect empty seat indices for the move dialog
    val emptySeats = seats.entries
        .filter { it.value.state != SeatState.OCCUPIED && it.key.toInt() != Constants.OWNER_SEAT_INDEX }
        .map { it.key.toInt() }

    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        for (row in 0..1) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                for (col in 0..3) {
                    val seatIndex = row * 4 + col
                    val seat = seats[seatIndex.toString()] ?: Seat()
                    val seatUserId = seat.userId

                    val seatRole = when {
                        seatUserId == ownerId -> RoomRole.OWNER
                        seatUserId != null && seatUserId in hostIds -> RoomRole.HOST
                        else -> RoomRole.ATTENDEE
                    }

                    val isTargetNormalUser = seat.userId != null
                        && seat.userId != currentUserId
                        && seatRole == RoomRole.ATTENDEE

                    val canModerate = when {
                        !isTargetNormalUser -> false
                        currentRole == RoomRole.OWNER -> true
                        currentRole == RoomRole.HOST -> true
                        else -> false
                    }

                    // Check if this seat's user is speaking via Agora UID
                    val isSpeaking = seatUserId != null &&
                        (seatUserId.hashCode() and 0x7FFFFFFF) in speakingUids

                    val isOwnerOnOwnSeat = seat.userId == currentUserId
                        && seatIndex == Constants.OWNER_SEAT_INDEX
                        && currentRole == RoomRole.OWNER

                    val seatUser = seatUserId?.let { seatUsers[it] }

                    SeatItem(
                        seatIndex = seatIndex,
                        seat = seat,
                        seatRole = seatRole,
                        isCurrentUser = seat.userId == currentUserId,
                        canLeaveSeat = seat.userId == currentUserId && !isOwnerOnOwnSeat,
                        canRemove = canModerate && seatIndex != Constants.OWNER_SEAT_INDEX,
                        canMute = canModerate,
                        canKick = canModerate,
                        canMove = canModerate && emptySeats.isNotEmpty() && seatIndex != Constants.OWNER_SEAT_INDEX,
                        emptySeats = emptySeats,
                        isSpeaking = isSpeaking,
                        user = seatUser,
                        onClick = { onSeatClick(seatIndex) },
                        onRemove = { onRemoveFromSeat(seatIndex) },
                        onToggleSelfMute = { onToggleSelfMute(seatIndex) },
                        onForceMute = { onForceMute(seatIndex) },
                        onKick = { onKickUser(seatIndex) },
                        onMoveTo = { toIndex -> onMoveSeat(seatIndex, toIndex) },
                        onTapUser = seatUserId?.let { uid -> { onTapUser(uid) } },
                        modifier = Modifier.weight(1f)
                    )
                }
            }
        }
    }
}
