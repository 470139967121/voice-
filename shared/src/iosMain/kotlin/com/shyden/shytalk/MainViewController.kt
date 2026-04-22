package com.shyden.shytalk

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.window.ComposeUIViewController
import androidx.navigation.compose.rememberNavController
import com.shyden.shytalk.navigation.IosPlatformNavCallbacks
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.navigation.SharedNavGraph
import com.shyden.shytalk.navigation.createIosPlatformScreens
import com.shyden.shytalk.ui.theme.ShyTalkTheme

@Suppress("ktlint:standard:function-naming")
fun MainViewController() = ComposeUIViewController { IosApp() }

@Composable
private fun IosApp() {
    val navController = rememberNavController()
    val platformCallbacks = remember { IosPlatformNavCallbacks() }
    val platformScreens = remember { createIosPlatformScreens() }

    ShyTalkTheme(darkTheme = true) {
        SharedNavGraph(
            navController = navController,
            startDestination = Screen.SignIn.route,
            onSignOut = { navController.navigate(Screen.SignIn.route) { popUpTo(0) } },
            platformCallbacks = platformCallbacks,
            platformScreens = platformScreens,
        )
    }
}
