package com.shyden.shytalk.feature.room

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material3.Icon
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.feature.room.components.ChatPanel
import com.shyden.shytalk.feature.room.components.OwnerAwayBanner
import com.shyden.shytalk.feature.room.components.ParticipantInfo
import com.shyden.shytalk.feature.room.components.ParticipantListPanel
import com.shyden.shytalk.feature.room.components.RoomClosedSummaryPanel
import com.shyden.shytalk.feature.room.components.RoomNotificationOverlay
import com.shyden.shytalk.feature.room.components.RoomToolbar
import com.shyden.shytalk.feature.room.components.SeatGrid
import com.shyden.shytalk.feature.room.components.UserCardPopup
import com.shyden.shytalk.feature.settings.RoomSettingsSheet

@Composable
fun RoomScreen(
    roomId: String,
    onNavigateBack: () -> Unit,
    onNavigateToUserProfile: (String) -> Unit = {},
    viewModel: RoomViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var showSettings by remember { mutableStateOf(false) }
    var showUserCardForId by remember { mutableStateOf<String?>(null) }
    var showParticipantPanel by remember { mutableStateOf(false) }
    var showRoomNameDialog by remember { mutableStateOf(false) }

    // Track room screen visibility for chathead
    DisposableEffect(Unit) {
        viewModel.setRoomScreenVisible(true)
        onDispose { viewModel.setRoomScreenVisible(false) }
    }

    // Audio permission handling
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        viewModel.onAudioPermissionResult(granted)
        if (!granted) {
            scope.launch {
                snackbarHostState.showSnackbar("Microphone permission denied. You won't be able to use voice chat.")
            }
        }
    }

    LaunchedEffect(Unit) {
        val already = ContextCompat.checkSelfPermission(
            context, Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
        if (already) {
            viewModel.onAudioPermissionResult(true)
        } else {
            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    // System back navigates back without leaving the room (voice persists)
    BackHandler(enabled = !showParticipantPanel && uiState.hasJoined) {
        onNavigateBack()
    }

    BackHandler(enabled = showParticipantPanel) {
        showParticipantPanel = false
    }

    // Show kicked dialog
    if (uiState.wasKicked) {
        AlertDialog(
            onDismissRequest = {},
            title = { Text("Removed from Room") },
            text = {
                Column {
                    if (uiState.kickedByName != null) {
                        Text("You were kicked by ${uiState.kickedByName}.")
                    } else {
                        Text("You have been kicked from this room.")
                    }
                    if (uiState.kickReason != null) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = "Reason: ${uiState.kickReason}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { onNavigateBack() }) {
                    Text("OK")
                }
            }
        )
    }

    LaunchedEffect(uiState.shouldNavigateBack) {
        if (uiState.shouldNavigateBack) {
            onNavigateBack()
        }
    }

    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    // Block warning dialogs
    uiState.blockWarning?.let { warning ->
        when (warning) {
            is BlockWarning.BlockedByRoomOwner -> {
                AlertDialog(
                    onDismissRequest = {},
                    title = { Text("Cannot Enter Room") },
                    text = {
                        Text("You are not allowed to enter this room.")
                    },
                    confirmButton = {
                        TextButton(onClick = { onNavigateBack() }) {
                            Text("Go Back")
                        }
                    }
                )
            }
            is BlockWarning.BlockedUserInRoom -> {
                AlertDialog(
                    onDismissRequest = {},
                    title = { Text("Blocked User in Room") },
                    text = {
                        Text("A user you have blocked is in this room. They will be able to communicate with you. Enter anyway?")
                    },
                    confirmButton = {
                        TextButton(onClick = { viewModel.confirmJoinDespiteBlock() }) {
                            Text("Enter")
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = { onNavigateBack() }) {
                            Text("Choose Another Room")
                        }
                    }
                )
            }
            is BlockWarning.BlockedByUserInRoom -> {
                AlertDialog(
                    onDismissRequest = {},
                    title = { Text("Notice") },
                    text = {
                        Text("A user in this room has blocked you. You may have a limited experience. Enter anyway?")
                    },
                    confirmButton = {
                        TextButton(onClick = { viewModel.confirmJoinDespiteBlock() }) {
                            Text("Enter")
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = { onNavigateBack() }) {
                            Text("Choose Another Room")
                        }
                    }
                )
            }
        }
    }

    // Compute participant lists for the panel (memoized to avoid recomposition waste)
    val room = uiState.room
    val participantUsers = uiState.participantUsers

    val seatedUserIds = remember(room) {
        room?.seats?.values
            ?.filter { it.state == SeatState.OCCUPIED && it.userId != null }
            ?.mapNotNull { it.userId }
            ?.toSet() ?: emptySet()
    }

    val voiceUsers by remember(room, participantUsers, seatedUserIds) {
        derivedStateOf {
            val r = room ?: return@derivedStateOf emptyList<ParticipantInfo>()
            seatedUserIds.mapNotNull { uid ->
                participantUsers[uid]?.let { user ->
                    val seat = r.seats.values.find { it.userId == uid }
                    ParticipantInfo(user, r.resolveRole(uid), isMuted = seat?.isMuted ?: false)
                }
            }.sortedWith(
                compareBy<ParticipantInfo> { it.role.ordinal }
                    .thenBy { it.user.displayName.lowercase() }
            )
        }
    }

    val audienceUsers by remember(room, participantUsers, seatedUserIds) {
        derivedStateOf {
            val r = room ?: return@derivedStateOf emptyList<ParticipantInfo>()
            r.participantIds
                .filter { it !in seatedUserIds }
                .mapNotNull { uid ->
                    participantUsers[uid]?.let { user ->
                        ParticipantInfo(user, r.resolveRole(uid))
                    }
                }
                .sortedWith(
                    compareBy<ParticipantInfo> { it.role.ordinal }
                        .thenBy { it.user.displayName.lowercase() }
                )
        }
    }

    // Merged user map for ChatPanel (memoized)
    val userMap = remember(uiState.seatUsers, uiState.participantUsers) {
        uiState.seatUsers + uiState.participantUsers
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            RoomToolbar(
                roomName = uiState.room?.name ?: "Room",
                participantCount = uiState.room?.participantIds?.size ?: 0,
                roomExpiryRemainingMs = uiState.roomExpiryRemainingMs,
                onBack = { onNavigateBack() },
                onTogglePeople = { showParticipantPanel = !showParticipantPanel },
                onRoomNameClick = { showRoomNameDialog = true }
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            val closedSummary = uiState.roomClosedSummary
            if (uiState.roomClosed && closedSummary != null) {
                RoomClosedSummaryPanel(
                    summary = closedSummary,
                    onDismiss = onNavigateBack
                )
            } else if (uiState.roomClosed) {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Text(
                        text = "Room Closed",
                        style = MaterialTheme.typography.headlineMedium
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "This room is no longer available.",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(24.dp))
                    Button(onClick = onNavigateBack) {
                        Text("Back to Home")
                    }
                }
            } else if (uiState.isLoading) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            } else if (!uiState.hasJoined && uiState.blockWarning == null) {
                // Loading state while block check is in progress
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            } else if (uiState.hasJoined) {
                Column(modifier = Modifier.fillMaxSize()) {
                    // Owner Away Banner
                    if (uiState.room?.state == RoomState.OWNER_AWAY) {
                        OwnerAwayBanner(
                            remainingMs = uiState.ownerAwayRemainingMs
                        )
                    }

                    // Seat Grid (upper portion — only occupied seats)
                    SeatGrid(
                        seats = uiState.room?.seats ?: emptyMap(),
                        currentUserId = uiState.currentUserId,
                        currentRole = uiState.currentRole,
                        ownerId = uiState.room?.ownerId ?: "",
                        hostIds = uiState.room?.hostIds ?: emptySet(),
                        speakingUids = uiState.speakingUids,
                        seatUsers = uiState.seatUsers,
                        onSeatClick = { seatIndex ->
                            val seat = uiState.room?.seats?.get(seatIndex.toString())
                            if (seat?.userId == uiState.currentUserId) {
                                viewModel.leaveSeat(seatIndex)
                            } else if (seat?.userId == null) {
                                viewModel.takeSeat(seatIndex)
                            }
                        },
                        onTapUser = { userId ->
                            showUserCardForId = userId
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f)
                            .padding(horizontal = 12.dp, vertical = 8.dp)
                    )

                    // "Take a Seat" button when not seated and empty seats exist
                    val isSeated = remember(uiState.room?.seats, uiState.currentUserId) {
                        uiState.room?.seats?.values?.any {
                            it.isOccupiedBy(uiState.currentUserId)
                        } ?: false
                    }

                    val hasEmptySeats = remember(uiState.room?.seats) {
                        uiState.room?.seats?.values?.any {
                            it.state != SeatState.OCCUPIED
                        } ?: false
                    }

                    if (!isSeated && hasEmptySeats) {
                        OutlinedButton(
                            onClick = {
                                // Find first empty non-owner seat
                                val emptySeatIndex = (1 until Constants.MAX_SEATS).firstOrNull { i ->
                                    val seat = uiState.room?.seats?.get(i.toString())
                                    seat != null && seat.state != SeatState.OCCUPIED
                                }
                                if (emptySeatIndex != null) {
                                    viewModel.takeSeat(emptySeatIndex)
                                }
                            },
                            modifier = Modifier.padding(horizontal = 16.dp)
                        ) {
                            Icon(
                                Icons.Default.PersonAdd,
                                contentDescription = null,
                                modifier = Modifier.padding(end = 8.dp)
                            )
                            Text("Take a Seat")
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                    }

                    HorizontalDivider()

                    // Chat Panel (lower portion)
                    ChatPanel(
                        messages = uiState.messages,
                        currentUserId = uiState.currentUserId,
                        currentRole = uiState.currentRole,
                        seats = uiState.room?.seats ?: emptyMap(),
                        userMap = userMap,
                        isOwnerOrHost = uiState.currentRole == RoomRole.OWNER || uiState.currentRole == RoomRole.HOST,
                        onToggleMic = { seatIndex -> viewModel.toggleSelfMute(seatIndex) },
                        onSendMessage = { viewModel.sendMessage(it) },
                        onTapUser = { userId ->
                            showUserCardForId = userId
                        },
                        onInviteUser = { senderId, senderName ->
                            viewModel.inviteFromMessage(senderId, senderName)
                        },
                        onSettings = { showSettings = true },
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f)
                    )
                }
            }

            // Center-screen notification overlay
            RoomNotificationOverlay(
                notification = uiState.activeNotification,
                onApproveSeatRequest = { viewModel.approveRequestFromNotification(it) },
                onDenySeatRequest = { viewModel.denyRequestFromNotification(it) },
                onAcceptApprovedRequest = { viewModel.acceptApprovedRequest(it) },
                onDeclineApprovedRequest = { viewModel.declineApprovedRequest(it) },
                onAcceptInvite = { viewModel.acceptInvite() },
                onDeclineInvite = { viewModel.declineInvite() },
                modifier = Modifier.align(Alignment.Center)
            )

            // Scrim overlay
            if (showParticipantPanel) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.4f))
                        .clickable(
                            indication = null,
                            interactionSource = remember { MutableInteractionSource() }
                        ) { showParticipantPanel = false }
                )
            }

            // Sliding participant panel from right
            AnimatedVisibility(
                visible = showParticipantPanel,
                enter = slideInHorizontally(
                    initialOffsetX = { fullWidth -> fullWidth },
                    animationSpec = tween(300)
                ),
                exit = slideOutHorizontally(
                    targetOffsetX = { fullWidth -> fullWidth },
                    animationSpec = tween(300)
                ),
                modifier = Modifier.align(Alignment.CenterEnd)
            ) {
                ParticipantListPanel(
                    voiceUsers = voiceUsers,
                    audienceUsers = audienceUsers,
                    pendingRequests = uiState.pendingRequestsForPanel,
                    pendingInviteUserIds = uiState.room?.pendingInvites?.keys ?: emptySet(),
                    isOwnerOrHost = uiState.currentRole == RoomRole.OWNER || uiState.currentRole == RoomRole.HOST,
                    onUserClick = { userId ->
                        showParticipantPanel = false
                        showUserCardForId = userId
                    },
                    onApproveRequest = { viewModel.approveRequestFromNotification(it) },
                    onDenyRequest = { viewModel.denyRequestFromNotification(it) },
                    onInviteUser = { userId, userName ->
                        viewModel.inviteUser(userId, userName)
                    },
                    onDismiss = { showParticipantPanel = false },
                    modifier = Modifier
                        .fillMaxHeight()
                        .fillMaxWidth(0.7f)
                )
            }
        }

        if (showSettings && uiState.room != null) {
            RoomSettingsSheet(
                roomId = roomId,
                onDismiss = { showSettings = false },
                onCloseRoom = {
                    showSettings = false
                    viewModel.closeRoom()
                }
            )
        }

        if (showRoomNameDialog && uiState.room != null) {
            val isOwner = uiState.currentRole == RoomRole.OWNER
            if (isOwner) {
                var editedName by remember { mutableStateOf(uiState.room?.name ?: "") }
                AlertDialog(
                    onDismissRequest = { showRoomNameDialog = false },
                    title = { Text("Edit Room Name") },
                    text = {
                        OutlinedTextField(
                            value = editedName,
                            onValueChange = { if (it.length <= 50) editedName = it },
                            singleLine = true,
                            placeholder = { Text("Room name") }
                        )
                    },
                    confirmButton = {
                        TextButton(onClick = {
                            val trimmed = editedName.trim()
                            if (trimmed.isNotEmpty()) {
                                viewModel.updateRoomName(trimmed)
                            }
                            showRoomNameDialog = false
                        }) {
                            Text("Save")
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = { showRoomNameDialog = false }) {
                            Text("Cancel")
                        }
                    }
                )
            } else {
                AlertDialog(
                    onDismissRequest = { showRoomNameDialog = false },
                    title = { Text("Room Name") },
                    text = {
                        Text(
                            text = uiState.room?.name ?: "",
                            style = MaterialTheme.typography.bodyLarge
                        )
                    },
                    confirmButton = {
                        TextButton(onClick = { showRoomNameDialog = false }) {
                            Text("Close")
                        }
                    }
                )
            }
        }

        val emptySeats = remember(uiState.room?.seats) {
            uiState.room?.seats?.entries
                ?.filter { it.value.state != SeatState.OCCUPIED && it.key.toInt() != Constants.OWNER_SEAT_INDEX }
                ?.map { it.key.toInt() } ?: emptyList()
        }

        // User card popup when tapping a user
        showUserCardForId?.let { userId ->
            val user = uiState.seatUsers[userId] ?: uiState.participantUsers[userId]
            if (user != null) {
                val targetSeatEntry = uiState.room?.seats?.entries?.find {
                    it.value.isOccupiedBy(userId)
                }
                val isTargetSeated = targetSeatEntry != null
                val targetSeatIndex = targetSeatEntry?.key?.toIntOrNull()

                val targetRole = uiState.room?.resolveRole(userId) ?: RoomRole.ATTENDEE

                val canInviteFromCard = (uiState.currentRole == RoomRole.OWNER || uiState.currentRole == RoomRole.HOST)
                        && userId != uiState.currentUserId
                        && !isTargetSeated

                // Mod capabilities: owner can act on hosts + attendees; hosts can act on attendees only
                val isNotSelf = userId != uiState.currentUserId
                val isOwner = uiState.currentRole == RoomRole.OWNER
                val isHostOrOwner = isOwner || uiState.currentRole == RoomRole.HOST
                val canModerate = isNotSelf && isTargetSeated && isHostOrOwner
                    && (isOwner || targetRole == RoomRole.ATTENDEE)
                    && userId != uiState.room?.ownerId

                UserCardPopup(
                    user = user,
                    isBlocked = userId in uiState.blockedUserIds,
                    isSelf = userId == uiState.currentUserId,
                    onViewProfile = {
                        showUserCardForId = null
                        onNavigateToUserProfile(userId)
                    },
                    onBlock = {
                        viewModel.blockUser(userId)
                        showUserCardForId = null
                    },
                    onUnblock = {
                        viewModel.unblockUser(userId)
                        showUserCardForId = null
                    },
                    onInvite = if (canInviteFromCard) {
                        {
                            viewModel.inviteFromMessage(userId, user.displayName)
                            showUserCardForId = null
                        }
                    } else null,
                    onMuteToggle = if (canModerate && targetSeatIndex != null) {
                        { viewModel.forceMuteUser(targetSeatIndex) }
                    } else null,
                    isTargetMuted = targetSeatEntry?.value?.isMuted ?: false,
                    onRemoveFromSeat = if (canModerate && targetSeatIndex != null
                        && targetSeatIndex != Constants.OWNER_SEAT_INDEX) {
                        { viewModel.removeFromSeat(targetSeatIndex) }
                    } else null,
                    onKickFromRoom = if (canModerate && targetSeatIndex != null) {
                        { reason -> viewModel.kickUser(targetSeatIndex, reason) }
                    } else null,
                    onMoveSeat = if (canModerate && targetSeatIndex != null && emptySeats.isNotEmpty()
                        && targetSeatIndex != Constants.OWNER_SEAT_INDEX) {
                        { toIndex -> viewModel.moveSeat(targetSeatIndex, toIndex) }
                    } else null,
                    emptySeats = emptySeats,
                    onMakeHost = if (isOwner && isNotSelf && isTargetSeated
                        && targetRole == RoomRole.ATTENDEE) {
                        { viewModel.addHost(userId) }
                    } else null,
                    onRemoveHost = if (isOwner && isNotSelf && targetRole == RoomRole.HOST) {
                        { viewModel.removeHost(userId) }
                    } else null,
                    isHost = targetRole == RoomRole.HOST,
                    onDismiss = { showUserCardForId = null }
                )
            }
        }
    }
}
