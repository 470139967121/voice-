package com.shyden.shytalk.core.util

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

actual class SecureStorage(context: Context) {
    private val prefs: SharedPreferences = try {
        createEncryptedPrefs(context)
    } catch (_: Exception) {
        // Corruption recovery (e.g. API 28 Keystore issue): clear and recreate
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().clear().apply()
        try {
            createEncryptedPrefs(context)
        } catch (_: Exception) {
            // Last resort: fall back to unencrypted (will force fresh sign-in)
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        }
    }

    private companion object {
        const val PREFS_NAME = "shytalk_secure_prefs"

        fun createEncryptedPrefs(context: Context): SharedPreferences {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            return EncryptedSharedPreferences.create(
                context,
                PREFS_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        }
    }

    actual fun getString(key: String): String? = prefs.getString(key, null)
    actual fun putString(key: String, value: String) { prefs.edit().putString(key, value).apply() }
    actual fun getInt(key: String, default: Int): Int = prefs.getInt(key, default)
    actual fun putInt(key: String, value: Int) { prefs.edit().putInt(key, value).apply() }
    actual fun getBoolean(key: String, default: Boolean): Boolean = prefs.getBoolean(key, default)
    actual fun putBoolean(key: String, value: Boolean) { prefs.edit().putBoolean(key, value).apply() }
    actual fun getLong(key: String, default: Long): Long = prefs.getLong(key, default)
    actual fun putLong(key: String, value: Long) { prefs.edit().putLong(key, value).apply() }
    actual fun remove(key: String) { prefs.edit().remove(key).apply() }
    actual fun clear() { prefs.edit().clear().apply() }
}
