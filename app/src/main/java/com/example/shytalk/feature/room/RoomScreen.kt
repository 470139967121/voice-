package com.example.shytalk.feature.room

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.shytalk.core.model.RoomRole
import com.example.shytalk.core.model.RoomState
import com.example.shytalk.feature.room.components.ChatPanel
import com.example.shytalk.feature.room.components.OwnerAwayBanner
import com.example.shytalk.feature.room.components.RoomToolbar
import com.example.shytalk.feature.room.components.SeatGrid
import com.example.shytalk.feature.settings.RoomSettingsSheet

@Composable
fun RoomScreen(
    roomId: String,
    onNavigateBack: () -> Unit,
    viewModel: RoomViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var showSettings by remember { mutableStateOf(false) }

    LaunchedEffect(uiState.roomClosed) {
        if (uiState.roomClosed) {
            snackbarHostState.showSnackbar("Room has been closed")
            onNavigateBack()
        }
    }

    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            RoomToolbar(
                roomName = uiState.room?.name ?: "Room",
                participantCount = uiState.room?.participantIds?.size ?: 0,
                isOwnerOrHost = uiState.currentRole == RoomRole.OWNER || uiState.currentRole == RoomRole.HOST,
                onBack = {
                    viewModel.leaveRoom()
                    onNavigateBack()
                },
                onSettings = { showSettings = true }
            )
        }
    ) { padding ->
        if (uiState.isLoading) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
            ) {
                // Owner Away Banner
                if (uiState.room?.state == RoomState.OWNER_AWAY) {
                    OwnerAwayBanner(
                        remainingMs = uiState.ownerAwayRemainingMs,
                        isOwner = uiState.currentRole == RoomRole.OWNER,
                        onOwnerReturn = { viewModel.ownerReturn() }
                    )
                }

                // Seat Grid (upper portion)
                SeatGrid(
                    seats = uiState.room?.seats ?: emptyMap(),
                    currentUserId = uiState.currentUserId,
                    currentRole = uiState.currentRole,
                    ownerId = uiState.room?.ownerId ?: "",
                    hostIds = uiState.room?.hostIds ?: emptyList(),
                    speakingUids = uiState.speakingUids,
                    onSeatClick = { seatIndex ->
                        val seat = uiState.room?.seats?.get(seatIndex.toString())
                        if (seat?.userId == uiState.currentUserId) {
                            viewModel.leaveSeat(seatIndex)
                        } else if (seat?.userId == null) {
                            viewModel.takeSeat(seatIndex)
                        }
                    },
                    onRemoveFromSeat = { seatIndex ->
                        viewModel.removeFromSeat(seatIndex)
                    },
                    onToggleSelfMute = { seatIndex ->
                        viewModel.toggleSelfMute(seatIndex)
                    },
                    onForceMute = { seatIndex ->
                        viewModel.forceMuteUser(seatIndex)
                    },
                    onKickUser = { seatIndex ->
                        viewModel.kickUser(seatIndex)
                    },
                    onMoveSeat = { fromIndex, toIndex ->
                        viewModel.moveSeat(fromIndex, toIndex)
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp)
                )

                HorizontalDivider()

                // Chat Panel (lower portion)
                ChatPanel(
                    messages = uiState.messages,
                    currentUserId = uiState.currentUserId,
                    onSendMessage = { viewModel.sendMessage(it) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                )
            }
        }

        if (showSettings && uiState.room != null) {
            RoomSettingsSheet(
                roomId = roomId,
                onDismiss = { showSettings = false }
            )
        }
    }
}
