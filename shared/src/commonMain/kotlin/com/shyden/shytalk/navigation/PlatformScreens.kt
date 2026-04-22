package com.shyden.shytalk.navigation

import androidx.compose.runtime.Composable

// Parameters for platform-specific screens injected into the shared NavGraph.
// Instead of expect/actual composables (which would require moving Android-specific
// screens and their heavy dependencies into shared/androidMain), the NavGraph receives
// these screens as composable lambdas. Each platform provides its own implementation.

/** Parameters for the sign-in screen. */
data class SignInScreenParams(
    val pendingEmailLink: String? = null,
    val onEmailLinkConsumed: () -> Unit = {},
    val onNavigateToEmail: () -> Unit = {},
    val onAuthSuccess: (hasProfile: Boolean, hasDOB: Boolean, needsLegalAcceptance: Boolean) -> Unit,
)

/** Parameters for the app settings screen. */
data class AppSettingsScreenParams(
    val onNavigateBack: () -> Unit,
    val onNavigateToPrivacyPolicy: () -> Unit,
    val onNavigateToCommunityStandards: () -> Unit = {},
    val onNavigateToTermsAndConditions: () -> Unit = {},
    val onNavigateToCyberBullyingPolicy: () -> Unit = {},
    val onSignOut: () -> Unit,
)

/** Parameters for the warning screen. */
data class WarningScreenParams(
    val reason: String?,
    val onAccept: () -> Unit,
    val onViewCommunityStandards: () -> Unit,
)

/**
 * Container for platform-specific screen composables.
 *
 * Android provides real implementations wrapping the existing screens.
 * iOS provides stub/placeholder implementations for v1.
 */
data class PlatformScreens(
    val signInScreen: @Composable (SignInScreenParams) -> Unit,
    val appSettingsScreen: @Composable (AppSettingsScreenParams) -> Unit,
    val warningScreen: @Composable (WarningScreenParams) -> Unit,
)
