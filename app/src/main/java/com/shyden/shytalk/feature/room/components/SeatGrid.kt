package com.shyden.shytalk.feature.room.components

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.ui.Alignment
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.Seat
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.toAgoraUid

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SeatGrid(
    seats: Map<String, Seat>,
    currentUserId: String,
    currentRole: RoomRole,
    ownerId: String,
    hostIds: Set<String>,
    speakingUids: Set<Int>,
    seatUsers: Map<String, User> = emptyMap(),
    onSeatClick: (Int) -> Unit,
    onTapUser: (String) -> Unit = {},
    modifier: Modifier = Modifier
) {
    val occupiedSeats = remember(seats) {
        seats.entries
            .filter { it.value.state == SeatState.OCCUPIED }
            .sortedBy { it.key.toIntOrNull() ?: 0 }
    }

    val targetSeatSize = when (occupiedSeats.size) {
        1    -> 200.dp
        2    -> 140.dp
        3    -> 110.dp
        4    ->  80.dp
        5    ->  76.dp
        6    ->  72.dp
        else ->  70.dp
    }

    val seatSize by animateDpAsState(
        targetValue = targetSeatSize,
        animationSpec = tween(durationMillis = 300),
        label = "seatSize"
    )

    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center
    ) {
        FlowRow(
            modifier = Modifier.fillMaxWidth().wrapContentHeight(),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalArrangement = Arrangement.spacedBy(12.dp),
            maxItemsInEachRow = 4
        ) {
            occupiedSeats.forEach { (indexStr, seat) ->
                val seatIndex = indexStr.toIntOrNull() ?: return@forEach
                val seatUserId = seat.userId

                val seatRole = when {
                    seatUserId == ownerId -> RoomRole.OWNER
                    seatUserId != null && seatUserId in hostIds -> RoomRole.HOST
                    else -> RoomRole.ATTENDEE
                }

                val isSpeaking = seatUserId != null &&
                    seatUserId.toAgoraUid() in speakingUids

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
                    isSpeaking = isSpeaking,
                    user = seatUser,
                    seatSize = seatSize,
                    onClick = { onSeatClick(seatIndex) },
                    onTapUser = seatUserId?.let { uid -> { onTapUser(uid) } },
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}
