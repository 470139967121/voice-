package com.example.shytalk.feature.room.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomToolbar(
    roomName: String,
    participantCount: Int,
    isOwnerOrHost: Boolean,
    onBack: () -> Unit,
    onSettings: () -> Unit,
    onTogglePeople: () -> Unit
) {
    TopAppBar(
        title = {
            Text(
                text = "$roomName ($participantCount)",
                style = MaterialTheme.typography.titleMedium
            )
        },
        navigationIcon = {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Leave room")
            }
        },
        actions = {
            IconButton(onClick = onTogglePeople) {
                Icon(Icons.Default.People, contentDescription = "Participants")
            }
            if (isOwnerOrHost) {
                IconButton(onClick = onSettings) {
                    Icon(Icons.Default.Settings, contentDescription = "Room settings")
                }
            }
        }
    )
}
