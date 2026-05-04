package com.shyden.shytalk.feature.ageverification

/**
 * Pure state for the age-restriction dialog. ViewModels expose this as
 * a `StateFlow<AgeRestrictionDialogState>` and the screen's Composable
 * watches it to decide whether to render [AgeRestrictionDialog].
 *
 * The conversion from [AgeRestrictionState] (pure restriction logic)
 * to [AgeRestrictionDialogState] (UI presence) lives here so the
 * dialog rendering and the restriction-check call sites remain
 * decoupled — a VM can hold an [AgeRestrictionState] in one flow and
 * transform it via [showOnBlocked] only when an entry-point method
 * actually fires (otherwise the dialog never appears even if the user
 * is restricted).
 */
sealed interface AgeRestrictionDialogState {
    /** Dialog not visible. The user has either not attempted a gated action, or they are [AgeRestrictionState.Allowed]. */
    data object Hidden : AgeRestrictionDialogState

    /** Dialog visible in the "submit your ID" mode (user is 18+ but unverified). */
    data object NeedsVerification : AgeRestrictionDialogState

    /** Dialog visible in the "contact support" mode (user is sub-18 or has no DOB on file). */
    data object SubEighteen : AgeRestrictionDialogState

    val isVisible: Boolean get() = this != Hidden

    companion object {
        /**
         * Maps an [AgeRestrictionState] to the dialog state to show
         * when the user TRIES to use a gated feature. [Allowed] users
         * never see the dialog — the entry-point method should
         * proceed normally instead of calling this.
         */
        fun showOnBlocked(state: AgeRestrictionState): AgeRestrictionDialogState =
            when (state) {
                AgeRestrictionState.Allowed -> Hidden
                AgeRestrictionState.NeedsVerification -> NeedsVerification
                AgeRestrictionState.SubEighteen -> SubEighteen
            }
    }
}
