package com.shyden.shytalk.core.util

import org.junit.Test

class LoggerTest {
    @Test
    fun `logD does not throw`() {
        logD("Test", "debug message")
    }

    @Test
    fun `logI does not throw`() {
        logI("Test", "info message")
    }

    @Test
    fun `logW does not throw`() {
        logW("Test", "warning message")
    }

    @Test
    fun `logW with throwable does not throw`() {
        logW("Test", "warning", RuntimeException("test"))
    }

    @Test
    fun `logE does not throw`() {
        logE("Test", "error message")
    }

    @Test
    fun `logF does not throw`() {
        logF("Test", "fatal message")
    }
}
