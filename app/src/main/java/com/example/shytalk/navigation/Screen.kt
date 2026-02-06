package com.example.shytalk.navigation

sealed class Screen(val route: String) {
    data object PhoneAuth : Screen("phone_auth")
    data object GoogleSignIn : Screen("google_sign_in")
    data object ProfileSetup : Screen("profile_setup")
    data object Home : Screen("home")
    data object Room : Screen("room/{roomId}") {
        fun createRoute(roomId: String) = "room/$roomId"
    }
    data object Profile : Screen("profile")
}
