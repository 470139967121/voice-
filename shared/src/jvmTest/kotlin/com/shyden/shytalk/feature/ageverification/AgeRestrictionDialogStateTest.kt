package com.shyden.shytalk.feature.ageverification

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Pure-state transition tests. The [AgeRestrictionDialog] Composable
 * is rendered against this state by the host screen; the conversion
 * function pinned here is what VMs use to decide whether to show the
 * dialog when an entry-point method fires.
 */
class AgeRestrictionDialogStateTest {
    @Test
    fun `Hidden is the default and is not visible`() {
        assertEquals(AgeRestrictionDialogState.Hidden, AgeRestrictionDialogState.Hidden)
        assertFalse(AgeRestrictionDialogState.Hidden.isVisible)
    }

    @Test
    fun `NeedsVerification and SubEighteen are visible`() {
        assertTrue(AgeRestrictionDialogState.NeedsVerification.isVisible)
        assertTrue(AgeRestrictionDialogState.SubEighteen.isVisible)
    }

    @Test
    fun `showOnBlocked maps Allowed to Hidden`() {
        // The host VM only calls showOnBlocked when an entry-point
        // method fires AND the user is restricted. But mapping
        // Allowed → Hidden defensively means a defensive call site
        // can't accidentally show a dialog for a fully-allowed user.
        assertEquals(
            AgeRestrictionDialogState.Hidden,
            AgeRestrictionDialogState.showOnBlocked(AgeRestrictionState.Allowed),
        )
    }

    @Test
    fun `showOnBlocked maps NeedsVerification to NeedsVerification`() {
        assertEquals(
            AgeRestrictionDialogState.NeedsVerification,
            AgeRestrictionDialogState.showOnBlocked(AgeRestrictionState.NeedsVerification),
        )
    }

    @Test
    fun `showOnBlocked maps SubEighteen to SubEighteen`() {
        assertEquals(
            AgeRestrictionDialogState.SubEighteen,
            AgeRestrictionDialogState.showOnBlocked(AgeRestrictionState.SubEighteen),
        )
    }

    @Test
    fun `showOnBlocked is exhaustive across all AgeRestrictionState values`() {
        // Pin that every enum value has a case so a future addition
        // (say, AgeRestrictionState.Suspended) trips this test rather
        // than silently defaulting to Hidden.
        AgeRestrictionState.entries.forEach { state ->
            val dialogState = AgeRestrictionDialogState.showOnBlocked(state)
            assertEquals(state.isBlocked, dialogState.isVisible)
        }
    }
}
