package com.shyden.shytalk.feature.main

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MeetingRoom
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.shyden.shytalk.feature.home.RoomListContent
import com.shyden.shytalk.feature.profile.ProfileScreen

enum class BottomNavTab(val label: String) {
    Rooms("Rooms"),
    Profile("Profile")
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(
    onNavigateToRoom: (String) -> Unit,
    onNavigateToUserProfile: (String) -> Unit,
    onSignOut: () -> Unit
) {
    var selectedTab by remember { mutableStateOf(BottomNavTab.Rooms) }
    var showCreateDialog by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        when (selectedTab) {
                            BottomNavTab.Rooms -> "ShyTalk"
                            BottomNavTab.Profile -> "Profile"
                        }
                    )
                }
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = selectedTab == BottomNavTab.Rooms,
                    onClick = { selectedTab = BottomNavTab.Rooms },
                    icon = { Icon(Icons.Default.MeetingRoom, contentDescription = null) },
                    label = { Text("Rooms") }
                )
                NavigationBarItem(
                    selected = selectedTab == BottomNavTab.Profile,
                    onClick = { selectedTab = BottomNavTab.Profile },
                    icon = { Icon(Icons.Default.Person, contentDescription = null) },
                    label = { Text("Profile") }
                )
            }
        },
        floatingActionButton = {
            if (selectedTab == BottomNavTab.Rooms) {
                FloatingActionButton(onClick = { showCreateDialog = true }) {
                    Icon(Icons.Default.Add, contentDescription = "Create Room")
                }
            }
        }
    ) { padding ->
        when (selectedTab) {
            BottomNavTab.Rooms -> {
                RoomListContent(
                    onNavigateToRoom = onNavigateToRoom,
                    snackbarHostState = snackbarHostState,
                    showCreateDialog = showCreateDialog,
                    onDismissCreateDialog = { showCreateDialog = false },
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding)
                )
            }
            BottomNavTab.Profile -> {
                ProfileScreen(
                    userId = null,
                    showBackButton = false,
                    onNavigateBack = {},
                    onSignOut = onSignOut,
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding)
                )
            }
        }
    }
}
