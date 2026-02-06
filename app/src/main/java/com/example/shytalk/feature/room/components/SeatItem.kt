package com.example.shytalk.feature.room.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.example.shytalk.core.model.RoomRole
import com.example.shytalk.core.model.Seat
import com.example.shytalk.core.model.SeatState

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SeatItem(
    seatIndex: Int,
    seat: Seat,
    seatRole: RoomRole,
    isCurrentUser: Boolean,
    canRemove: Boolean,
    canMute: Boolean,
    canKick: Boolean,
    canMove: Boolean,
    emptySeats: List<Int>,
    isSpeaking: Boolean,
    onClick: () -> Unit,
    onRemove: () -> Unit,
    onToggleSelfMute: () -> Unit,
    onForceMute: () -> Unit,
    onKick: () -> Unit,
    onMoveTo: (toIndex: Int) -> Unit,
    modifier: Modifier = Modifier
) {
    var showMenu by remember { mutableStateOf(false) }
    var showMoveDialog by remember { mutableStateOf(false) }

    val hasModActions = canRemove || canMute || canKick || canMove

    // Speaking animation
    val infiniteTransition = rememberInfiniteTransition(label = "speaking")
    val speakingScale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1.15f,
        animationSpec = infiniteRepeatable(
            animation = tween(400),
            repeatMode = RepeatMode.Reverse
        ),
        label = "speakingScale"
    )

    val borderColor by animateColorAsState(
        targetValue = when {
            isSpeaking -> Color(0xFF4CAF50) // Green for speaking
            seatRole == RoomRole.OWNER -> MaterialTheme.colorScheme.primary
            seatRole == RoomRole.HOST -> MaterialTheme.colorScheme.tertiary
            else -> Color.Transparent
        },
        label = "borderColor"
    )

    Column(
        modifier = modifier.padding(4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(contentAlignment = Alignment.Center) {
            Surface(
                modifier = Modifier
                    .size(56.dp)
                    .then(
                        if (isSpeaking) Modifier.scale(speakingScale) else Modifier
                    )
                    .then(
                        if (borderColor != Color.Transparent) {
                            Modifier.border(
                                width = if (isSpeaking) 3.dp else 2.dp,
                                color = borderColor,
                                shape = CircleShape
                            )
                        } else {
                            Modifier
                        }
                    )
                    .combinedClickable(
                        onClick = onClick,
                        onLongClick = {
                            if (hasModActions || isCurrentUser) {
                                showMenu = true
                            }
                        }
                    ),
                shape = CircleShape,
                color = if (seat.state == SeatState.OCCUPIED) {
                    MaterialTheme.colorScheme.primaryContainer
                } else {
                    MaterialTheme.colorScheme.surfaceVariant
                }
            ) {
                Icon(
                    imageVector = if (seat.state == SeatState.OCCUPIED) {
                        Icons.Default.Person
                    } else {
                        Icons.Default.PersonAdd
                    },
                    contentDescription = if (seat.state == SeatState.OCCUPIED) "Occupied" else "Empty seat",
                    modifier = Modifier.padding(14.dp),
                    tint = if (seat.state == SeatState.OCCUPIED) {
                        MaterialTheme.colorScheme.onPrimaryContainer
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    }
                )
            }

            // Role indicator badge
            if (seat.state == SeatState.OCCUPIED && seatRole != RoomRole.ATTENDEE) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .size(18.dp)
                        .clip(CircleShape)
                        .background(
                            if (seatRole == RoomRole.OWNER) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.tertiary
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Default.Star,
                        contentDescription = seatRole.name,
                        modifier = Modifier.size(12.dp),
                        tint = MaterialTheme.colorScheme.onPrimary
                    )
                }
            }

            // Mute indicator
            if (seat.state == SeatState.OCCUPIED && seat.isMuted) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .size(18.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.error),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Default.MicOff,
                        contentDescription = "Muted",
                        modifier = Modifier.size(12.dp),
                        tint = MaterialTheme.colorScheme.onError
                    )
                }
            }

            // Context menu
            DropdownMenu(
                expanded = showMenu,
                onDismissRequest = { showMenu = false }
            ) {
                // Self actions
                if (isCurrentUser) {
                    DropdownMenuItem(
                        text = { Text("Leave seat") },
                        onClick = {
                            showMenu = false
                            onClick()
                        }
                    )
                    DropdownMenuItem(
                        text = { Text(if (seat.isMuted) "Unmute" else "Mute") },
                        onClick = {
                            showMenu = false
                            onToggleSelfMute()
                        }
                    )
                }
                // Moderation actions on normal users
                if (canMute) {
                    DropdownMenuItem(
                        text = { Text(if (seat.isMuted) "Unmute user" else "Mute user") },
                        onClick = {
                            showMenu = false
                            onForceMute()
                        }
                    )
                }
                if (canMove) {
                    DropdownMenuItem(
                        text = { Text("Move to seat\u2026") },
                        onClick = {
                            showMenu = false
                            showMoveDialog = true
                        }
                    )
                }
                if (canRemove) {
                    DropdownMenuItem(
                        text = { Text("Remove from seat") },
                        onClick = {
                            showMenu = false
                            onRemove()
                        }
                    )
                }
                if (canKick) {
                    DropdownMenuItem(
                        text = { Text("Kick from room") },
                        onClick = {
                            showMenu = false
                            onKick()
                        }
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(4.dp))

        Text(
            text = "Seat ${seatIndex + 1}",
            style = MaterialTheme.typography.labelSmall,
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }

    // Move-to-seat picker dialog
    if (showMoveDialog) {
        AlertDialog(
            onDismissRequest = { showMoveDialog = false },
            title = { Text("Move to which seat?") },
            text = {
                Column {
                    emptySeats.forEach { targetIndex ->
                        TextButton(onClick = {
                            showMoveDialog = false
                            onMoveTo(targetIndex)
                        }) {
                            Text("Seat ${targetIndex + 1}")
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { showMoveDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }
}
