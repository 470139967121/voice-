package com.shyden.shytalk.ui.components.seasonal

import androidx.compose.runtime.Composable
import com.shyden.shytalk.ui.theme.SeasonalTheme

/**
 * Renders the active seasonal event's animated background, if any.
 * When no event is active, renders nothing — the default room appearance is used.
 */
@Composable
fun SeasonalBackground() {
    when (SeasonalTheme.activeEvent()?.slug) {
        "khmer-new-year-2026" -> KhmerNewYearBackground()
    }
}
