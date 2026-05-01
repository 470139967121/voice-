package com.shyden.shytalk.core.audio

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sin

/**
 * Procedural audio synthesis for the gacha screen. Pure-math sample
 * generators kept platform-independent; each platform `actual` for
 * GachaSoundPlayer wraps the resulting `ShortArray` in its native
 * audio playback engine (AudioTrack on Android, AVAudioEngine on iOS).
 *
 * All generators output mono 16-bit PCM at 44100 Hz with sample values
 * clamped to the signed-short range. The same sample data plays
 * identically on both platforms, so audio behaviour stays in sync as
 * we add features.
 */
const val GACHA_SAMPLE_RATE = 44100

/**
 * Coin-value thresholds for win-reveal sound tiers. Match the Android
 * Wallet contract — common pings for low coins, layered chords +
 * shimmers + sub-bass for legendary.
 */
enum class GachaSoundTier { COMMON, UNCOMMON, RARE, EPIC, LEGENDARY }

fun gachaSoundTierForCoinValue(coinValue: Int): GachaSoundTier =
    when {
        coinValue < 50 -> GachaSoundTier.COMMON
        coinValue < 200 -> GachaSoundTier.UNCOMMON
        coinValue < 2000 -> GachaSoundTier.RARE
        coinValue < 10000 -> GachaSoundTier.EPIC
        else -> GachaSoundTier.LEGENDARY
    }

/** Ascending chirp 220→1760 Hz, 420 ms, cos² attack/decay. */
fun generateSpinStart(): ShortArray {
    val durationMs = 420
    val numSamples = GACHA_SAMPLE_RATE * durationMs / 1000
    val samples = ShortArray(numSamples)
    val amplitude = 0.28f
    val attackSamples = GACHA_SAMPLE_RATE * 40 / 1000
    val decaySamples = GACHA_SAMPLE_RATE * 80 / 1000

    var phase = 0.0
    for (i in 0 until numSamples) {
        val t = i.toFloat() / numSamples
        val freq = 220.0 + (1760.0 - 220.0) * t
        phase += 2.0 * PI * freq / GACHA_SAMPLE_RATE
        val envelope =
            if (i < attackSamples) {
                val at = i.toFloat() / attackSamples
                (sin(at * PI / 2) * sin(at * PI / 2)).toFloat()
            } else if (i > numSamples - decaySamples) {
                val dt = (i - (numSamples - decaySamples)).toFloat() / decaySamples
                (cos(dt * PI / 2) * cos(dt * PI / 2)).toFloat()
            } else {
                1f
            }
        samples[i] = (sin(phase) * amplitude * envelope).toShortSample()
    }
    return samples
}

/** Short tick, pitch mapped to 8 bands (180→740 Hz), 28 ms. */
fun generateTick(band: Int): ShortArray {
    val durationMs = 28
    val numSamples = GACHA_SAMPLE_RATE * durationMs / 1000
    val samples = ShortArray(numSamples)
    val freq = 180.0 + (740.0 - 180.0) * (band / 7.0)
    val amplitude = 0.20f
    val attackSamples = GACHA_SAMPLE_RATE * 4 / 1000
    val decaySamples = GACHA_SAMPLE_RATE * 4 / 1000

    var phase = 0.0
    for (i in 0 until numSamples) {
        phase += 2.0 * PI * freq / GACHA_SAMPLE_RATE
        var envelope = 1f
        if (i < attackSamples) {
            val at = i.toFloat() / attackSamples
            envelope = (sin(at * PI / 2) * sin(at * PI / 2)).toFloat()
        } else if (i > numSamples - decaySamples) {
            val dt = (i - (numSamples - decaySamples)).toFloat() / decaySamples
            envelope = (sin((1 - dt) * PI / 2) * sin((1 - dt) * PI / 2)).toFloat()
        }
        samples[i] = (sin(phase) * amplitude * envelope).toShortSample()
    }
    return samples
}

/** Sharp click at 660 Hz, 22 ms, exponential decay. */
fun generateBlinkClick(): ShortArray {
    val durationMs = 22
    val numSamples = GACHA_SAMPLE_RATE * durationMs / 1000
    val samples = ShortArray(numSamples)
    val amplitude = 0.30f

    var phase = 0.0
    for (i in 0 until numSamples) {
        phase += 2.0 * PI * 660.0 / GACHA_SAMPLE_RATE
        val envelope = exp(-5.0 * i.toDouble() / numSamples).toFloat()
        samples[i] = (sin(phase) * amplitude * envelope).toShortSample()
    }
    return samples
}

fun generateWinReveal(tier: GachaSoundTier): ShortArray =
    when (tier) {
        GachaSoundTier.COMMON -> generateWinCommon()
        GachaSoundTier.UNCOMMON -> generateWinUncommon()
        GachaSoundTier.RARE -> generateWinRare()
        GachaSoundTier.EPIC -> generateWinEpic()
        GachaSoundTier.LEGENDARY -> generateWinLegendary()
    }

/** COMMON (<50 coins): single C5 tone, 280 ms. */
private fun generateWinCommon(): ShortArray {
    val durationMs = 280
    val numSamples = GACHA_SAMPLE_RATE * durationMs / 1000
    val samples = ShortArray(numSamples)
    val amplitude = 0.25f
    val attackSamples = GACHA_SAMPLE_RATE * 20 / 1000

    var phase = 0.0
    for (i in 0 until numSamples) {
        phase += 2.0 * PI * 523.0 / GACHA_SAMPLE_RATE
        val envelope =
            if (i < attackSamples) {
                val at = i.toFloat() / attackSamples
                (sin(at * PI / 2) * sin(at * PI / 2)).toFloat()
            } else {
                val dt = (i - attackSamples).toFloat() / (numSamples - attackSamples)
                (1f - dt * dt)
            }
        samples[i] = (sin(phase) * amplitude * envelope).toShortSample()
    }
    return samples
}

/** UNCOMMON (50-199 coins): C5+E5 chord, 420 ms. */
private fun generateWinUncommon(): ShortArray {
    val durationMs = 420
    val numSamples = GACHA_SAMPLE_RATE * durationMs / 1000
    val samples = ShortArray(numSamples)
    val amplitude = 0.25f
    val attackSamples = GACHA_SAMPLE_RATE * 25 / 1000

    var phase1 = 0.0
    var phase2 = 0.0
    for (i in 0 until numSamples) {
        phase1 += 2.0 * PI * 523.0 / GACHA_SAMPLE_RATE
        phase2 += 2.0 * PI * 659.0 / GACHA_SAMPLE_RATE
        val envelope =
            if (i < attackSamples) {
                val at = i.toFloat() / attackSamples
                (sin(at * PI / 2) * sin(at * PI / 2)).toFloat()
            } else {
                val dt = (i - attackSamples).toFloat() / (numSamples - attackSamples)
                (1f - dt)
            }
        val value = (sin(phase1) + sin(phase2)) * 0.5 * amplitude * envelope
        samples[i] = value.toShortSample()
    }
    return samples
}

/** RARE (200-1999 coins): C5+E5+G5 triad + shimmer, 600 ms. */
private fun generateWinRare(): ShortArray {
    val durationMs = 600
    val numSamples = GACHA_SAMPLE_RATE * durationMs / 1000
    val samples = ShortArray(numSamples)
    val amplitude = 0.28f
    val attackSamples = GACHA_SAMPLE_RATE * 25 / 1000

    var phase1 = 0.0
    var phase2 = 0.0
    var phase3 = 0.0
    var shimmerPhase = 0.0
    for (i in 0 until numSamples) {
        phase1 += 2.0 * PI * 523.0 / GACHA_SAMPLE_RATE
        phase2 += 2.0 * PI * 659.0 / GACHA_SAMPLE_RATE
        phase3 += 2.0 * PI * 784.0 / GACHA_SAMPLE_RATE
        shimmerPhase += 2.0 * PI * 8.0 / GACHA_SAMPLE_RATE
        val envelope =
            if (i < attackSamples) {
                val at = i.toFloat() / attackSamples
                (sin(at * PI / 2) * sin(at * PI / 2)).toFloat()
            } else {
                val dt = (i - attackSamples).toFloat() / (numSamples - attackSamples)
                (1f - dt * 0.7f)
            }
        val shimmer = 1.0 + 0.15 * sin(shimmerPhase)
        val value = (sin(phase1) + sin(phase2) + sin(phase3)) / 3.0 * amplitude * envelope * shimmer
        samples[i] = value.toShortSample()
    }
    return samples
}

/** EPIC (2000-9999 coins): A4+C#5+E5 + sub-bass 80 Hz, 800 ms. */
private fun generateWinEpic(): ShortArray {
    val durationMs = 800
    val numSamples = GACHA_SAMPLE_RATE * durationMs / 1000
    val samples = ShortArray(numSamples)
    val amplitude = 0.30f
    val attackSamples = GACHA_SAMPLE_RATE * 30 / 1000

    var phase1 = 0.0
    var phase2 = 0.0
    var phase3 = 0.0
    var subPhase = 0.0
    for (i in 0 until numSamples) {
        phase1 += 2.0 * PI * 440.0 / GACHA_SAMPLE_RATE
        phase2 += 2.0 * PI * 554.0 / GACHA_SAMPLE_RATE
        phase3 += 2.0 * PI * 659.0 / GACHA_SAMPLE_RATE
        subPhase += 2.0 * PI * 80.0 / GACHA_SAMPLE_RATE
        val envelope =
            if (i < attackSamples) {
                val at = i.toFloat() / attackSamples
                (sin(at * PI / 2) * sin(at * PI / 2)).toFloat()
            } else {
                val dt = (i - attackSamples).toFloat() / (numSamples - attackSamples)
                (1f - dt * 0.5f)
            }
        val chord = (sin(phase1) + sin(phase2) + sin(phase3)) / 3.0
        val sub = sin(subPhase) * 0.3
        val value = (chord + sub) * amplitude * envelope / 1.3
        samples[i] = value.toShortSample()
    }
    return samples
}

/** LEGENDARY (10000+ coins): 5-note chord + chirp overlay, 1200 ms. */
private fun generateWinLegendary(): ShortArray {
    val durationMs = 1200
    val numSamples = GACHA_SAMPLE_RATE * durationMs / 1000
    val samples = ShortArray(numSamples)
    val amplitude = 0.30f
    val attackSamples = GACHA_SAMPLE_RATE * 40 / 1000

    var p1 = 0.0
    var p2 = 0.0
    var p3 = 0.0
    var p4 = 0.0
    var p5 = 0.0
    var chirpPhase = 0.0
    for (i in 0 until numSamples) {
        p1 += 2.0 * PI * 220.0 / GACHA_SAMPLE_RATE
        p2 += 2.0 * PI * 440.0 / GACHA_SAMPLE_RATE
        p3 += 2.0 * PI * 550.0 / GACHA_SAMPLE_RATE
        p4 += 2.0 * PI * 660.0 / GACHA_SAMPLE_RATE
        p5 += 2.0 * PI * 880.0 / GACHA_SAMPLE_RATE
        val t = i.toFloat() / numSamples
        val chirpFreq = 880.0 + 1760.0 * t
        chirpPhase += 2.0 * PI * chirpFreq / GACHA_SAMPLE_RATE
        val envelope =
            if (i < attackSamples) {
                val at = i.toFloat() / attackSamples
                (sin(at * PI / 2) * sin(at * PI / 2)).toFloat()
            } else {
                val dt = (i - attackSamples).toFloat() / (numSamples - attackSamples)
                (1f - dt * 0.4f)
            }
        val chord = (sin(p1) + sin(p2) + sin(p3) + sin(p4) + sin(p5)) / 5.0
        val chirp = sin(chirpPhase) * 0.15 * (1.0 - t)
        val value = (chord + chirp) * amplitude * envelope / 1.15
        samples[i] = value.toShortSample()
    }
    return samples
}

/** High-tier fanfare: dramatic ascending arpeggio C-E-G-C with layered harmonics, 1800 ms. */
fun generateHighTierFanfare(): ShortArray {
    val durationMs = 1800
    val numSamples = GACHA_SAMPLE_RATE * durationMs / 1000
    val samples = ShortArray(numSamples)
    val amplitude = 0.32f

    val notes = doubleArrayOf(261.6, 329.6, 392.0, 523.3)
    val noteOnsets = intArrayOf(0, (numSamples * 0.18).toInt(), (numSamples * 0.36).toInt(), (numSamples * 0.52).toInt())
    val noteDuration = (numSamples * 0.55)

    var subPhase = 0.0
    var shimmerPhase = 0.0

    val phases = DoubleArray(notes.size)
    val octavePhases = DoubleArray(notes.size)

    for (i in 0 until numSamples) {
        val t = i.toFloat() / numSamples
        var value = 0.0

        subPhase += 2.0 * PI * 60.0 / GACHA_SAMPLE_RATE
        val subEnv =
            if (i < GACHA_SAMPLE_RATE * 400 / 1000) {
                exp(-4.0 * i.toDouble() / (GACHA_SAMPLE_RATE * 400 / 1000))
            } else {
                0.0
            }
        value += sin(subPhase) * 0.25 * subEnv

        for (n in notes.indices) {
            val onset = noteOnsets[n]
            if (i < onset) continue
            val noteT = (i - onset).toDouble()
            if (noteT > noteDuration) continue

            phases[n] += 2.0 * PI * notes[n] / GACHA_SAMPLE_RATE
            octavePhases[n] += 2.0 * PI * notes[n] * 2.0 / GACHA_SAMPLE_RATE

            val attackSamp = GACHA_SAMPLE_RATE * 20 / 1000
            val noteEnv =
                if (noteT < attackSamp) {
                    val at = noteT / attackSamp
                    sin(at * PI / 2) * sin(at * PI / 2)
                } else {
                    val dt = (noteT - attackSamp) / (noteDuration - attackSamp)
                    1.0 - dt * 0.6
                }

            value += (sin(phases[n]) * 0.7 + sin(octavePhases[n]) * 0.3) * noteEnv / notes.size
        }

        shimmerPhase += 2.0 * PI * 6.0 / GACHA_SAMPLE_RATE
        val shimmer = 1.0 + 0.12 * sin(shimmerPhase) * t

        val globalEnv =
            if (i < GACHA_SAMPLE_RATE * 30 / 1000) {
                val at = i.toFloat() / (GACHA_SAMPLE_RATE * 30 / 1000)
                sin(at * PI / 2) * sin(at * PI / 2)
            } else if (t > 0.85) {
                val dt = (t - 0.85) / 0.15
                (1.0 - dt * dt)
            } else {
                1.0
            }

        val sample = value * amplitude * shimmer * globalEnv
        samples[i] = sample.toShortSample()
    }
    return samples
}

/** Two sequential dings: 880 Hz then 1108 Hz, 330 ms total. */
fun generateCoinPurchase(): ShortArray {
    val durationMs = 330
    val numSamples = GACHA_SAMPLE_RATE * durationMs / 1000
    val samples = ShortArray(numSamples)
    val amplitude = 0.28f
    val halfSamples = numSamples / 2

    var phase = 0.0
    for (i in 0 until numSamples) {
        val freq = if (i < halfSamples) 880.0 else 1108.0
        if (i == halfSamples) phase = 0.0
        phase += 2.0 * PI * freq / GACHA_SAMPLE_RATE
        val localT =
            if (i < halfSamples) {
                i.toFloat() / halfSamples
            } else {
                (i - halfSamples).toFloat() / (numSamples - halfSamples)
            }
        val envelope = exp(-3.0 * localT).toFloat()
        samples[i] = (sin(phase) * amplitude * envelope).toShortSample()
    }
    return samples
}

private fun Double.toShortSample(): Short =
    (this * Short.MAX_VALUE).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
