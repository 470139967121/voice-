package com.shyden.shytalk.feature.ageverification

import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.calculateAge
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Tests for [AgeRestrictionService]. The service decides whether a
 * user is allowed to access the 18+ gated features (private messages,
 * gacha) based on their `ageVerified` flag and `dateOfBirth`.
 *
 * Three outcomes:
 *   - [AgeRestrictionState.Allowed] — verified, OR account predates
 *     the verification feature and is grand-fathered (separate
 *     handling in PR 11 migration; this service treats them as
 *     unverified).
 *   - [AgeRestrictionState.NeedsVerification] — unverified, 18+ on
 *     DOB. The UI should show the "verify your age" modal that lets
 *     them submit an ID.
 *   - [AgeRestrictionState.SubEighteen] — unverified, <18 on DOB.
 *     The UI should show the "Contact support if this is wrong" copy.
 *     They cannot enter the verification flow until they age in.
 */
class AgeRestrictionServiceTest {
    private val service = AgeRestrictionService()

    private fun userOfAge(
        years: Int,
        ageVerified: Boolean = false,
    ): User {
        // Use a DOB that's `years` ago plus 7 days so the test is
        // safely past the calendar boundary regardless of leap-year
        // drift.
        val msPerDay = 86400_000L
        val approxYearMs = (365.25 * msPerDay).toLong()
        val dob = System.currentTimeMillis() - (years.toLong() * approxYearMs) - (7L * msPerDay)
        return User(uid = "u1", dateOfBirth = dob, ageVerified = ageVerified)
    }

    // ── Verified users ────────────────────────────────────────────

    @Test
    fun `verified user is Allowed regardless of DOB`() {
        // Once an admin approves, the service short-circuits to
        // Allowed. This means even if the DOB on file is wrong (admin
        // hasn't yet noticed via modify-dob), a verified-flag user
        // can use the gated features. PR 11's migration is the place
        // that flips a wrongly-verified user back if DOB review
        // surfaces the issue.
        val verified25 = userOfAge(25, ageVerified = true)
        assertEquals(AgeRestrictionState.Allowed, service.checkPmAccess(verified25))
        assertEquals(AgeRestrictionState.Allowed, service.checkGachaAccess(verified25))
    }

    @Test
    fun `verified user with sub-18 DOB is still Allowed (admin-flag wins)`() {
        // The verified flag is server-set; if it's true with a sub-18
        // DOB, the assumption is admin chose to verify (e.g. the ID
        // showed an older DOB and they haven't yet run modify-dob).
        // We trust the server flag until PR 11 reconciles.
        val oddCase = userOfAge(16, ageVerified = true)
        assertEquals(AgeRestrictionState.Allowed, service.checkPmAccess(oddCase))
    }

    // ── Unverified 18+ users (can verify) ─────────────────────────

    @Test
    fun `unverified 18+ user gets NeedsVerification for both PMs and gacha`() {
        val eighteenPlus = userOfAge(20, ageVerified = false)
        assertEquals(AgeRestrictionState.NeedsVerification, service.checkPmAccess(eighteenPlus))
        assertEquals(AgeRestrictionState.NeedsVerification, service.checkGachaAccess(eighteenPlus))
    }

    @Test
    fun `unverified user exactly 18 today gets NeedsVerification (boundary)`() {
        // Exactly at the boundary the calendar-aware `calculateAge`
        // returns 18, which is >= 18, so the user should be eligible
        // to verify.
        val today = userOfAge(18, ageVerified = false)
        assertTrue(calculateAge(today.dateOfBirth!!) >= 18)
        assertEquals(AgeRestrictionState.NeedsVerification, service.checkPmAccess(today))
    }

    // ── Unverified <18 users (cannot verify, must contact support) ──

    @Test
    fun `unverified 16-y-o user gets SubEighteen for both gates`() {
        val sixteen = userOfAge(16, ageVerified = false)
        assertEquals(AgeRestrictionState.SubEighteen, service.checkPmAccess(sixteen))
        assertEquals(AgeRestrictionState.SubEighteen, service.checkGachaAccess(sixteen))
    }

    @Test
    fun `unverified 17-y-o user gets SubEighteen`() {
        val seventeen = userOfAge(17, ageVerified = false)
        assertEquals(AgeRestrictionState.SubEighteen, service.checkPmAccess(seventeen))
    }

    // ── Edge case: missing DOB ────────────────────────────────────

    @Test
    fun `unverified user with null DOB is treated as SubEighteen (cannot verify)`() {
        // No DOB on file means we have no way to check 18+. Default to
        // the conservative state — the user cannot enter the
        // verification flow because the flow requires a DOB on the
        // user doc. They should contact support to add a DOB before
        // attempting verification.
        val noDob = User(uid = "u1", dateOfBirth = null, ageVerified = false)
        assertEquals(AgeRestrictionState.SubEighteen, service.checkPmAccess(noDob))
    }

    @Test
    fun `verified user with null DOB is still Allowed (admin override)`() {
        // Defensive: an admin-verified flag with no DOB is unusual but
        // the verified flag still wins. This shouldn't happen in
        // practice (the verification flow records DOB) but pin the
        // contract.
        val verifiedNoDob = User(uid = "u1", dateOfBirth = null, ageVerified = true)
        assertEquals(AgeRestrictionState.Allowed, service.checkPmAccess(verifiedNoDob))
    }

    // ── Helper: blocking-state predicates ─────────────────────────

    @Test
    fun `isBlocked is true for both restricted states, false for Allowed`() {
        assertTrue(AgeRestrictionState.NeedsVerification.isBlocked)
        assertTrue(AgeRestrictionState.SubEighteen.isBlocked)
        assertEquals(false, AgeRestrictionState.Allowed.isBlocked)
    }
}
