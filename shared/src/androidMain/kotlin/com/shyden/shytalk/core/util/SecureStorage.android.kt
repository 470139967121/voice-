package com.shyden.shytalk.core.util

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import java.io.File

/**
 * Android-side credential & app-lock state store.
 *
 * Uses plain `SharedPreferences` with `MODE_PRIVATE`. AndroidX's
 * `EncryptedSharedPreferences` was deprecated in `androidx.security.crypto`
 * 1.1.0-alpha07 — Google's guidance is that on devices with file-based
 * encryption (default since API 24, mandatory on our `minSdk = 28`), the
 * extra Keystore-bound layer adds reliability problems (Keystore corruption
 * on certain OEMs and after factory reset) without meaningful security gain
 * for non-password data. The only sensitive value here is `localPinHash`
 * which is already a bcrypt-hashed digest — irreversible even if the file
 * is read off-device.
 *
 * **Migration from the legacy encrypted file** runs once on first launch
 * after upgrade and is intentionally conservative:
 *
 *   1. Each known key is read individually (`KEYS_TO_MIGRATE`) so a single
 *      corrupted entry doesn't take down the whole migration. The legacy
 *      `getAll()` materialises every value at once — one bad decrypt = no
 *      keys migrated — which is why we read by name.
 *   2. Per-key reads are wrapped in `runCatching` and logged. Successful
 *      values are batched into a single `commit()` so we get a synchronous
 *      durable write before the migration flag is set.
 *   3. The migration flag is only set when the data write returned `true`.
 *      A transient Keystore wedge therefore retries on the next launch
 *      instead of permanently writing off the user's PIN credential.
 *   4. The legacy file is only deleted after a successful migration. On
 *      failure the encrypted file stays on disk as a recovery hint for a
 *      future fix release.
 */
actual class SecureStorage(
    context: Context,
) {
    private val prefs: SharedPreferences = openOrMigrate(context)

    actual fun getString(key: String): String? = prefs.getString(key, null)

    actual fun putString(
        key: String,
        value: String,
    ) {
        prefs.edit().putString(key, value).apply()
    }

    actual fun getInt(
        key: String,
        default: Int,
    ): Int = prefs.getInt(key, default)

    actual fun putInt(
        key: String,
        value: Int,
    ) {
        prefs.edit().putInt(key, value).apply()
    }

    actual fun getBoolean(
        key: String,
        default: Boolean,
    ): Boolean = prefs.getBoolean(key, default)

    actual fun putBoolean(
        key: String,
        value: Boolean,
    ) {
        prefs.edit().putBoolean(key, value).apply()
    }

    actual fun getLong(
        key: String,
        default: Long,
    ): Long = prefs.getLong(key, default)

    actual fun putLong(
        key: String,
        value: Long,
    ) {
        prefs.edit().putLong(key, value).apply()
    }

    actual fun remove(key: String) {
        prefs.edit().remove(key).apply()
    }

    actual fun clear() {
        prefs.edit().clear().apply()
    }

    private companion object {
        // Distinct file name from `LanguagePreference.android.kt`'s
        // `shytalk_prefs` so `clear()` (e.g. on sign-out) wipes only
        // credential / app-lock state and leaves the user's language
        // preference + accepted-legal-version intact.
        const val PREFS_NAME = "shytalk_app_lock_prefs"
        const val LEGACY_PREFS_NAME = "shytalk_secure_prefs"
        const val KEY_MIGRATED_FROM_ENCRYPTED = "migratedFromEncrypted"

        // Names + types of every key the legacy ENCRYPTED file actually held.
        // Reading by name lets a single corrupt entry skip rather than abort
        // the whole migration. Source of truth: AppLockRepositoryImpl. The
        // email-for-link key lives in plain `shytalk_prefs` and was never in
        // the encrypted store — don't list it here or the migration would
        // mistakenly look for a non-existent key.
        private enum class LegacyKeyType { STRING, INT, LONG, BOOLEAN }

        private val KEYS_TO_MIGRATE: List<Pair<String, LegacyKeyType>> =
            listOf(
                "uniqueId" to LegacyKeyType.STRING,
                "deviceId" to LegacyKeyType.STRING,
                "localPinHash" to LegacyKeyType.STRING,
                "credentialVersion" to LegacyKeyType.INT,
                "appLockEnabled" to LegacyKeyType.BOOLEAN,
                "biometricEnabled" to LegacyKeyType.BOOLEAN,
                "lockTimeoutMinutes" to LegacyKeyType.INT,
                "lastActiveTimestamp" to LegacyKeyType.LONG,
            )

        fun openOrMigrate(context: Context): SharedPreferences {
            val newPrefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            if (newPrefs.getBoolean(KEY_MIGRATED_FROM_ENCRYPTED, false)) return newPrefs
            migrateFromEncryptedPrefs(context, newPrefs)
            return newPrefs
        }

        private fun migrateFromEncryptedPrefs(
            context: Context,
            newPrefs: SharedPreferences,
        ) {
            val legacyFile = File(context.applicationInfo.dataDir, "shared_prefs/$LEGACY_PREFS_NAME.xml")
            val legacyFileExists = legacyFile.exists()

            val oldPrefs =
                openLegacyEncryptedPrefs(context) ?: run {
                    if (legacyFileExists) {
                        // Legacy file is on disk but the Keystore-bound master
                        // key couldn't be opened — likely a transient wedge
                        // (post-factory-reset, certain OEM bugs on API 28+).
                        // Don't mark migrated — let the next launch retry once
                        // Keystore self-heals. Data stays in the legacy file.
                        Log.w(
                            "SecureStorage",
                            "Legacy encrypted prefs file exists but Keystore could not unlock it; will retry next launch",
                        )
                        return
                    }
                    // No legacy file at all — genuine fresh install. Mark
                    // migrated synchronously so subsequent launches skip the
                    // (no-op) Keystore round-trip. Sync `commit()` matches
                    // the success-path durability contract; a process kill
                    // before this returns simply re-runs the same no-op next
                    // boot.
                    newPrefs
                        .edit()
                        .putBoolean(KEY_MIGRATED_FROM_ENCRYPTED, true)
                        .commit()
                    return
                }

            val editor = newPrefs.edit()
            for ((key, type) in KEYS_TO_MIGRATE) {
                // Refuse to overwrite a key that already exists in the new
                // file: if a previous migration partially completed and the
                // app has since written fresh credentials, we don't want a
                // re-run to clobber them with the stale legacy value.
                if (newPrefs.contains(key)) continue
                runCatching {
                    when (type) {
                        LegacyKeyType.STRING ->
                            oldPrefs.getString(key, null)?.let { editor.putString(key, it) }

                        LegacyKeyType.INT ->
                            if (oldPrefs.contains(key)) editor.putInt(key, oldPrefs.getInt(key, 0))

                        LegacyKeyType.LONG ->
                            if (oldPrefs.contains(key)) editor.putLong(key, oldPrefs.getLong(key, 0L))

                        LegacyKeyType.BOOLEAN ->
                            if (oldPrefs.contains(key)) editor.putBoolean(key, oldPrefs.getBoolean(key, false))
                    }
                }.onFailure { e ->
                    Log.w("SecureStorage", "Skipping legacy key '$key' during migration", e)
                }
            }

            // Synchronous write — we MUST know whether the data hit disk
            // before we set the migration flag, otherwise a process kill
            // could lose user credentials silently.
            val dataWritten = editor.commit()
            if (!dataWritten) {
                Log.e(
                    "SecureStorage",
                    "Migration write returned false; not marking migrated, will retry on next boot",
                )
                return
            }

            val flagWritten =
                newPrefs
                    .edit()
                    .putBoolean(KEY_MIGRATED_FROM_ENCRYPTED, true)
                    .commit()
            if (!flagWritten) {
                Log.w(
                    "SecureStorage",
                    "Migration flag write returned false; will redundantly migrate next boot",
                )
                return
            }

            // Only delete the legacy file once the migration flag is durably
            // on disk. If we fail here it's harmless cruft (the new code
            // never reads the legacy file again) but log it so a Keystore-
            // wedged device leaves a triage trail.
            runCatching {
                context.deleteSharedPreferences(LEGACY_PREFS_NAME)
            }.onFailure { e ->
                Log.w("SecureStorage", "Legacy file delete failed; harmless cruft remains", e)
            }
        }

        // One-shot use of the deprecated AndroidX EncryptedSharedPreferences API
        // to read existing user data before migrating to plain SharedPreferences.
        // Suppressed in this contained helper only — no other code path uses
        // the deprecated API, and this whole helper can be deleted in a future
        // major version once we're confident every install has migrated.
        @Suppress("DEPRECATION")
        private fun openLegacyEncryptedPrefs(context: Context): SharedPreferences? =
            try {
                val masterKey =
                    androidx.security.crypto.MasterKey
                        .Builder(context)
                        .setKeyScheme(androidx.security.crypto.MasterKey.KeyScheme.AES256_GCM)
                        .build()
                androidx.security.crypto.EncryptedSharedPreferences.create(
                    context,
                    LEGACY_PREFS_NAME,
                    masterKey,
                    androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
                )
            } catch (e: Exception) {
                Log.w("SecureStorage", "Could not open legacy encrypted prefs (likely fresh install)", e)
                null
            }
    }
}
