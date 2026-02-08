package com.example.shytalk.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PersonRemove
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.shytalk.core.model.SeatState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomSettingsSheet(
    roomId: String,
    onDismiss: () -> Unit,
    onCloseRoom: () -> Unit,
    viewModel: RoomSettingsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    LaunchedEffect(roomId) {
        viewModel.loadRoom(roomId)
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Text(
                text = "Room Settings",
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.padding(bottom = 16.dp)
            )

            // Lock Seating Toggle
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Lock Seating",
                        style = MaterialTheme.typography.bodyLarge
                    )
                    Text(
                        text = "Only the owner can invite users to sit",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Switch(
                    checked = uiState.room?.requireApproval ?: false,
                    onCheckedChange = { viewModel.toggleRequireApproval() }
                )
            }

            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(16.dp))

            // Hosts Management (owner only)
            val room = uiState.room
            val isOwner = room != null && viewModel.currentUserId == room.ownerId

            if (isOwner) {
                Text(
                    text = "Hosts",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(bottom = 8.dp)
                )

                val hostIds = room.hostIds
                if (hostIds.isEmpty()) {
                    Text(
                        text = "No hosts assigned",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                } else {
                    hostIds.forEach { hostId ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = hostId,
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.weight(1f)
                            )
                            IconButton(onClick = { viewModel.removeHost(hostId) }) {
                                Icon(
                                    Icons.Default.PersonRemove,
                                    contentDescription = "Remove host",
                                    tint = MaterialTheme.colorScheme.error
                                )
                            }
                        }
                    }
                }

                // Show seated attendees who can be promoted to host
                val seatedAttendees = room.seats.values.filter { seat ->
                    seat.state == SeatState.OCCUPIED &&
                    seat.userId != null &&
                    seat.userId != room.ownerId &&
                    seat.userId !in room.hostIds
                }
                if (seatedAttendees.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Promote to Host",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    seatedAttendees.forEach { seat ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = seat.userId ?: "",
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.weight(1f)
                            )
                            Button(onClick = { seat.userId?.let { viewModel.addHost(it) } }) {
                                Text("Make Host")
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))
                HorizontalDivider()
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Invite to Seat section
            // Owner can always invite; hosts can invite when requireApproval is OFF
            val canInvite = room != null && (
                isOwner || (viewModel.currentUserId in (room.hostIds) && !room.requireApproval)
            )
            if (canInvite) {
                val nonSeatedParticipants = room.participantIds.filter { pid ->
                    pid != room.ownerId &&
                    pid !in room.pendingInvites &&
                    room.seats.values.none { it.userId == pid && it.state == SeatState.OCCUPIED }
                }
                if (nonSeatedParticipants.isNotEmpty()) {
                    Text(
                        text = "Invite to Seat",
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )
                    nonSeatedParticipants.forEach { userId ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = userId,
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.weight(1f)
                            )
                            Button(onClick = { viewModel.inviteUser(userId, userId) }) {
                                Text("Invite")
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(16.dp))
                    HorizontalDivider()
                    Spacer(modifier = Modifier.height(16.dp))
                }
            }

            // Pending Seat Requests
            // When requireApproval is ON, only owner can see approve/deny
            // When OFF, owner + hosts can see approve/deny
            val canApprove = room != null && (
                isOwner || (viewModel.currentUserId in (room.hostIds) && !room.requireApproval)
            )

            if (canApprove) {
                Text(
                    text = "Pending Seat Requests (${uiState.pendingRequests.size})",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(bottom = 8.dp)
                )

                if (uiState.pendingRequests.isEmpty()) {
                    Text(
                        text = "No pending requests",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                } else {
                    LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.height(200.dp)
                    ) {
                        items(uiState.pendingRequests, key = { it.requestId }) { request ->
                            Card(modifier = Modifier.fillMaxWidth()) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(12.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = request.userName,
                                            style = MaterialTheme.typography.bodyMedium
                                        )
                                        Text(
                                            text = "Seat ${request.seatIndex + 1}",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                    IconButton(onClick = { viewModel.approveRequest(request) }) {
                                        Icon(
                                            Icons.Default.Check,
                                            contentDescription = "Approve",
                                            tint = MaterialTheme.colorScheme.primary
                                        )
                                    }
                                    IconButton(onClick = { viewModel.denyRequest(request) }) {
                                        Icon(
                                            Icons.Default.Close,
                                            contentDescription = "Deny",
                                            tint = MaterialTheme.colorScheme.error
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Close Room Button (owner only)
            if (isOwner) {
                Button(
                    onClick = onCloseRoom,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error
                    ),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Close Room")
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}
