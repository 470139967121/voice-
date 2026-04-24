package com.shyden.shytalk.core.effects

import kotlin.test.Test

class PlatformEffectsTest {
    @Test
    fun `KeepScreenOn composable exists and is callable`() {
        // Verify the function signature exists — actual rendering is platform-specific.
        // The composable is a no-op on JVM; this test verifies the expect/actual compiles.
        val fn: @androidx.compose.runtime.Composable () -> Unit = { KeepScreenOn() }

        // Composables can't be invoked outside a composition, so just verify the reference exists.
        @Suppress("UNUSED_VARIABLE")
        val ref = fn
    }

    @Test
    fun `RequestMicPermission composable exists and is callable`() {
        val fn: @androidx.compose.runtime.Composable (onResult: (Boolean) -> Unit) -> Unit = { onResult ->
            RequestMicPermission(onResult = onResult)
        }

        @Suppress("UNUSED_VARIABLE")
        val ref = fn
    }
}
