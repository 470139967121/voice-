package com.shyden.shytalk

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.rememberNavController
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.room.ActiveRoomManager
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import com.shyden.shytalk.feature.privacy.PrivacyPolicyScreen
import com.shyden.shytalk.feature.update.ForceUpdateScreen
import com.shyden.shytalk.navigation.NavGraph
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.ui.theme.ShyTalkTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.tasks.await
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var authRepository: AuthRepository

    @Inject
    lateinit var userRepository: UserRepository

    @Inject
    lateinit var activeRoomManager: ActiveRoomManager

    private val _navigateToRoom = mutableStateOf<String?>(null)

    companion object {
        private const val PREFS_NAME = "shytalk_prefs"
        private const val KEY_PRIVACY_ACCEPTED = "privacy_policy_accepted"
        private const val KEY_OVERLAY_PERMISSION_ASKED = "overlay_permission_asked"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)

        setContent {
            ShyTalkTheme {
                var privacyAccepted by remember {
                    mutableStateOf(prefs.getBoolean(KEY_PRIVACY_ACCEPTED, false))
                }
                var updateRequired by remember { mutableStateOf(false) }
                var checkComplete by remember { mutableStateOf(false) }
                var showOverlayDialog by remember { mutableStateOf(false) }

                LaunchedEffect(Unit) {
                    try {
                        val doc = FirebaseFirestore.getInstance()
                            .collection("config")
                            .document("app")
                            .get()
                            .await()
                        val minVersion = (doc.getLong("minVersionCode") ?: 0).toInt()
                        updateRequired = BuildConfig.VERSION_CODE < minVersion
                    } catch (_: Exception) {
                        updateRequired = false
                    }
                    checkComplete = true
                }

                // Prompt for overlay permission when entering a room
                val activeRoomId by activeRoomManager.activeRoomId.collectAsStateWithLifecycle()
                LaunchedEffect(activeRoomId) {
                    if (activeRoomId != null &&
                        !Settings.canDrawOverlays(this@MainActivity) &&
                        !prefs.getBoolean(KEY_OVERLAY_PERMISSION_ASKED, false)
                    ) {
                        showOverlayDialog = true
                        prefs.edit().putBoolean(KEY_OVERLAY_PERMISSION_ASKED, true).apply()
                    }
                }

                if (showOverlayDialog) {
                    AlertDialog(
                        onDismissRequest = { showOverlayDialog = false },
                        title = { Text("Display over other apps") },
                        text = { Text("Allow ShyTalk to show a floating bubble when you leave a voice room, so you can quickly return.") },
                        confirmButton = {
                            TextButton(onClick = {
                                showOverlayDialog = false
                                startActivity(
                                    Intent(
                                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                        Uri.parse("package:$packageName")
                                    )
                                )
                            }) {
                                Text("Allow")
                            }
                        },
                        dismissButton = {
                            TextButton(onClick = { showOverlayDialog = false }) {
                                Text("Not now")
                            }
                        }
                    )
                }

                when {
                    // Privacy policy must be accepted first
                    !privacyAccepted -> {
                        PrivacyPolicyScreen(
                            onAccept = {
                                prefs.edit().putBoolean(KEY_PRIVACY_ACCEPTED, true).apply()
                                privacyAccepted = true
                            },
                            onDecline = {
                                finishAffinity()
                            }
                        )
                    }
                    // Normal app flow
                    checkComplete -> {
                        if (updateRequired) {
                            ForceUpdateScreen()
                        } else {
                            val navController = rememberNavController()
                            val navigateToRoomId by _navigateToRoom

                            LaunchedEffect(navigateToRoomId) {
                                val roomId = navigateToRoomId
                                if (roomId != null) {
                                    navController.navigate(Screen.Room.createRoute(roomId)) {
                                        launchSingleTop = true
                                    }
                                    _navigateToRoom.value = null
                                }
                            }

                            NavGraph(
                                navController = navController,
                                startDestination = Screen.GoogleSignIn.route,
                                onSignOut = { authRepository.signOut() }
                            )
                        }
                    }
                }
            }
        }

        // Handle notification tap to open room (cold start)
        handleRoomIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        activeRoomManager.isAppInForeground = true
        authRepository.currentUser?.uid?.let { uid ->
            CoroutineScope(Dispatchers.IO).launch { userRepository.updateLastSeen(uid) }
        }
    }

    override fun onStop() {
        super.onStop()
        activeRoomManager.isAppInForeground = false
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleRoomIntent(intent)
    }

    private fun handleRoomIntent(intent: Intent?) {
        when (intent?.action) {
            "OPEN_ROOM" -> {
                val roomId = intent.getStringExtra("roomId")
                if (roomId != null) {
                    _navigateToRoom.value = roomId
                }
            }
            "FINISH_APP" -> {
                finishAffinity()
            }
        }
    }
}
