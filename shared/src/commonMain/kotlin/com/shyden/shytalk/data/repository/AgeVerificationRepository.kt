package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource

/**
 * Two-step submit flow for the user-facing age-verification screen
 * (PR 9 of the multi-PR plan).
 *
 *   1. [requestUploadUrl] — server issues a 5-min signed PUT URL plus
 *      the R2 key the image will live at.
 *   2. [uploadImage] — client PUTs the bytes directly to R2.
 *   3. [submit] — server marks the submission pending; an admin reviews
 *      via the panel built in PR 6.
 *
 * Splitting the two HTTP calls keeps the API surface small and matches
 * the existing photo-upload pattern (avatars, evidence) so the same
 * Ktor client / okhttp client owns the byte transfer.
 */
interface AgeVerificationRepository {
    /**
     * Allowed values for [submit]'s `idMethod` argument. Mirrors the
     * server-side allowlist in `express-api/src/routes/age-verification.js`.
     */
    enum class IdMethod(
        val wireValue: String,
    ) {
        Passport("passport"),
        DriversLicense("drivers-license"),
        NationalId("national-id"),
    }

    /**
     * MIME types the server accepts for the ID image. Same list as the
     * R2 PUT-URL pre-check on the server.
     */
    enum class ContentType(
        val wireValue: String,
    ) {
        Jpeg("image/jpeg"),
        Png("image/png"),
        Webp("image/webp"),
    }

    data class UploadHandle(
        val uploadUrl: String,
        val r2Key: String,
        val expiresInSec: Int,
    )

    /**
     * Step 1 — ask the API for a short-lived signed PUT URL. The
     * returned `r2Key` MUST be passed back to [submit] verbatim — it
     * encodes the caller's user prefix and is validated server-side
     * against `req.auth.uniqueId`.
     */
    suspend fun requestUploadUrl(contentType: ContentType): Resource<UploadHandle>

    /**
     * Step 2 — PUT the image bytes to the signed URL. No auth header
     * (the URL is the auth). Failure here is generally network/expiry
     * related, NOT auth.
     */
    suspend fun uploadImage(
        uploadUrl: String,
        contentType: ContentType,
        bytes: ByteArray,
    ): Resource<Unit>

    /**
     * Step 3 — tell the API the upload finished. Server flips status
     * to 'pending' and notifies admins. Idempotent: a second submit
     * for the same user while the first is pending returns 409 (the
     * route only allows one pending submission per user).
     */
    suspend fun submit(
        idMethod: IdMethod,
        r2Key: String,
    ): Resource<Unit>
}
