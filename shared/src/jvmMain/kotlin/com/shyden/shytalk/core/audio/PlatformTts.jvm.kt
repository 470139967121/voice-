package com.shyden.shytalk.core.audio

actual object PlatformTts {
    actual val isInitialized: Boolean = false

    actual fun speak(
        text: String,
        utteranceId: String,
    ) {
        // No-op on JVM (test-only target)
    }

    actual fun stop() {
        // No-op on JVM (test-only target)
    }

    actual fun release() {
        // No-op on JVM (test-only target)
    }
}
