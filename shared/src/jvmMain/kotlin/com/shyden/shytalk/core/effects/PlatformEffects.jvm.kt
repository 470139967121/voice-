package com.shyden.shytalk.core.effects

import androidx.compose.runtime.Composable

@Composable
actual fun KeepScreenOn() {
    // No-op on JVM (test-only target)
}

@Composable
actual fun RequestMicPermission(onResult: (Boolean) -> Unit) {
    // No-op on JVM (test-only target)
}
