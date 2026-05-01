package com.shyden.shytalk.navigation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

/**
 * iOS-specific NavGraph screen wiring.
 *
 * - SignIn → unified `SignInScreen` (commonMain since Phase 4 of #20)
 * - AppSettings → unified `AppSettingsScreen` (commonMain)
 * - Warning → shared `WarningScreen` (commonMain)
 * - Profile → shared `ProfileScreen` (commonMain)
 * - Room → shared `RoomScreen` (commonMain)
 */
fun createIosPlatformScreens(): PlatformScreens =
    PlatformScreens(
        signInScreen = { params ->
            com.shyden.shytalk.feature.auth.SignInScreen(
                pendingEmailLink = params.pendingEmailLink,
                onEmailLinkConsumed = params.onEmailLinkConsumed,
                onNavigateToEmail = params.onNavigateToEmail,
                onAuthSuccess = params.onAuthSuccess,
            )
        },
        appSettingsScreen = { params ->
            com.shyden.shytalk.feature.settings.AppSettingsScreen(
                onNavigateBack = params.onNavigateBack,
                onNavigateToPrivacyPolicy = params.onNavigateToPrivacyPolicy,
                onNavigateToCommunityStandards = params.onNavigateToCommunityStandards,
                onNavigateToTermsAndConditions = params.onNavigateToTermsAndConditions,
                onNavigateToCyberBullyingPolicy = params.onNavigateToCyberBullyingPolicy,
                onSignOut = params.onSignOut,
            )
        },
        warningScreen = { params -> IosWarningScreen(params) },
        profileScreen = { params ->
            com.shyden.shytalk.feature.profile.ProfileScreen(
                userId = params.userId,
                showBackButton = params.showBackButton,
                onNavigateBack = params.onNavigateBack,
                onNavigateToUserProfile = params.onNavigateToUserProfile,
                onNavigateToFollowList = params.onNavigateToFollowList,
                onNavigateToSettings = params.onNavigateToSettings,
                onNavigateToRoom = params.onNavigateToRoom,
                onNavigateToChat = params.onNavigateToChat,
                onNavigateToWallet = params.onNavigateToWallet,
                modifier = params.modifier,
            )
        },
        roomScreen = { params ->
            com.shyden.shytalk.feature.room.RoomScreen(
                roomId = params.roomId,
                isBackendDegraded = params.isBackendDegraded,
                onNavigateBack = params.onNavigateBack,
                onNavigateToUserProfile = params.onNavigateToUserProfile,
                onNavigateToChat = params.onNavigateToChat,
                onNavigateToWallet = params.onNavigateToWallet,
            )
        },
    )

@Composable
private fun IosWarningScreen(params: WarningScreenParams) {
    com.shyden.shytalk.feature.warning.WarningScreen(
        reason = params.reason,
        onAccept = params.onAccept,
        onViewCommunityStandards = params.onViewCommunityStandards,
    )
}
