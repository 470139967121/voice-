package com.example.shytalk

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.navigation.compose.rememberNavController
import com.example.shytalk.data.repository.AuthRepository
import com.example.shytalk.navigation.NavGraph
import com.example.shytalk.navigation.Screen
import com.example.shytalk.ui.theme.ShyTalkTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var authRepository: AuthRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            ShyTalkTheme {
                val navController = rememberNavController()
                val startDestination = if (authRepository.isAuthenticated) {
                    Screen.Main.route
                } else {
                    Screen.PhoneAuth.route
                }
                NavGraph(
                    navController = navController,
                    startDestination = startDestination
                )
            }
        }
    }
}
