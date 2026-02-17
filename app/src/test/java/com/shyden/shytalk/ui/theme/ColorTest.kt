package com.shyden.shytalk.ui.theme

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class ColorTest {

    @Test
    fun `CnyGold has correct hex value`() {
        assertEquals(Color(0xFFF0C246), CnyGold)
    }

    @Test
    fun `SpeakingGreen has correct hex value`() {
        assertEquals(Color(0xFF4CAF50), SpeakingGreen)
    }

    @Test
    fun `light theme primary is CNY red`() {
        assertEquals(Color(0xFFC62828), ShyTalkPrimary)
    }

    @Test
    fun `light theme tertiary is CNY gold accent`() {
        assertEquals(Color(0xFFC9973A), ShyTalkTertiary)
    }

    @Test
    fun `dark theme tertiary is brighter gold`() {
        assertEquals(Color(0xFFF0C246), ShyTalkTertiaryDark)
    }

    @Test
    fun `dark theme primary container is deep red`() {
        assertEquals(Color(0xFF930009), ShyTalkPrimaryContainerDark)
    }

    @Test
    fun `CnyGold is fully opaque`() {
        assertEquals(1f, CnyGold.alpha)
    }

    @Test
    fun `light and dark primaries are distinct`() {
        assertNotEquals(ShyTalkPrimary, ShyTalkPrimaryDark)
    }
}
