package com.shyden.shytalk.core.audio

import kotlin.test.Test
import kotlin.test.assertFalse

class PlatformTtsTest {
    @Test
    fun `speak does not throw on jvm`() {
        PlatformTts.speak("test message", "test-id")
    }

    @Test
    fun `stop does not throw on jvm`() {
        PlatformTts.stop()
    }

    @Test
    fun `release does not throw on jvm`() {
        PlatformTts.release()
    }

    @Test
    fun `isInitialized returns false on jvm`() {
        assertFalse(PlatformTts.isInitialized)
    }

    @Test
    fun `speak then stop does not throw`() {
        PlatformTts.speak("Room self destruct sequence activated.", "self_destruct")
        PlatformTts.stop()
    }

    @Test
    fun `release then speak does not throw`() {
        PlatformTts.release()
        PlatformTts.speak("Should be no-op after release", "post-release")
    }
}
