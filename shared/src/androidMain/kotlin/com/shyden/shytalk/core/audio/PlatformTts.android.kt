package com.shyden.shytalk.core.audio

import android.content.Context
import android.speech.tts.TextToSpeech
import com.shyden.shytalk.core.util.logW
import java.util.Locale

actual object PlatformTts {
    private var engine: TextToSpeech? = null

    actual val isInitialized: Boolean
        get() = engine != null

    fun initialize(context: Context) {
        if (engine != null) return
        engine =
            TextToSpeech(context) { status ->
                if (status == TextToSpeech.SUCCESS) {
                    engine?.language = Locale.US
                    engine?.setPitch(0.75f)
                    engine?.setSpeechRate(0.85f)
                } else {
                    logW("PlatformTts", "TTS initialization failed with status $status")
                    engine = null
                }
            }
    }

    actual fun speak(
        text: String,
        utteranceId: String,
    ) {
        engine?.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
    }

    actual fun stop() {
        engine?.stop()
    }

    actual fun release() {
        engine?.stop()
        engine?.shutdown()
        engine = null
    }
}
