package com.shyden.shytalk.navigation

sealed class Screen(val route: String) {
    data object SignIn : Screen("sign_in")
    data object ProfileSetup : Screen("profile_setup")
    data object Main : Screen("main")
    data object Room : Screen("room/{roomId}") {
        fun createRoute(roomId: String) = "room/$roomId"
    }
    data object UserProfile : Screen("profile/{userId}") {
        fun createRoute(userId: String) = "profile/$userId"
    }
    data object FollowList : Screen("follow_list/{userId}/{tab}") {
        fun createRoute(userId: String, tab: String) = "follow_list/$userId/$tab"
    }
    data object RequiredDOB : Screen("required_dob")
    data object PrivacyPolicy : Screen("privacy_policy")
    data object Settings : Screen("settings")
}
