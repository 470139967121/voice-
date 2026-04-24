@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package com.shyden.shytalk.core.effects

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import platform.AVFAudio.AVAudioSession
import platform.AVFAudio.AVAudioSessionCategoryOptionDefaultToSpeaker
import platform.AVFAudio.AVAudioSessionCategoryPlayAndRecord
import platform.AVFAudio.setActive
import platform.UIKit.UIApplication

@Composable
actual fun KeepScreenOn() {
    DisposableEffect(Unit) {
        UIApplication.sharedApplication.idleTimerDisabled = true
        onDispose {
            UIApplication.sharedApplication.idleTimerDisabled = false
        }
    }
}

@Composable
actual fun RequestMicPermission(onResult: (Boolean) -> Unit) {
    LaunchedEffect(Unit) {
        val session = AVAudioSession.sharedInstance()
        session.requestRecordPermission { granted ->
            onResult(granted)
        }
    }

    // Also configure the audio session for voice room use
    DisposableEffect(Unit) {
        val session = AVAudioSession.sharedInstance()
        try {
            session.setCategory(
                AVAudioSessionCategoryPlayAndRecord,
                withOptions = AVAudioSessionCategoryOptionDefaultToSpeaker,
                error = null,
            )
            session.setActive(true, error = null)
        } catch (_: Exception) {
            // Audio session setup failure is non-fatal
        }
        onDispose {
            try {
                session.setActive(false, error = null)
            } catch (_: Exception) {
                // Best effort cleanup
            }
        }
    }
}
