package com.shyden.shytalk.core.audio

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/**
 * Tests for procedural gacha sound generators in commonMain.
 * The same generator code drives both the Android AudioTrack
 * and iOS AVAudioEngine playback paths, so we cover sample
 * counts, value ranges, and the coin-tier mapping here.
 */
class GachaSoundSamplesTest {
    @Test
    fun `tier mapping at boundaries`() {
        assertEquals(GachaSoundTier.COMMON, gachaSoundTierForCoinValue(0))
        assertEquals(GachaSoundTier.COMMON, gachaSoundTierForCoinValue(49))
        assertEquals(GachaSoundTier.UNCOMMON, gachaSoundTierForCoinValue(50))
        assertEquals(GachaSoundTier.UNCOMMON, gachaSoundTierForCoinValue(199))
        assertEquals(GachaSoundTier.RARE, gachaSoundTierForCoinValue(200))
        assertEquals(GachaSoundTier.RARE, gachaSoundTierForCoinValue(1999))
        assertEquals(GachaSoundTier.EPIC, gachaSoundTierForCoinValue(2000))
        assertEquals(GachaSoundTier.EPIC, gachaSoundTierForCoinValue(9999))
        assertEquals(GachaSoundTier.LEGENDARY, gachaSoundTierForCoinValue(10000))
        assertEquals(GachaSoundTier.LEGENDARY, gachaSoundTierForCoinValue(1_000_000))
    }

    @Test
    fun `spinStart sample count matches 420ms at 44_1kHz`() {
        assertEquals(GACHA_SAMPLE_RATE * 420 / 1000, generateSpinStart().size)
    }

    @Test
    fun `tick sample count matches 28ms`() {
        assertEquals(GACHA_SAMPLE_RATE * 28 / 1000, generateTick(0).size)
        assertEquals(GACHA_SAMPLE_RATE * 28 / 1000, generateTick(7).size)
    }

    @Test
    fun `blinkClick sample count matches 22ms`() {
        assertEquals(GACHA_SAMPLE_RATE * 22 / 1000, generateBlinkClick().size)
    }

    @Test
    fun `coinPurchase sample count matches 330ms`() {
        assertEquals(GACHA_SAMPLE_RATE * 330 / 1000, generateCoinPurchase().size)
    }

    @Test
    fun `highTierFanfare sample count matches 1800ms`() {
        assertEquals(GACHA_SAMPLE_RATE * 1800 / 1000, generateHighTierFanfare().size)
    }

    @Test
    fun `winReveal sample counts grow with tier`() {
        val common = generateWinReveal(GachaSoundTier.COMMON).size
        val uncommon = generateWinReveal(GachaSoundTier.UNCOMMON).size
        val rare = generateWinReveal(GachaSoundTier.RARE).size
        val epic = generateWinReveal(GachaSoundTier.EPIC).size
        val legendary = generateWinReveal(GachaSoundTier.LEGENDARY).size

        assertEquals(GACHA_SAMPLE_RATE * 280 / 1000, common)
        assertEquals(GACHA_SAMPLE_RATE * 420 / 1000, uncommon)
        assertEquals(GACHA_SAMPLE_RATE * 600 / 1000, rare)
        assertEquals(GACHA_SAMPLE_RATE * 800 / 1000, epic)
        assertEquals(GACHA_SAMPLE_RATE * 1200 / 1000, legendary)

        assertTrue(common < uncommon)
        assertTrue(uncommon < rare)
        assertTrue(rare < epic)
        assertTrue(epic < legendary)
    }

    @Test
    fun `tick generators produce different bands`() {
        // Different bands should produce different sample data —
        // proves the band parameter actually changes frequency.
        val band0 = generateTick(0)
        val band7 = generateTick(7)
        assertEquals(band0.size, band7.size)
        // Find at least one differing sample
        var diff = false
        for (i in band0.indices) {
            if (band0[i] != band7[i]) {
                diff = true
                break
            }
        }
        assertTrue(diff, "bands 0 and 7 should produce distinct samples")
    }

    @Test
    fun `samples stay within Short range`() {
        val sounds =
            listOf(
                generateSpinStart(),
                generateBlinkClick(),
                generateCoinPurchase(),
                generateHighTierFanfare(),
                generateWinReveal(GachaSoundTier.LEGENDARY),
                generateTick(3),
            )
        sounds.forEach { samples ->
            samples.forEach { s ->
                assertTrue(s >= Short.MIN_VALUE)
                assertTrue(s <= Short.MAX_VALUE)
            }
        }
    }

    @Test
    fun `samples are not all silent`() {
        val sounds =
            listOf(
                "spinStart" to generateSpinStart(),
                "blinkClick" to generateBlinkClick(),
                "coinPurchase" to generateCoinPurchase(),
                "highTierFanfare" to generateHighTierFanfare(),
                "tick" to generateTick(4),
                "winLegendary" to generateWinReveal(GachaSoundTier.LEGENDARY),
            )
        sounds.forEach { (name, samples) ->
            val nonZero = samples.count { it.toInt() != 0 }
            assertTrue(
                nonZero > samples.size / 4,
                "$name has ${samples.size - nonZero} silent samples out of ${samples.size}",
            )
        }
    }

    @Test
    fun `total PCM buffer size remains under 600KB`() {
        val bytesPerSample = 2 // int16 PCM
        val totalSamples =
            generateSpinStart().size +
                generateBlinkClick().size +
                generateCoinPurchase().size +
                generateHighTierFanfare().size +
                (0 until 8).sumOf { generateTick(it).size } +
                GachaSoundTier.entries.sumOf { generateWinReveal(it).size }

        val totalBytes = totalSamples * bytesPerSample
        assertTrue(
            totalBytes < 600_000,
            "Total PCM buffer size $totalBytes bytes exceeds 600KB budget",
        )
    }

    @Test
    fun `spinStart starts and ends close to silence`() {
        val samples = generateSpinStart()
        // First sample should be near silence (cos² attack starts at 0)
        assertEquals(0, samples.first().toInt())
        // Last sample should be near silence (cos² decay ends at 0)
        assertTrue(kotlin.math.abs(samples.last().toInt()) < 1000)
    }

    @Test
    fun `coinPurchase has two distinct dings via frequency switch`() {
        val samples = generateCoinPurchase()
        // The frequency change happens at halfSamples — exact peak amplitude
        // shouldn't be at the boundary. We just verify both halves contain
        // non-zero data so each ding actually plays.
        val half = samples.size / 2
        val firstHalfNonZero = (0 until half).count { samples[it].toInt() != 0 }
        val secondHalfNonZero = (half until samples.size).count { samples[it].toInt() != 0 }
        assertTrue(firstHalfNonZero > half / 2, "first ding mostly silent")
        assertTrue(secondHalfNonZero > half / 2, "second ding mostly silent")
    }

    @Test
    fun `tier ordering matches enum declaration`() {
        // entries order is the declaration order — playback maps coin
        // value to tier and we depend on this for sound selection
        assertEquals(
            listOf(
                GachaSoundTier.COMMON,
                GachaSoundTier.UNCOMMON,
                GachaSoundTier.RARE,
                GachaSoundTier.EPIC,
                GachaSoundTier.LEGENDARY,
            ),
            GachaSoundTier.entries,
        )
    }

    @Test
    fun `different tiers produce different win reveal data`() {
        val common = generateWinReveal(GachaSoundTier.COMMON)
        val legendary = generateWinReveal(GachaSoundTier.LEGENDARY)
        // Different lengths obviously, but the early samples should also
        // differ because legendary uses a different chord stack.
        val sharedLen = minOf(common.size, legendary.size)
        var differs = false
        for (i in 0 until sharedLen) {
            if (common[i] != legendary[i]) {
                differs = true
                break
            }
        }
        assertTrue(differs, "common and legendary win reveals should differ")
        assertNotEquals(common.size, legendary.size, "tier sample counts should differ")
    }
}
