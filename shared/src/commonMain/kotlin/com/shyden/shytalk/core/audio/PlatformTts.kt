package com.shyden.shytalk.core.audio

expect object PlatformTts {
    val isInitialized: Boolean

    fun speak(
        text: String,
        utteranceId: String = "",
    )

    fun stop()

    fun release()
}
