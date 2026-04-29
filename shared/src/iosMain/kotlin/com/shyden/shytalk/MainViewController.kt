package com.shyden.shytalk

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.window.ComposeUIViewController
import androidx.navigation.compose.rememberNavController
import com.shyden.shytalk.core.push.chatDeepLinks
import com.shyden.shytalk.core.push.consumeChatDeepLink
import com.shyden.shytalk.core.util.LanguagePreference
import com.shyden.shytalk.feature.legal.CURRENT_LEGAL_VERSION
import com.shyden.shytalk.feature.legal.CommunityStandardsScreen
import com.shyden.shytalk.feature.legal.CyberBullyingPolicyScreen
import com.shyden.shytalk.feature.legal.LegalAcceptanceScreen
import com.shyden.shytalk.feature.legal.TermsAndConditionsScreen
import com.shyden.shytalk.feature.privacy.PrivacyPolicyScreen
import com.shyden.shytalk.navigation.IosPlatformNavCallbacks
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.navigation.SharedNavGraph
import com.shyden.shytalk.navigation.createIosPlatformScreens
import com.shyden.shytalk.ui.theme.ShyTalkTheme
import kotlinx.coroutines.flow.filterNotNull

@Suppress("ktlint:standard:function-naming")
fun MainViewController() = ComposeUIViewController { IosApp() }

@Composable
private fun IosApp() {
    var legalAccepted by remember {
        mutableStateOf(LanguagePreference.getAcceptedLegalVersion() >= CURRENT_LEGAL_VERSION)
    }
    var viewingLegalDoc by remember { mutableStateOf<String?>(null) }

    ShyTalkTheme(darkTheme = true) {
        if (!legalAccepted) {
            when (viewingLegalDoc) {
                "privacy" ->
                    PrivacyPolicyScreen(
                        onAccept = {},
                        onDecline = {},
                        onNavigateBack = { viewingLegalDoc = null },
                        showActions = false,
                    )

                "community" ->
                    CommunityStandardsScreen(
                        onNavigateBack = { viewingLegalDoc = null },
                    )

                "terms" ->
                    TermsAndConditionsScreen(
                        onNavigateBack = { viewingLegalDoc = null },
                    )

                "cyberbullying" ->
                    CyberBullyingPolicyScreen(
                        onNavigateBack = { viewingLegalDoc = null },
                    )

                else ->
                    LegalAcceptanceScreen(
                        onAccept = {
                            LanguagePreference.setAcceptedLegalVersion(CURRENT_LEGAL_VERSION)
                            legalAccepted = true
                        },
                        onViewPrivacyPolicy = { viewingLegalDoc = "privacy" },
                        onViewCommunityStandards = { viewingLegalDoc = "community" },
                        onViewTerms = { viewingLegalDoc = "terms" },
                        onViewCyberBullyingPolicy = { viewingLegalDoc = "cyberbullying" },
                    )
            }
        } else {
            val navController = rememberNavController()
            val platformCallbacks = remember { IosPlatformNavCallbacks() }
            val platformScreens = remember { createIosPlatformScreens() }

            // Push notification deep links: navigate to the right chat when the
            // user taps a notification. The bus is a nullable StateFlow — collect
            // non-null values, navigate, then `consume()` to clear so a re-subscribe
            // (e.g. after sign-out → sign-in re-creating the NavGraph) does NOT
            // re-fire the link from the previous user session.
            LaunchedEffect(navController) {
                chatDeepLinks.filterNotNull().collect { link ->
                    val route =
                        if (link.isGroup) {
                            Screen.GroupChat.createRoute(link.conversationId)
                        } else {
                            Screen.PrivateChat.createRoute(link.otherUserId)
                        }
                    navController.navigate(route)
                    consumeChatDeepLink()
                }
            }

            // Foreground token-sync trigger lives in AppDelegate (Swift) — it
            // observes UIApplication.didBecomeActiveNotification and calls
            // `IosPushBridgeKt.trySyncFcmTokenForCurrentUser()`. We do NOT
            // duplicate that here; a one-shot LaunchedEffect would race with
            // FCM's async token delivery and miss the registration.

            SharedNavGraph(
                navController = navController,
                startDestination = Screen.SignIn.route,
                onSignOut = { navController.navigate(Screen.SignIn.route) { popUpTo(0) } },
                platformCallbacks = platformCallbacks,
                platformScreens = platformScreens,
            )
        }
    }
}
