package com.shyden.shytalk.feature.suspension

import org.junit.Assert.assertEquals
import org.junit.Test

class BanScreenTest {

    @Test
    fun `banTitle returns Device Banned for device type`() {
        assertEquals("Device Banned", banTitle("device"))
    }

    @Test
    fun `banTitle returns Network Banned for non-device type`() {
        assertEquals("Network Banned", banTitle("network_ip"))
        assertEquals("Network Banned", banTitle("network_asn"))
        assertEquals("Network Banned", banTitle("network_subnet"))
    }

    @Test
    fun `banDescription returns device message for device type`() {
        val desc = banDescription("device")
        assertEquals("This device has been banned from using ShyTalk.", desc)
    }

    @Test
    fun `banDescription returns network message for non-device type`() {
        val desc = banDescription("network_ip")
        assertEquals(
            "Your network has been banned from using ShyTalk. Try connecting from a different network.",
            desc
        )
    }
}
