@file:OptIn(
    kotlinx.cinterop.ExperimentalForeignApi::class,
    kotlinx.cinterop.BetaInteropApi::class,
    kotlin.experimental.ExperimentalNativeApi::class,
)

package com.shyden.shytalk.core.audio

import com.shyden.shytalk.core.util.logE
import kotlinx.cinterop.ObjCObjectVar
import kotlinx.cinterop.UShortVar
import kotlinx.cinterop.alloc
import kotlinx.cinterop.convert
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.pointed
import kotlinx.cinterop.ptr
import kotlinx.cinterop.reinterpret
import kotlinx.cinterop.set
import kotlinx.cinterop.value
import platform.AVFAudio.AVAudioEngine
import platform.AVFAudio.AVAudioFormat
import platform.AVFAudio.AVAudioPCMBuffer
import platform.AVFAudio.AVAudioPCMFormatInt16
import platform.AVFAudio.AVAudioPlayerNode
import platform.AVFAudio.AVAudioSession
import platform.AVFAudio.AVAudioSessionCategoryAmbient
import platform.AVFAudio.setActive
import platform.Foundation.NSError

private const val TAG = "GachaSoundPlayer.ios"

actual object GachaSoundPlayer {
    private var engine: AVAudioEngine? = null
    private var spinStart: PreloadedSound? = null
    private var blinkClick: PreloadedSound? = null
    private var coinPurchase: PreloadedSound? = null
    private var highTierFanfare: PreloadedSound? = null
    private val ticks = arrayOfNulls<PreloadedSound>(8)
    private val winReveals = mutableMapOf<GachaSoundTier, PreloadedSound>()

    @kotlin.concurrent.Volatile
    private var initialized = false

    /**
     * Init/release run on the main thread (Compose `LaunchedEffect` /
     * `DisposableEffect` callbacks). Compose serialises recomposition,
     * so a second init() cannot interleave with the first on the same
     * screen, and we don't expose this object outside Compose-owned
     * lifecycle. The volatile flag is the visibility barrier for
     * `replay()` callers, which can come from arbitrary coroutine
     * contexts during the gacha animation.
     */
    actual fun init() {
        if (initialized) return
        try {
            memScoped {
                val sessionErr = alloc<ObjCObjectVar<NSError?>>()
                val session = AVAudioSession.sharedInstance()
                // Ambient category lets the app play sound without
                // interrupting other audio (music, calls). Maps to
                // Android USAGE_GAME / CONTENT_TYPE_SONIFICATION.
                if (!session.setCategory(AVAudioSessionCategoryAmbient, sessionErr.ptr)) {
                    logE(TAG, "setCategory failed: ${sessionErr.value}")
                    return
                }
                if (!session.setActive(true, sessionErr.ptr)) {
                    logE(TAG, "setActive failed: ${sessionErr.value}")
                    return
                }
            }

            val format =
                AVAudioFormat(
                    commonFormat = AVAudioPCMFormatInt16,
                    sampleRate = GACHA_SAMPLE_RATE.toDouble(),
                    channels = 1u,
                    interleaved = false,
                )

            val newEngine = AVAudioEngine()

            spinStart = preload(newEngine, format, generateSpinStart())
            blinkClick = preload(newEngine, format, generateBlinkClick())
            coinPurchase = preload(newEngine, format, generateCoinPurchase())
            highTierFanfare = preload(newEngine, format, generateHighTierFanfare())
            for (band in 0 until 8) {
                ticks[band] = preload(newEngine, format, generateTick(band))
            }
            GachaSoundTier.entries.forEach { tier ->
                winReveals[tier] = preload(newEngine, format, generateWinReveal(tier))
            }

            memScoped {
                val engineErr = alloc<ObjCObjectVar<NSError?>>()
                if (!newEngine.startAndReturnError(engineErr.ptr)) {
                    logE(TAG, "AVAudioEngine.start failed: ${engineErr.value}")
                    clearPreloadedState()
                    return
                }
            }

            engine = newEngine
            // Volatile write LAST — replay() callers must never observe
            // a half-built audio graph through a relaxed read.
            initialized = true
        } catch (e: Throwable) {
            logE(TAG, "Audio engine init threw", e)
            clearPreloadedState()
            engine = null
            initialized = false
        }
    }

    actual fun release() {
        if (!initialized) return
        // Volatile write FIRST so any concurrent replay() coroutine
        // observes the gate flip and bails before touching a detached
        // player node — scheduleBuffer on a stopped engine raises
        // NSInternalInconsistencyException.
        initialized = false
        try {
            engine?.stop()
            allSounds().forEach { it.player.stop() }
        } catch (e: Throwable) {
            logE(TAG, "Audio engine release threw", e)
        }
        clearPreloadedState()
        engine = null
    }

    actual fun playSpinStart() = replay(spinStart)

    actual fun playBlinkClick() = replay(blinkClick)

    actual fun playCoinPurchase() = replay(coinPurchase)

    actual fun playHighTierFanfare() = replay(highTierFanfare)

    actual fun playTick(progress: Float) {
        val band = (progress.coerceIn(0f, 1f) * 7).toInt().coerceIn(0, 7)
        replay(ticks[band])
    }

    actual fun playWinReveal(coinValue: Int) {
        replay(winReveals[gachaSoundTierForCoinValue(coinValue)])
    }

    private fun replay(sound: PreloadedSound?) {
        sound ?: return
        // Volatile gate prevents play after release() has detached the
        // player from the engine — scheduleBuffer on a stopped engine
        // raises NSInternalInconsistencyException on iOS.
        if (!initialized) return
        try {
            // stop() drops any in-flight buffer so rapid replays restart
            // from the beginning instead of queuing — matches Android
            // pause()+reloadStaticData()+play() semantics.
            sound.player.stop()
            sound.player.scheduleBuffer(sound.buffer, completionHandler = null)
            sound.player.play()
        } catch (e: Throwable) {
            logE(TAG, "Audio replay failed", e)
        }
    }

    private fun preload(
        engine: AVAudioEngine,
        format: AVAudioFormat,
        samples: ShortArray,
    ): PreloadedSound {
        val buffer =
            AVAudioPCMBuffer(
                pCMFormat = format,
                frameCapacity = samples.size.convert(),
            )
        buffer.frameLength = samples.size.convert()

        // AVAudioPCMBuffer.int16ChannelData is a pointer-to-pointer; channel 0
        // holds the mono data. Reinterpret to UShortVar to bypass Kotlin/Native
        // signedness mismatch warnings — the wire bits are identical.
        val channels = buffer.int16ChannelData
        if (channels != null) {
            val channel0 = channels.pointed.value
            if (channel0 != null) {
                val raw = channel0.reinterpret<UShortVar>()
                for (i in samples.indices) {
                    raw[i] = samples[i].toUShort()
                }
            }
        }

        val player = AVAudioPlayerNode()
        engine.attachNode(player)
        engine.connect(player, to = engine.mainMixerNode, format = format)
        return PreloadedSound(player, buffer)
    }

    private fun allSounds(): List<PreloadedSound> =
        listOfNotNull(spinStart, blinkClick, coinPurchase, highTierFanfare) +
            ticks.filterNotNull() +
            winReveals.values

    private fun clearPreloadedState() {
        spinStart = null
        blinkClick = null
        coinPurchase = null
        highTierFanfare = null
        ticks.indices.forEach { ticks[it] = null }
        winReveals.clear()
    }

    private data class PreloadedSound(
        val player: AVAudioPlayerNode,
        val buffer: AVAudioPCMBuffer,
    )
}
