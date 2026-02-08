package com.example.shytalk.feature.home

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import coil.compose.AsyncImage
import com.example.shytalk.core.model.ChatRoom
import com.example.shytalk.core.model.SeatState
import com.example.shytalk.core.model.User
import com.example.shytalk.core.util.flagEmojiForCode

@Composable
fun RoomListItem(
    room: ChatRoom,
    seatUsers: Map<String, User>,
    onClick: () -> Unit
) {
    val occupiedSeats = room.seats.values.count { it.state == SeatState.OCCUPIED }
    val totalSeats = room.seats.size

    // Build ordered list of seated users: owner first (seat 0), then others
    val seatedUserList = buildList {
        // Owner seat first
        room.seats["0"]?.let { seat ->
            if (seat.state == SeatState.OCCUPIED && seat.userId != null) {
                seatUsers[seat.userId]?.let { add(it) }
            }
        }
        // Then remaining seats in order
        for (i in 1 until totalSeats) {
            room.seats[i.toString()]?.let { seat ->
                if (seat.state == SeatState.OCCUPIED && seat.userId != null) {
                    seatUsers[seat.userId]?.let { add(it) }
                }
            }
        }
    }

    // Collect unique nationality flags from seated users
    val nationalityFlags = seatedUserList
        .mapNotNull { it.nationality }
        .distinct()
        .map { flagEmojiForCode(it) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .clickable(onClick = onClick)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp)
        ) {
            // Avatar stack row
            if (seatedUserList.isNotEmpty()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(44.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box {
                        seatedUserList.forEachIndexed { index, user ->
                            val photoUrl = user.profilePhotoUrl ?: user.avatarUrl
                            Box(
                                modifier = Modifier
                                    .offset(x = (index * 28).dp)
                                    .zIndex((seatedUserList.size - index).toFloat())
                            ) {
                                if (photoUrl != null) {
                                    AsyncImage(
                                        model = photoUrl,
                                        contentDescription = user.displayName,
                                        modifier = Modifier
                                            .size(36.dp)
                                            .clip(CircleShape)
                                            .border(
                                                2.dp,
                                                MaterialTheme.colorScheme.surface,
                                                CircleShape
                                            ),
                                        contentScale = ContentScale.Crop
                                    )
                                } else {
                                    Surface(
                                        modifier = Modifier
                                            .size(36.dp)
                                            .border(
                                                2.dp,
                                                MaterialTheme.colorScheme.surface,
                                                CircleShape
                                            ),
                                        shape = CircleShape,
                                        color = MaterialTheme.colorScheme.primaryContainer
                                    ) {
                                        Icon(
                                            Icons.Default.Person,
                                            contentDescription = user.displayName,
                                            modifier = Modifier.padding(8.dp),
                                            tint = MaterialTheme.colorScheme.onPrimaryContainer
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
                Spacer(modifier = Modifier.height(8.dp))
            }

            // Room info row
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = room.name,
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(
                        text = "$occupiedSeats/$totalSeats seats",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        text = "${room.participantIds.size} in room",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary
                    )
                    if (nationalityFlags.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(2.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                            nationalityFlags.take(6).forEach { flag ->
                                Text(
                                    text = flag,
                                    style = MaterialTheme.typography.labelSmall
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
