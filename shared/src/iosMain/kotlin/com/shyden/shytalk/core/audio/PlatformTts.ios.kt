package com.shyden.shytalk.core.audio

import platform.AVFAudio.AVSpeechSynthesisVoice
import platform.AVFAudio.AVSpeechSynthesizer
import platform.AVFAudio.AVSpeechUtterance

actual object PlatformTts {
    private var synthesizer: AVSpeechSynthesizer? = null

    actual val isInitialized: Boolean
        get() = synthesizer != null

    fun initialize() {
        if (synthesizer != null) return
        synthesizer = AVSpeechSynthesizer()
    }

    actual fun speak(
        text: String,
        utteranceId: String,
    ) {
        if (synthesizer == null) initialize()
        val utterance = AVSpeechUtterance(string = text)
        utterance.voice = AVSpeechSynthesisVoice.voiceWithLanguage("en-US")
        utterance.pitchMultiplier = 0.75f
        utterance.rate = 0.4f // iOS rate scale differs from Android; 0.4 ≈ Android's 0.85
        synthesizer?.speakUtterance(utterance)
    }

    actual fun stop() {
        if (synthesizer?.isSpeaking() == true) {
            // Deallocate and recreate to immediately stop all speech
            // (AVSpeechBoundary constants not directly available in K/N cinterop)
            synthesizer = AVSpeechSynthesizer()
        }
    }

    actual fun release() {
        synthesizer = null
    }
}
