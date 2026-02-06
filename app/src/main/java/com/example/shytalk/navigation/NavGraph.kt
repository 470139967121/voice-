package com.example.shytalk.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.example.shytalk.feature.auth.GoogleSignInScreen
import com.example.shytalk.feature.auth.PhoneAuthScreen
import com.example.shytalk.feature.home.HomeScreen
import com.example.shytalk.feature.profile.ProfileScreen
import com.example.shytalk.feature.profile.ProfileSetupScreen
import com.example.shytalk.feature.room.RoomScreen

@Composable
fun NavGraph(
    navController: NavHostController,
    startDestination: String
) {
    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        composable(Screen.PhoneAuth.route) {
            PhoneAuthScreen(
                onNavigateToGoogleSignIn = {
                    navController.navigate(Screen.GoogleSignIn.route)
                },
                onAuthSuccess = { hasProfile ->
                    if (hasProfile) {
                        navController.navigate(Screen.Home.route) {
                            popUpTo(Screen.PhoneAuth.route) { inclusive = true }
                        }
                    } else {
                        navController.navigate(Screen.ProfileSetup.route) {
                            popUpTo(Screen.PhoneAuth.route) { inclusive = true }
                        }
                    }
                }
            )
        }

        composable(Screen.GoogleSignIn.route) {
            GoogleSignInScreen(
                onNavigateToPhoneAuth = {
                    navController.popBackStack()
                },
                onAuthSuccess = { hasProfile ->
                    if (hasProfile) {
                        navController.navigate(Screen.Home.route) {
                            popUpTo(Screen.PhoneAuth.route) { inclusive = true }
                        }
                    } else {
                        navController.navigate(Screen.ProfileSetup.route) {
                            popUpTo(Screen.PhoneAuth.route) { inclusive = true }
                        }
                    }
                }
            )
        }

        composable(Screen.ProfileSetup.route) {
            ProfileSetupScreen(
                onProfileComplete = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.ProfileSetup.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.Home.route) {
            HomeScreen(
                onNavigateToRoom = { roomId ->
                    navController.navigate(Screen.Room.createRoute(roomId))
                },
                onNavigateToProfile = {
                    navController.navigate(Screen.Profile.route)
                },
                onSignOut = {
                    navController.navigate(Screen.PhoneAuth.route) {
                        popUpTo(Screen.Home.route) { inclusive = true }
                    }
                }
            )
        }

        composable(
            route = Screen.Room.route,
            arguments = listOf(navArgument("roomId") { type = NavType.StringType })
        ) { backStackEntry ->
            val roomId = backStackEntry.arguments?.getString("roomId") ?: return@composable
            RoomScreen(
                roomId = roomId,
                onNavigateBack = { navController.popBackStack() }
            )
        }

        composable(Screen.Profile.route) {
            ProfileScreen(
                onNavigateBack = { navController.popBackStack() }
            )
        }
    }
}
