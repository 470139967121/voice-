package com.shyden.shytalk.core.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack

actual object GachaSoundPlayer {
    private var spinStartTrack: AudioTrack? = null
    private var blinkClickTrack: AudioTrack? = null
    private var coinPurchaseTrack: AudioTrack? = null
    private var highTierFanfareTrack: AudioTrack? = null
    private val tickTracks = arrayOfNulls<AudioTrack>(8)
    private val winTracks = mutableMapOf<GachaSoundTier, AudioTrack>()

    @Volatile private var initialized = false
    private val lock = Any()

    actual fun init(): Unit =
        synchronized(lock) {
            if (initialized) return
            initialized = true
            spinStartTrack = buildTrack(generateSpinStart())
            blinkClickTrack = buildTrack(generateBlinkClick())
            coinPurchaseTrack = buildTrack(generateCoinPurchase())
            highTierFanfareTrack = buildTrack(generateHighTierFanfare())
            for (band in 0 until 8) {
                tickTracks[band] = buildTrack(generateTick(band))
            }
            GachaSoundTier.entries.forEach { tier ->
                winTracks[tier] = buildTrack(generateWinReveal(tier))
            }
        }

    actual fun release(): Unit =
        synchronized(lock) {
            if (!initialized) return
            initialized = false
            spinStartTrack?.release()
            spinStartTrack = null
            blinkClickTrack?.release()
            blinkClickTrack = null
            coinPurchaseTrack?.release()
            coinPurchaseTrack = null
            highTierFanfareTrack?.release()
            highTierFanfareTrack = null
            tickTracks.indices.forEach {
                tickTracks[it]?.release()
                tickTracks[it] = null
            }
            winTracks.values.forEach { it.release() }
            winTracks.clear()
        }

    actual fun playSpinStart() = replay(spinStartTrack)

    actual fun playBlinkClick() = replay(blinkClickTrack)

    actual fun playCoinPurchase() = replay(coinPurchaseTrack)

    actual fun playHighTierFanfare() = replay(highTierFanfareTrack)

    actual fun playTick(progress: Float) {
        val band = (progress.coerceIn(0f, 1f) * 7).toInt().coerceIn(0, 7)
        replay(tickTracks[band])
    }

    actual fun playWinReveal(coinValue: Int) {
        replay(winTracks[gachaSoundTierForCoinValue(coinValue)])
    }

    private fun replay(track: AudioTrack?) {
        track ?: return
        try {
            track.pause()
            track.reloadStaticData()
            track.play()
        } catch (e: Exception) {
            android.util.Log.w("GachaSoundPlayer", "Audio track replay failed", e)
        }
    }

    private fun buildTrack(samples: ShortArray): AudioTrack {
        val bufferSize = samples.size * 2
        val track =
            AudioTrack
                .Builder()
                .setAudioAttributes(
                    AudioAttributes
                        .Builder()
                        .setUsage(AudioAttributes.USAGE_GAME)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                ).setAudioFormat(
                    AudioFormat
                        .Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(GACHA_SAMPLE_RATE)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build(),
                ).setBufferSizeInBytes(bufferSize)
                .setTransferMode(AudioTrack.MODE_STATIC)
                .build()
        track.write(samples, 0, samples.size)
        return track
    }
}
