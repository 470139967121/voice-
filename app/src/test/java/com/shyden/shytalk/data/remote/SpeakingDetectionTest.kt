package com.shyden.shytalk.data.remote

import io.agora.rtc2.IRtcEngineEventHandler.AudioVolumeInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests the speaking detection logic in AgoraVoiceService.processSpeakers().
 * Verifies that both local and remote users are correctly detected as speaking,
 * using separate volume thresholds for local mic vs remote decoded audio.
 */
class SpeakingDetectionTest {

    private val localUid = 1001
    private val remoteUid1 = 2001
    private val remoteUid2 = 3001

    private fun speaker(uid: Int, volume: Int): AudioVolumeInfo {
        val info = AudioVolumeInfo()
        info.uid = uid
        info.volume = volume
        info.vad = if (volume > 0) 1 else 0
        return info
    }

    // --- Basic detection ---

    @Test
    fun `local user speaking above local threshold is detected`() {
        val speakers = arrayOf(speaker(0, 80))
        val result = AgoraVoiceService.processSpeakers(
            speakers, localUid, isLocalMuted = false,
            localThreshold = 50, remoteThreshold = 10
        )
        assertTrue(localUid in result)
    }

    @Test
    fun `remote user speaking above remote threshold is detected`() {
        val speakers = arrayOf(speaker(remoteUid1, 25))
        val result = AgoraVoiceService.processSpeakers(
            speakers, localUid, isLocalMuted = false,
            localThreshold = 50, remoteThreshold = 10
        )
        assertTrue(remoteUid1 in result)
    }

    @Test
    fun `both local and remote users detected simultaneously`() {
        val speakers = arrayOf(
            speaker(0, 80),       // local above local threshold
            speaker(remoteUid1, 25)  // remote above remote threshold
        )
        val result = AgoraVoiceService.processSpeakers(
            speakers, localUid, isLocalMuted = false,
            localThreshold = 50, remoteThreshold = 10
        )
        assertEquals(setOf(localUid, remoteUid1), result)
    }

    @Test
    fun `multiple remote users detected simultaneously`() {
        val speakers = arrayOf(
            speaker(0, 80),
            speaker(remoteUid1, 25),
            speaker(remoteUid2, 15)
        )
        val result = AgoraVoiceService.processSpeakers(
            speakers, localUid, isLocalMuted = false,
            localThreshold = 50, remoteThreshold = 10
        )
        assertEquals(setOf(localUid, remoteUid1, remoteUid2), result)
    }

    // --- Threshold boundaries ---

    @Test
    fun `local user below local threshold is not detected`() {
        val speakers = arrayOf(speaker(0, 30))
        val result = AgoraVoiceService.processSpeakers(
            speakers, localUid, isLocalMuted = false,
            localThreshold = 50, remoteThreshold = 10
        )
        assertFalse(localUid in result)
    }

    @Test
    fun `remote user below remote threshold is not detected`() {
        val speakers = arrayOf(speaker(remoteUid1, 5))
        val result = AgoraVoiceService.processSpeakers(
            speakers, localUid, isLocalMuted = false,
            localThreshold = 50, remoteThreshold = 10
        )
        assertFalse(remoteUid1 in result)
    }

    @Test
    fun `remote user between remote and local thresholds IS detected`() {
        // This is the key regression test: remote users with volume 10-50
        // must be detected even though they'd fail the old single-threshold check
        val speakers = arrayOf(speaker(remoteUid1, 30))
        val result = AgoraVoiceService.processSpeakers(
            speakers, localUid, isLocalMuted = false,
            localThreshold = 50, remoteThreshold = 10
        )
        assertTrue("Remote user with volume 30 should be detected with threshold 10", remoteUid1 in result)
    }

    @Test
    fun `remote user at exact remote threshold is not detected`() {
        val speakers = arrayOf(speaker(remoteUid1, 10))
        val result = AgoraVoiceService.processSpeakers(
            speakers, localUid, isLocalMuted = false,
            localThreshold = 50, remoteThreshold = 10
        )
        assertFalse(remoteUid1 in result)
    }

    @Test
    fun `remote user just above remote threshold is detected`() {
        val speakers = arrayOf(speaker(remoteUid1, 11))
        val result = AgoraVoiceService.processSpeakers(
            speakers, localUid, isLocalMuted = false,
            localThreshold = 50, remoteThreshold = 10
        )
        assertTrue(remoteUid1 in result)
    }

    // --- Mute handling ---

    @Test
    fun `local user is excluded when muted`() {
        val speakers = arrayOf(speaker(0, 80))
        val result = AgoraVoiceService.processSpeakers(
            speakers, localUid, isLocalMuted = true,
            localThreshold = 50, remoteThreshold = 10
        )
        assertFalse(localUid in result)
    }

    @Test
    fun `remote users are still detected when local is muted`() {
        val speakers = arrayOf(
            speaker(0, 80),
            speaker(remoteUid1, 25)
        )
        val result = AgoraVoiceService.processSpeakers(
            speakers, localUid, isLocalMuted = true,
            localThreshold = 50, remoteThreshold = 10
        )
        assertFalse(localUid in result)
        assertTrue(remoteUid1 in result)
    }

    // --- Muted seat regression (UI layer) ---

    @Test
    fun `muted local user with high volume is excluded from speaking set`() {
        // Regression: Agora reports mic volume even when muteLocalAudioStream is active.
        // processSpeakers must exclude the local user when isLocalMuted is true,
        // regardless of how loud the captured volume is.
        val speakers = arrayOf(speaker(0, 255)) // max volume
        val result = AgoraVoiceService.processSpeakers(
            speakers, localUid, isLocalMuted = true,
            localThreshold = 50, remoteThreshold = 10
        )
        assertTrue("Muted local user must never appear in speaking set", result.isEmpty())
    }

    // --- Edge cases ---

    @Test
    fun `null speakers returns empty set`() {
        val result = AgoraVoiceService.processSpeakers(
            null, localUid, isLocalMuted = false
        )
        assertTrue(result.isEmpty())
    }

    @Test
    fun `empty speakers array returns empty set`() {
        val result = AgoraVoiceService.processSpeakers(
            emptyArray(), localUid, isLocalMuted = false
        )
        assertTrue(result.isEmpty())
    }

    @Test
    fun `local uid 0 is mapped to actual local uid`() {
        val speakers = arrayOf(speaker(0, 80))
        val result = AgoraVoiceService.processSpeakers(
            speakers, localUid = 9999, isLocalMuted = false,
            localThreshold = 50, remoteThreshold = 10
        )
        assertTrue(9999 in result)
        assertFalse(0 in result)
    }
}
