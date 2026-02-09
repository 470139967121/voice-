package com.shyden.shytalk.navigation

sealed class Screen(val route: String) {
    data object GoogleSignIn : Screen("google_sign_in")
    data object ProfileSetup : Screen("profile_setup")
    data object Main : Screen("main")
    data object Room : Screen("room/{roomId}") {
        fun createRoute(roomId: String) = "room/$roomId"
    }
    data object UserProfile : Screen("profile/{userId}") {
        fun createRoute(userId: String) = "profile/$userId"
    }
}
