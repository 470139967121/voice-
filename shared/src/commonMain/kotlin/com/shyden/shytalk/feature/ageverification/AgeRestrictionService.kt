package com.shyden.shytalk.feature.ageverification

import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.calculateAge

/**
 * Tristate result of an age-restriction check. Used by ViewModels to
 * decide what UI to surface when a user attempts to enter the gated
 * features (private messages, gacha).
 *
 * - [Allowed] — user has full access. Either admin-verified, or pre-
 *   feature account that PR 11's migration will revisit.
 * - [NeedsVerification] — 18+ on DOB but not yet verified. UI shows a
 *   modal that prompts the user to submit an ID image (the flow
 *   shipped in PRs 4a / 4b / 9).
 * - [SubEighteen] — under 18 on DOB. The user CANNOT enter the
 *   verification flow until they age in. UI shows the
 *   "Contact support if you believe this is wrong" copy.
 */
enum class AgeRestrictionState {
    Allowed,
    NeedsVerification,
    SubEighteen,
    ;

    /** True for the two restricted states; false for [Allowed]. */
    val isBlocked: Boolean get() = this != Allowed
}

/**
 * Pure-logic service deciding [AgeRestrictionState] for a [User].
 *
 * The two `check*Access` methods exist as a clarity surface — both
 * currently return the same state, but a future product change (e.g.
 * gacha unlocked at a different threshold than PMs) only needs to
 * adjust one method. Keeping them separate now means the call sites
 * already discriminate correctly.
 */
class AgeRestrictionService {
    fun checkPmAccess(user: User): AgeRestrictionState = computeState(user)

    fun checkGachaAccess(user: User): AgeRestrictionState = computeState(user)

    private fun computeState(user: User): AgeRestrictionState {
        // Server-side `ageVerified` flag wins. It's only ever set by
        // the admin approval flow (PR 4b) and is the single source of
        // truth for full access. PR 11's migration handles the case
        // where a verified flag becomes incorrect (e.g. admin runs
        // modify-DOB and the new DOB is < 18 — that path resets the
        // flag in the same transaction).
        if (user.ageVerified) return AgeRestrictionState.Allowed

        // No DOB on file → cannot enter the verification flow because
        // the flow requires a DOB. Treat as SubEighteen (most
        // restrictive) so the UI surfaces "contact support".
        val dob = user.dateOfBirth ?: return AgeRestrictionState.SubEighteen

        return if (calculateAge(dob) >= MINIMUM_RESTRICTED_AGE) {
            AgeRestrictionState.NeedsVerification
        } else {
            AgeRestrictionState.SubEighteen
        }
    }

    companion object {
        /**
         * The age at which a user becomes eligible to *attempt*
         * verification. Apple App Store guideline target is 18+ for
         * the gated features; this constant is the boundary between
         * the SubEighteen ("contact support") cohort and the
         * NeedsVerification ("submit your ID") cohort.
         */
        const val MINIMUM_RESTRICTED_AGE: Int = 18
    }
}
