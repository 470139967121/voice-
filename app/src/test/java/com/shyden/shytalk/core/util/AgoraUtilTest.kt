package com.shyden.shytalk.core.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AgoraUtilTest {

    @Test
    fun `toAgoraUid returns positive value`() {
        val uid = "test-user-id".toAgoraUid()
        assertTrue("UID should be positive, was $uid", uid >= 0)
    }

    @Test
    fun `toAgoraUid is deterministic`() {
        val uid1 = "user-123".toAgoraUid()
        val uid2 = "user-123".toAgoraUid()
        assertEquals(uid1, uid2)
    }

    @Test
    fun `toAgoraUid differs for different inputs`() {
        val uid1 = "user-a".toAgoraUid()
        val uid2 = "user-b".toAgoraUid()
        assertTrue("UIDs should differ for different inputs", uid1 != uid2)
    }

    @Test
    fun `toAgoraUid handles empty string`() {
        val uid = "".toAgoraUid()
        assertTrue("UID should be non-negative, was $uid", uid >= 0)
    }

    @Test
    fun `toAgoraUid masks negative hashCode to positive`() {
        // Find a string with negative hashCode to ensure masking works
        val negativeHashString = "test" // hashCode may be negative
        val uid = negativeHashString.toAgoraUid()
        assertTrue("UID should be non-negative even for negative hashCode, was $uid", uid >= 0)
    }

    @Test
    fun `toAgoraUid matches manual hashCode and mask`() {
        val input = "some-user-id"
        val expected = input.hashCode() and 0x7FFFFFFF
        assertEquals(expected, input.toAgoraUid())
    }
}
