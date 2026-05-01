package com.shyden.shytalk.core.util

import android.app.Activity
import android.content.ContextWrapper
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode

/**
 * Walks the Compose host's `LocalContext` chain looking for an Activity.
 * Compose Multiplatform doesn't always expose the Activity directly via
 * `LocalContext.current` — when the screen is hosted inside a
 * `ContextWrapper` (as some preview / theming wrappers do) we have to
 * unwrap to find the underlying Activity.
 *
 * Returns `null` only when the function is invoked from a Compose preview
 * (`LocalInspectionMode.current == true`) — previews don't render real
 * sign-in UI so a null is the right escape hatch. In all other cases we
 * fail loud via `error()` rather than letting the screen render a
 * non-functional Apple/Google button that would only fail later at the
 * helper's `requireNotNull` boundary with a developer-grade error message
 * leaking into the user's snackbar.
 */
@Composable
actual fun rememberPlatformActivity(): Any? {
    val initialContext = LocalContext.current
    if (LocalInspectionMode.current) return null
    var ctx = initialContext
    while (ctx is ContextWrapper) {
        if (ctx is Activity) return ctx
        ctx = ctx.baseContext
    }
    error(
        "rememberPlatformActivity: no Activity in LocalContext chain — " +
            "SignInScreen must be hosted by an Activity, got ${initialContext::class.simpleName}",
    )
}
