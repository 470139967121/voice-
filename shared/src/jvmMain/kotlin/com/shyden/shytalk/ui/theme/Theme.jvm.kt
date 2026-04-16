package com.shyden.shytalk.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable

@Suppress("ktlint:standard:function-naming", "UNUSED_PARAMETER")
@Composable
actual fun ShyTalkTheme(
    darkTheme: Boolean,
    dynamicColor: Boolean,
    content: @Composable () -> Unit,
) {
    val defaultScheme = if (darkTheme) DarkColorScheme else LightColorScheme
    val colorScheme =
        SeasonalTheme.activeEvent()?.let { event ->
            defaultScheme.copy(
                primary = event.primaryColor,
                primaryContainer = event.primaryColor.copy(alpha = 0.3f),
                onPrimaryContainer = event.primaryColor,
                tertiary = event.accentColor,
                tertiaryContainer = event.accentColor.copy(alpha = 0.3f),
            )
        } ?: defaultScheme

    MaterialTheme(
        colorScheme = colorScheme,
        content = content,
    )
}
