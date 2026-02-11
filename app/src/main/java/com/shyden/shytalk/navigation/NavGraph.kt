package com.shyden.shytalk.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.shyden.shytalk.feature.auth.GoogleSignInScreen
import com.shyden.shytalk.feature.main.MainScreen
import com.shyden.shytalk.feature.privacy.PrivacyPolicyScreen
import com.shyden.shytalk.feature.profile.ProfileScreen
import com.shyden.shytalk.feature.profile.ProfileSetupScreen
import com.shyden.shytalk.feature.room.RoomScreen

@Composable
fun NavGraph(
    navController: NavHostController,
    startDestination: String,
    onSignOut: () -> Unit
) {
    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        composable(Screen.GoogleSignIn.route) {
            GoogleSignInScreen(
                onAuthSuccess = { hasProfile ->
                    if (hasProfile) {
                        navController.navigate(Screen.Main.route) {
                            popUpTo(Screen.GoogleSignIn.route) { inclusive = true }
                        }
                    } else {
                        navController.navigate(Screen.ProfileSetup.route) {
                            popUpTo(Screen.GoogleSignIn.route) { inclusive = true }
                        }
                    }
                }
            )
        }

        composable(Screen.ProfileSetup.route) {
            ProfileSetupScreen(
                onProfileComplete = {
                    navController.navigate(Screen.Main.route) {
                        popUpTo(Screen.ProfileSetup.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.Main.route) {
            MainScreen(
                onNavigateToRoom = { roomId ->
                    navController.navigate(Screen.Room.createRoute(roomId))
                },
                onNavigateToUserProfile = { userId ->
                    navController.navigate(Screen.UserProfile.createRoute(userId))
                },
                onNavigateToPrivacyPolicy = {
                    navController.navigate(Screen.PrivacyPolicy.route)
                },
                onSignOut = {
                    onSignOut()
                    navController.navigate(Screen.GoogleSignIn.route) {
                        popUpTo(Screen.Main.route) { inclusive = true }
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
                onNavigateBack = { navController.popBackStack() },
                onNavigateToUserProfile = { userId ->
                    navController.navigate(Screen.UserProfile.createRoute(userId))
                }
            )
        }

        composable(
            route = Screen.UserProfile.route,
            arguments = listOf(navArgument("userId") { type = NavType.StringType })
        ) { backStackEntry ->
            val userId = backStackEntry.arguments?.getString("userId") ?: return@composable
            ProfileScreen(
                userId = userId,
                onNavigateBack = { navController.popBackStack() }
            )
        }

        composable(Screen.PrivacyPolicy.route) {
            PrivacyPolicyScreen(
                onAccept = { navController.popBackStack() },
                onDecline = { navController.popBackStack() },
                showActions = false
            )
        }
    }
}
