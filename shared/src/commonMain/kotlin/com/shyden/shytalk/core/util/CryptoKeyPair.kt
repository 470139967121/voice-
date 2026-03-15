package com.shyden.shytalk.core.util

/**
 * Platform-specific cryptographic keypair for biometric challenge signing.
 * Android: Android Keystore (EC P-256, SHA256withECDSA).
 * iOS: Secure Enclave (EC P-256, SHA256).
 */
expect class CryptoKeyPair {
    /** Generate a new keypair or load existing one. Returns true if key is available. */
    fun generateOrLoad(alias: String): Boolean

    /** Get the public key as Base64-encoded SPKI DER. */
    fun getPublicKeyBase64(): String?

    /** Sign data with the private key. Returns Base64-encoded signature. */
    fun sign(data: ByteArray): ByteArray?

    /** Delete the keypair for the given alias. */
    fun delete(alias: String)
}
