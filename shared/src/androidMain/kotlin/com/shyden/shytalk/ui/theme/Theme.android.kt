package com.shyden.shytalk.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable

@Suppress("UNUSED_PARAMETER")
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
                tertiary = event.accentColor,
            )
        } ?: defaultScheme

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content,
    )
}
