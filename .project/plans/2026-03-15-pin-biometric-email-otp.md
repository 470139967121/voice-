# PIN + Biometric + Email OTP Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PIN, biometric, and email OTP authentication as a universal session layer on top of all sign-in methods.

**Architecture:** Firebase Custom Tokens issued by Express API after PIN/biometric/OTP verification. PIN hashed with bcrypt server-side, biometric via challenge-response keypair. Oracle Cloud Email Delivery for OTP emails. KMP expect/actual for platform-specific biometric and secure storage.

**Tech Stack:** Express.js, Nodemailer, bcrypt, Firebase Admin SDK (custom tokens), Kotlin Multiplatform, Compose Multiplatform, AndroidX Biometric, iOS LocalAuthentication, EncryptedSharedPreferences / iOS Keychain.

**Spec:** `.project/specs/2026-03-15-pin-biometric-email-otp-design.md`

---

## Chunk 1: Express API Backend

### Task 1: Add dependencies

**Files:**
- Modify: `express-api/package.json`

- [ ] **Step 1: Install nodemailer and bcrypt**

```bash
cd express-api && npm install nodemailer bcrypt
```

- [ ] **Step 2: Verify package.json updated**

Check that `nodemailer` and `bcrypt` appear in `dependencies`.

- [ ] **Step 3: Commit**

```bash
git add express-api/package.json express-api/package-lock.json
git commit -m "feat(api): add nodemailer and bcrypt dependencies"
```

### Task 2: Email template utility

**Files:**
- Create: `express-api/src/utils/email-templates.js`
- Test: `express-api/tests/utils/email-templates.test.js`

- [ ] **Step 1: Write failing tests for email templates**

```javascript
// express-api/tests/utils/email-templates.test.js
const { buildOtpEmail, buildLockoutEmail, buildResetEmail } = require('../../src/utils/email-templates');

describe('Email Templates', () => {
  describe('buildOtpEmail', () => {
    it('should return html and subject for OTP verification', () => {
      const result = buildOtpEmail('482715');
      expect(result.subject).toBe('Your ShyTalk verification code');
      expect(result.html).toContain('482715');
      expect(result.html).toContain('10 minutes');
      expect(result.html).toContain('ShyTalk');
      expect(result.html).toContain('#1a1a2e'); // dark theme
    });

    it('should include the ShyTalk logo', () => {
      const result = buildOtpEmail('123456');
      expect(result.html).toContain('images.shytalk.shyden.co.uk');
    });
  });

  describe('buildLockoutEmail', () => {
    it('should return html and subject for lockout unlock', () => {
      const result = buildLockoutEmail('987654');
      expect(result.subject).toBe('Unlock your ShyTalk account');
      expect(result.html).toContain('987654');
      expect(result.html).toContain('locked');
    });
  });

  describe('buildResetEmail', () => {
    it('should return html and subject for PIN reset', () => {
      const result = buildResetEmail('111222');
      expect(result.subject).toBe('Reset your ShyTalk PIN');
      expect(result.html).toContain('111222');
    });
  });

  describe('all templates', () => {
    it('should include do-not-reply footer', () => {
      for (const fn of [buildOtpEmail, buildLockoutEmail, buildResetEmail]) {
        const result = fn('000000');
        expect(result.html).toContain("didn't request this");
      }
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd express-api && npm test -- --testPathPattern=email-templates
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement email templates**

Create `express-api/src/utils/email-templates.js` with dark-themed HTML templates. ShyTalk logo from `https://images.shytalk.shyden.co.uk/branding/logo.png`. Each function returns `{subject, html}`. Shared `wrapTemplate(title, bodyHtml)` helper that provides the dark chrome (header with logo, footer with tagline + ignore notice).

Template structure:
- Background: `#1a1a2e`
- Logo header with ShyTalk branding
- Greeting: "Hi there,"
- Purpose line (varies)
- OTP code: large spaced digits on `#2a2a4e` pill
- Expiry note
- Footer: "ShyTalk — Voice Chat Rooms" + "If you didn't request this, ignore this email."

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd express-api && npm test -- --testPathPattern=email-templates
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add express-api/src/utils/email-templates.js express-api/tests/utils/email-templates.test.js
git commit -m "feat(api): add dark-themed email templates for OTP, lockout, and PIN reset"
```

### Task 3: Email sending utility

**Files:**
- Create: `express-api/src/utils/email.js`
- Test: `express-api/tests/utils/email.test.js`

- [ ] **Step 1: Write failing tests for email sender**

```javascript
// express-api/tests/utils/email.test.js
const { sendEmail } = require('../../src/utils/email');

// Mock nodemailer
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-id' }),
  })),
}));

describe('Email Sender', () => {
  beforeEach(() => {
    process.env.SMTP_HOST = 'smtp.test.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'testuser';
    process.env.SMTP_PASS = 'testpass';
  });

  it('should send an email with correct from address', async () => {
    const nodemailer = require('nodemailer');
    await sendEmail('user@example.com', 'Test Subject', '<p>Test</p>');
    const transport = nodemailer.createTransport();
    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"ShyTalk" <noreply@shytalk.shyden.co.uk>',
        to: 'user@example.com',
        subject: 'Test Subject',
        html: '<p>Test</p>',
      })
    );
  });

  it('should throw if SMTP not configured', async () => {
    delete process.env.SMTP_HOST;
    await expect(sendEmail('a@b.com', 's', 'h')).rejects.toThrow('SMTP not configured');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd express-api && npm test -- --testPathPattern=utils/email.test
```

- [ ] **Step 3: Implement email sender**

Create `express-api/src/utils/email.js`. Uses `nodemailer.createTransport` with SMTP config from env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`). Single `sendEmail(to, subject, html)` function. Sender: `"ShyTalk" <noreply@shytalk.shyden.co.uk>`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd express-api && npm test -- --testPathPattern=utils/email.test
```

- [ ] **Step 5: Commit**

```bash
git add express-api/src/utils/email.js express-api/tests/utils/email.test.js
git commit -m "feat(api): add email sending utility with Nodemailer"
```

### Task 4: OTP routes

**Files:**
- Create: `express-api/src/routes/auth.js`
- Test: `express-api/tests/routes/auth-otp.test.js`

- [ ] **Step 1: Write failing tests for OTP send and verify**

Tests for:
- `POST /api/auth/otp/send` — sends OTP, returns 200, rate limits at 5/hour
- `POST /api/auth/otp/send` — blocks disposable email domains
- `POST /api/auth/otp/verify` — correct code returns Firebase custom token
- `POST /api/auth/otp/verify` — wrong code returns 401, increments attempts
- `POST /api/auth/otp/verify` — expired code returns 410
- `POST /api/auth/otp/verify` — 3 failed attempts locks the code

Mock Firebase Admin SDK (`admin.auth().createCustomToken()`), Firestore, and email sender.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd express-api && npm test -- --testPathPattern=auth-otp
```

- [ ] **Step 3: Implement OTP routes**

Create `express-api/src/routes/auth.js` with:
- `POST /api/auth/otp/send`: generate 6-digit code, bcrypt hash it, store in `otpCodes/{email}` with `expiresAt` (10 min), `attempts: 0`, rate limit tracking. Send via email utility + template.
- `POST /api/auth/otp/verify`: lookup `otpCodes/{email}`, check expiry, compare bcrypt, increment attempts on failure (max 3). On success: lookup/create identity, issue `admin.auth().createCustomToken(uid)`.

Rate limit: check `requestCount` and `firstRequestAt`. If `firstRequestAt` older than 60 minutes, reset. If `requestCount >= 5`, return 429.

Global daily email cap: maintain `emailMetrics/daily` Firestore doc with `{count, date}`. Increment on each send. If date is stale, reset to 0. Log warning at 80+. At 100, return 429 with body `{error: "daily_limit", message: "Too many requests. Try again tomorrow or use Google/Apple sign-in."}`. Client shows this message to user.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd express-api && npm test -- --testPathPattern=auth-otp
```

- [ ] **Step 5: Commit**

```bash
git add express-api/src/routes/auth.js express-api/tests/routes/auth-otp.test.js
git commit -m "feat(api): add OTP send and verify routes with rate limiting"
```

### Task 5: PIN routes

**Files:**
- Modify: `express-api/src/routes/auth.js`
- Test: `express-api/tests/routes/auth-pin.test.js`

- [ ] **Step 1: Write failing tests for PIN setup, verify, and reset**

Tests for:
- `POST /api/auth/pin/setup` (requires Firebase token) — stores bcrypt hash on user doc, returns 200
- `POST /api/auth/pin/setup` — rejects PIN shorter than 4 or longer than 8 digits
- `POST /api/auth/pin/setup` — rejects non-numeric PIN
- `POST /api/auth/pin/verify` — correct PIN returns custom token, resets attempts
- `POST /api/auth/pin/verify` — wrong PIN increments attempts, returns 401
- `POST /api/auth/pin/verify` — 5 failures returns 423 (locked), sets 15-min `pinLockedUntil`
- `POST /api/auth/pin/verify` — while locked, returns 423 with `lockedUntil` timestamp
- `POST /api/auth/pin/verify` — after lockout expires, allows attempts again
- `POST /api/auth/pin/verify` — second lockout sets `pinLockoutCount: 2`, requires re-auth
- `POST /api/auth/pin/reset` (requires Firebase token) — clears lockout fields, stores new hash

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd express-api && npm test -- --testPathPattern=auth-pin
```

- [ ] **Step 3: Implement PIN routes**

Add to `express-api/src/routes/auth.js`:
- `POST /api/auth/pin/setup`: validate PIN (4-8 numeric digits), bcrypt hash (rounds=10), store `pinHash` + `pinSetAt` on `users/{uniqueId}`.
- `POST /api/auth/pin/verify`: read user doc, check `pinLockedUntil` (if locked and not expired, return 423). Compare bcrypt. On success: reset `pinAttempts` to 0, return `admin.auth().createCustomToken(uid)`. On failure: increment `pinAttempts`. If `pinAttempts >= 5`: set `pinLockedUntil` to now+15min, increment `pinLockoutCount`. If `pinLockoutCount >= 2`: set response flag `requiresReauth: true`.
- `POST /api/auth/pin/reset`: requires Firebase token (user already re-authenticated). Validate new PIN, store hash, reset `pinAttempts`, `pinLockedUntil`, `pinLockoutCount` to 0.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd express-api && npm test -- --testPathPattern=auth-pin
```

- [ ] **Step 5: Commit**

```bash
git add express-api/src/routes/auth.js express-api/tests/routes/auth-pin.test.js
git commit -m "feat(api): add PIN setup, verify, and reset routes with lockout logic"
```

### Task 6: Biometric routes

**Files:**
- Modify: `express-api/src/routes/auth.js`
- Test: `express-api/tests/routes/auth-biometric.test.js`

- [ ] **Step 1: Write failing tests for biometric register, challenge, verify, and revoke**

Tests for:
- `POST /api/auth/biometric/register` (requires Firebase token) — stores public key in `biometricKeys/{uniqueId}:{deviceId}`
- `GET /api/auth/biometric/challenge?uniqueId=X&deviceId=Y` — returns random nonce if pair exists in biometricKeys
- `GET /api/auth/biometric/challenge` — returns 404 if pair not registered
- `POST /api/auth/biometric/verify` — valid signature returns custom token
- `POST /api/auth/biometric/verify` — invalid signature returns 401
- `POST /api/auth/biometric/verify` — expired challenge returns 410
- `DELETE /api/auth/biometric/:deviceId` (requires Firebase token) — deletes key from biometricKeys

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd express-api && npm test -- --testPathPattern=auth-biometric
```

- [ ] **Step 3: Implement biometric routes**

Add to `express-api/src/routes/auth.js`:
- `POST /api/auth/biometric/register`: store `{publicKey, createdAt}` in `biometricKeys/{uniqueId}:{deviceId}`.
- `GET /api/auth/biometric/challenge`: validate `uniqueId+deviceId` exists in `biometricKeys`. Generate 32-byte random nonce, store with 60s expiry in `biometricChallenges/{uniqueId}:{deviceId}` (or in-memory with TTL). Return nonce.
- `POST /api/auth/biometric/verify`: lookup challenge, verify crypto signature against stored public key, issue custom token on success.
- `DELETE /api/auth/biometric/:deviceId`: auth required, delete `biometricKeys/{uniqueId}:{deviceId}`.

Rate limit challenges: 10/min/deviceId (use express-rate-limit keyed on deviceId query param).

Store challenges in-memory with 60s TTL (Map with setTimeout cleanup). Lost on server restart, which is fine — client retries with a new challenge. No Firestore writes needed for challenges (reduces cost and avoids needing a cleanup cron).

**Follow-up (not in this plan):** Add OkHttp `CertificatePinner` for the Express API domain on Android, and appropriate ATS configuration on iOS, to protect PIN-over-HTTPS from TLS interception on compromised devices.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd express-api && npm test -- --testPathPattern=auth-biometric
```

- [ ] **Step 5: Commit**

```bash
git add express-api/src/routes/auth.js express-api/tests/routes/auth-biometric.test.js
git commit -m "feat(api): add biometric register, challenge, verify, and revoke routes"
```

### Task 7: Mount auth routes and update Firestore rules

**Files:**
- Modify: `express-api/src/index.js` (mount `/api/auth` router)
- Modify: `firestore.rules` (add rules for `otpCodes`, `biometricKeys`)

- [ ] **Step 1: Mount auth routes in Express app**

In `express-api/src/index.js`, add:
```javascript
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);
```

- [ ] **Step 2: Add Firestore rules for new collections**

In `firestore.rules`, add rules for `otpCodes` and `biometricKeys`. Both are server-side only (Admin SDK bypasses rules), so deny all client access:

```
match /otpCodes/{email} {
  allow read, write: if false;
}
match /biometricKeys/{keyId} {
  allow read, write: if false;
}
// biometricChallenges stored in-memory on server (not Firestore) — no rules needed
```

- [ ] **Step 3: Run all Express API tests**

```bash
cd express-api && npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add express-api/src/index.js firestore.rules
git commit -m "feat(api): mount auth routes and add Firestore rules for OTP and biometric collections"
```

---

## Chunk 2: KMP Platform Layer

### Task 8: SecureStorage expect/actual

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/core/util/SecureStorage.kt`
- Create: `shared/src/androidMain/kotlin/com/shyden/shytalk/core/util/SecureStorage.android.kt`
- Create: `shared/src/iosMain/kotlin/com/shyden/shytalk/core/util/SecureStorage.ios.kt`

- [ ] **Step 1: Define expect class in commonMain**

```kotlin
// shared/src/commonMain/.../core/util/SecureStorage.kt
package com.shyden.shytalk.core.util

expect class SecureStorage {
    fun getString(key: String): String?
    fun putString(key: String, value: String)
    fun getInt(key: String, default: Int): Int
    fun putInt(key: String, value: Int)
    fun getBoolean(key: String, default: Boolean): Boolean
    fun putBoolean(key: String, value: Boolean)
    fun getLong(key: String, default: Long): Long
    fun putLong(key: String, value: Long)
    fun remove(key: String)
    fun clear()
}
```

- [ ] **Step 2: Implement Android actual with EncryptedSharedPreferences**

```kotlin
// shared/src/androidMain/.../core/util/SecureStorage.android.kt
package com.shyden.shytalk.core.util

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

actual class SecureStorage(context: Context) {
    private val prefs: SharedPreferences = try {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "shytalk_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    } catch (e: Exception) {
        // Corruption recovery: delete and recreate
        context.getSharedPreferences("shytalk_secure_prefs", Context.MODE_PRIVATE)
            .edit().clear().apply()
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "shytalk_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    actual fun getString(key: String): String? = prefs.getString(key, null)
    actual fun putString(key: String, value: String) = prefs.edit().putString(key, value).apply()
    actual fun getInt(key: String, default: Int): Int = prefs.getInt(key, default)
    actual fun putInt(key: String, value: Int) = prefs.edit().putInt(key, value).apply()
    actual fun getBoolean(key: String, default: Boolean): Boolean = prefs.getBoolean(key, default)
    actual fun putBoolean(key: String, value: Boolean) = prefs.edit().putBoolean(key, value).apply()
    actual fun getLong(key: String, default: Long): Long = prefs.getLong(key, default)
    actual fun putLong(key: String, value: Long) = prefs.edit().putLong(key, value).apply()
    actual fun remove(key: String) = prefs.edit().remove(key).apply()
    actual fun clear() = prefs.edit().clear().apply()
}
```

- [ ] **Step 3: Implement iOS actual with Keychain**

Use iOS Security framework via cinterop (`SecItemAdd`, `SecItemCopyMatching`, `SecItemUpdate`, `SecItemDelete`). Each key-value pair stored as a `kSecClassGenericPassword` item with `kSecAttrService = "com.shyden.shytalk"` and `kSecAttrAccount = key`. String values encoded as UTF-8 data. Int/Long/Boolean serialized as string representations.

`@OptIn(ExperimentalForeignApi::class)` required for Security framework calls.

The `clear()` method deletes all items matching the service name.

If a Keychain read fails (e.g. after device restore), return null/default — treated as "no credential" by the app, forcing fresh sign-in.

- [ ] **Step 4: Add `androidx.security:security-crypto` dependency**

In `shared/build.gradle.kts`, add to androidMain dependencies:
```kotlin
implementation("androidx.security:security-crypto:1.1.0-alpha06")
```

- [ ] **Step 5: Add Android backup exclusion**

Create or update `app/src/main/res/xml/backup_rules.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
        <exclude domain="sharedpref" path="shytalk_secure_prefs.xml"/>
    </cloud-backup>
    <device-transfer>
        <exclude domain="sharedpref" path="shytalk_secure_prefs.xml"/>
    </device-transfer>
</data-extraction-rules>
```

Reference in `AndroidManifest.xml`: `android:dataExtractionRules="@xml/backup_rules"`

- [ ] **Step 6: Build to verify compilation**

```bash
./gradlew assembleDevDebug
```

- [ ] **Step 7: Commit**

```bash
git add shared/src/ shared/build.gradle.kts app/src/main/res/xml/backup_rules.xml app/src/main/AndroidManifest.xml
git commit -m "feat(kmp): add SecureStorage expect/actual with EncryptedSharedPreferences and backup exclusion"
```

### Task 9: BiometricAuth expect/actual

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/core/util/BiometricAuth.kt`
- Create: `shared/src/androidMain/kotlin/com/shyden/shytalk/core/util/BiometricAuth.android.kt`
- Create: `shared/src/iosMain/kotlin/com/shyden/shytalk/core/util/BiometricAuth.ios.kt`

- [ ] **Step 1: Define expect class and result type in commonMain**

```kotlin
// shared/src/commonMain/.../core/util/BiometricAuth.kt
package com.shyden.shytalk.core.util

sealed class BiometricResult {
    object Success : BiometricResult()
    object Fallback : BiometricResult()
    data class Error(val message: String) : BiometricResult()
}

expect class BiometricAuth {
    fun isAvailable(): Boolean
    suspend fun authenticate(title: String, subtitle: String): BiometricResult
}
```

- [ ] **Step 2: Implement Android actual with BiometricPrompt**

Use `BiometricPrompt` with `suspendCancellableCoroutine`. Requires `FragmentActivity` context. Return `BiometricResult.Success` on authentication success, `BiometricResult.Fallback` on negative button click ("Use PIN"), `BiometricResult.Error` on failure.

- [ ] **Step 3: Implement iOS actual with LAContext**

Use `LAContext.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)` with `suspendCancellableCoroutine`. `isAvailable()` checks `canEvaluatePolicy`. `@OptIn(ExperimentalForeignApi::class)` as needed.

- [ ] **Step 4: Build to verify compilation**

```bash
./gradlew assembleDevDebug
```

- [ ] **Step 5: Commit**

```bash
git add shared/src/
git commit -m "feat(kmp): add BiometricAuth expect/actual with BiometricPrompt and LAContext"
```

### Task 10: CryptoKeyPair expect/actual

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/core/util/CryptoKeyPair.kt`
- Create: `shared/src/androidMain/kotlin/com/shyden/shytalk/core/util/CryptoKeyPair.android.kt`
- Create: `shared/src/iosMain/kotlin/com/shyden/shytalk/core/util/CryptoKeyPair.ios.kt`

- [ ] **Step 1: Define expect class in commonMain**

```kotlin
// shared/src/commonMain/.../core/util/CryptoKeyPair.kt
package com.shyden.shytalk.core.util

expect class CryptoKeyPair {
    fun generateOrLoad(alias: String): Boolean
    fun getPublicKeyBase64(): String?
    fun sign(data: ByteArray): ByteArray?
    fun delete(alias: String)
}
```

- [ ] **Step 2: Implement Android actual with Android Keystore**

Use `KeyPairGenerator` with `KeyGenParameterSpec` (EC P-256, `PURPOSE_SIGN`). Store under alias `"shytalk_biometric_{deviceId}"`. Sign with `Signature.getInstance("SHA256withECDSA")`.

- [ ] **Step 3: Implement iOS actual with SecureEnclave**

Use `SecKeyCreateRandomKey` with `kSecAttrTokenIDSecureEnclave`. Sign with `SecKeyCreateSignature`. Export public key with `SecKeyCopyExternalRepresentation`.

- [ ] **Step 4: Build to verify compilation**

```bash
./gradlew assembleDevDebug
```

- [ ] **Step 5: Commit**

```bash
git add shared/src/
git commit -m "feat(kmp): add CryptoKeyPair expect/actual for biometric challenge signing"
```

---

## Chunk 3: KMP Repositories and ViewModels

### Task 11: OtpRepository

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/data/repository/OtpRepository.kt`
- Create: `app/src/main/java/com/shyden/shytalk/data/repository/OtpRepositoryImpl.kt`
- Test: `shared/src/commonTest/kotlin/com/shyden/shytalk/data/repository/OtpRepositoryTest.kt`

- [ ] **Step 1: Write failing test**

Test that `sendOtp(email)` calls `POST /api/auth/otp/send` and `verifyOtp(email, code)` calls `POST /api/auth/otp/verify` and returns a custom token string.

- [ ] **Step 2: Define interface in commonMain**

```kotlin
interface OtpRepository {
    suspend fun sendOtp(email: String): Result<Unit>
    suspend fun verifyOtp(email: String, code: String): Result<String> // returns custom token
}
```

- [ ] **Step 3: Implement in app module**

`OtpRepositoryImpl` uses `WorkerApiClient` to call Express API endpoints. Returns `Result.success(token)` or `Result.failure(exception)` with appropriate error messages.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(kmp): add OtpRepository for email OTP send and verify"
```

### Task 12: PinRepository

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/data/repository/PinRepository.kt`
- Create: `app/src/main/java/com/shyden/shytalk/data/repository/PinRepositoryImpl.kt`
- Test: `shared/src/commonTest/kotlin/com/shyden/shytalk/data/repository/PinRepositoryTest.kt`

- [ ] **Step 1: Write failing tests**

Test `setupPin`, `verifyPin`, `resetPin` methods. Mock the API client.

- [ ] **Step 2: Define interface**

```kotlin
data class PinVerifyResult(
    val customToken: String? = null,
    val locked: Boolean = false,
    val lockedUntil: Long? = null,
    val requiresReauth: Boolean = false,
    val attemptsRemaining: Int = 5,
)

interface PinRepository {
    suspend fun setupPin(pin: String): Result<Unit>
    suspend fun verifyPin(uniqueId: String, deviceId: String, pin: String): Result<PinVerifyResult>
    suspend fun resetPin(newPin: String): Result<Unit>
}
```

- [ ] **Step 3: Implement in app module**

Calls Express API endpoints. `verifyPin` parses response to populate `PinVerifyResult` including lockout state.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(kmp): add PinRepository for PIN setup, verify, and reset"
```

### Task 13: BiometricRepository

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/data/repository/BiometricRepository.kt`
- Create: `app/src/main/java/com/shyden/shytalk/data/repository/BiometricRepositoryImpl.kt`

- [ ] **Step 1: Write failing tests**

Test `register`, `getChallenge`, `verify`, `revoke` methods.

- [ ] **Step 2: Define interface**

```kotlin
interface BiometricRepository {
    suspend fun register(publicKeyBase64: String): Result<Unit>
    suspend fun getChallenge(uniqueId: String, deviceId: String): Result<String> // nonce
    suspend fun verify(uniqueId: String, deviceId: String, challengeNonce: String, signatureBase64: String): Result<String> // custom token
    suspend fun revoke(deviceId: String): Result<Unit>
}
```

- [ ] **Step 3: Implement in app module**

Calls Express API biometric endpoints.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(kmp): add BiometricRepository for biometric register, challenge, verify, revoke"
```

### Task 14: AppLockRepository

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/data/repository/AppLockRepository.kt`
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/data/repository/AppLockRepositoryImpl.kt`

- [ ] **Step 1: Write failing tests**

Test credential storage, timeout checking, lock state management.

- [ ] **Step 2: Define interface and implement**

```kotlin
interface AppLockRepository {
    val hasCredential: Boolean
    val isAppLockEnabled: Boolean
    val isBiometricEnabled: Boolean
    val lockTimeoutMinutes: Int
    val storedUniqueId: String?
    val localPinHash: String?
    val credentialVersion: Int

    fun setCredential(uniqueId: String, deviceId: String, localPinHash: String)
    fun setAppLockEnabled(enabled: Boolean)
    fun setBiometricEnabled(enabled: Boolean)
    fun setLockTimeoutMinutes(minutes: Int)
    fun updateLastActiveTimestamp()
    fun isLockRequired(): Boolean  // checks timeout vs lastActiveTimestamp
    fun clearCredential()
}
```

Implementation uses `SecureStorage` directly. `isLockRequired()` compares `lastActiveTimestamp + lockTimeoutMinutes` against current time. Lives in commonMain since `SecureStorage` is expect/actual.

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(kmp): add AppLockRepository for local lock state and timeout management"
```

### Task 15: LockScreenViewModel

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/auth/LockScreenViewModel.kt`

- [ ] **Step 1: Write failing tests**

Test PIN verification flow, biometric flow, lockout state transitions, voice disconnect on lockout.

- [ ] **Step 2: Implement ViewModel**

State: `pinInput`, `error`, `isLocked`, `lockedUntil`, `requiresReauth`, `attemptsRemaining`.

Methods:
- `verifyPin(pin)`: try `PinRepository.verifyPin()` (server). On network failure: fall back to local bcrypt check against `AppLockRepository.localPinHash` using `org.mindrot.jbcrypt.BCrypt.checkpw()` (add `jbcrypt` dependency to shared/androidMain). If local check passes and Firebase session still valid, proceed without custom token. On success: sign in with custom token via `AuthRepository.signInWithCustomToken()`. On lockout: update state, track `lockoutTimestamp`, trigger voice disconnect + notification suppression.
- `verifyBiometric()`: uses `BiometricAuth.authenticate()`, then `CryptoKeyPair.sign(challenge)`, then `BiometricRepository.verify()`. On success: sign in with custom token. Bypasses PIN lockout.
- `biometricGracePeriod`: if biometric succeeds within 10 seconds of lockout, call reconnect voice + unsuppress notifications (undo lockout consequences). Track via `lockoutTimestamp` field — check `currentTimeMillis() - lockoutTimestamp < 10_000`.

**Offline fallback:** If server is unreachable during PIN verify, compare PIN against `AppLockRepository.localPinHash` using bcrypt locally. If match and `FirebaseAuth.currentUser != null` (session still valid), proceed. If Firebase session expired AND offline, show "No internet connection" error. Add `org.mindrot:jbcrypt:0.4` to shared androidMain dependencies. iOS uses CommonCrypto-based bcrypt or stores a SHA-256 hash for offline check.

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(kmp): add LockScreenViewModel with PIN/biometric verification and lockout handling"
```

### Task 16: PinSetupViewModel

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/auth/PinSetupViewModel.kt`

- [ ] **Step 1: Write failing tests**

Test PIN creation flow: enter → confirm → mismatch handling → successful setup.

- [ ] **Step 2: Implement ViewModel**

State: `step` (Enter/Confirm), `pin`, `confirmPin`, `error`, `pinLength` (4-8).

Methods:
- `submitPin(pin)`: if step is Enter, move to Confirm. If Confirm, compare. If match, call `PinRepository.setupPin()` + store local hash in `AppLockRepository`.
- `reset()`: clear state, go back to Enter step.

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(kmp): add PinSetupViewModel with enter-confirm flow"
```

### Task 17: EmailOtpViewModel

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/auth/EmailOtpViewModel.kt`

- [ ] **Step 1: Write failing tests**

Test email submission, OTP verification, resend cooldown (60s), disposable email blocking.

- [ ] **Step 2: Implement ViewModel**

State: `step` (EnterEmail/EnterCode), `email`, `code`, `error`, `resendCooldown`, `isLoading`.

Methods:
- `sendOtp(email)`: validate email, check disposable domains, call `OtpRepository.sendOtp()`, move to EnterCode step, start 60s resend cooldown.
- `verifyOtp(code)`: call `OtpRepository.verifyOtp()`, on success return custom token for identity resolution.
- `resendOtp()`: if cooldown expired, call sendOtp again.

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(kmp): add EmailOtpViewModel with send, verify, and resend cooldown"
```

---

## Chunk 4: UI Screens

### Task 18: LockScreen

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/auth/LockScreen.kt`

- [ ] **Step 1: Implement LockScreen composable**

PIN keypad (0-9 digits, backspace, clear) with dot indicators for entered digits. Biometric button if enabled (auto-triggers on first composition via `LaunchedEffect`). Error text for wrong PIN. Lockout state shows countdown timer. "Use PIN" shown when biometric active. PIN keypad always visible underneath biometric prompt.

- [ ] **Step 2: Write UI test**

Test: PIN entry updates dots, wrong PIN shows error, lockout shows timer.

- [ ] **Step 3: Build and verify**

```bash
./gradlew assembleDevDebug
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(ui): add LockScreen with PIN keypad and biometric prompt"
```

### Task 19: PinSetupScreen

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/auth/PinSetupScreen.kt`

- [ ] **Step 1: Implement PinSetupScreen composable**

Two-step flow: "Create a PIN" → numeric keypad → "Confirm your PIN" → keypad. Mismatch shows error and resets to first step. After success: biometric prompt ("Enable biometric login?") if hardware available. Info text: "You can change or disable this in Security settings." PIN length selector (4-8 digits) shown before entry.

- [ ] **Step 2: Write UI test**

Test: PIN entry, confirm step, mismatch resets, biometric offer appears after success.

- [ ] **Step 3: Build and verify**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(ui): add PinSetupScreen with create-confirm flow and biometric offer"
```

### Task 20: EmailOtpScreen

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/auth/EmailOtpScreen.kt`

- [ ] **Step 1: Implement EmailOtpScreen composable**

Two-step: email input with validation → 6-digit code input with auto-submit. Resend button with cooldown timer. Error handling for invalid code, expired code, rate limit. "Back" navigates to sign-in screen. Replaces the old `EmailSignInScreen`.

- [ ] **Step 2: Write UI test**

Test: email validation, code entry, resend cooldown display.

- [ ] **Step 3: Build and verify**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(ui): add EmailOtpScreen replacing EmailSignInScreen"
```

### Task 21: SecuritySettingsScreen

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/settings/SecuritySettingsScreen.kt`

- [ ] **Step 1: Implement SecuritySettingsScreen composable**

Rows:
- App Lock toggle (on/off, default on)
- Lock Timeout dropdown (1/5/15/30 min/Never) — only visible when app lock on
- Biometric Login toggle — shows capability label ("Fingerprint"/"Face ID"), disabled if hardware unavailable
- Reset PIN — navigates to re-auth flow then PIN setup
- Linked Accounts — navigates to existing LinkedAccounts page

- [ ] **Step 2: Write UI test**

Test: toggles update state, timeout only visible when app lock on, reset PIN navigates.

- [ ] **Step 3: Build and verify**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(ui): add SecuritySettingsScreen with app lock, biometric, and PIN reset"
```

---

## Chunk 5: Integration, Navigation, and Migration

### Task 22: Rename GoogleSignInScreen to SignInScreen

**Files:**
- Modify: `app/src/main/java/com/shyden/shytalk/feature/auth/GoogleSignInScreen.kt` → rename file and class
- Modify: `app/src/main/java/com/shyden/shytalk/navigation/NavGraph.kt` (update import and usage)
- Modify: `app/src/main/java/com/shyden/shytalk/core/di/AppKoinModule.kt` (if referenced)

- [ ] **Step 1: Rename file and class**

Rename `GoogleSignInScreen.kt` to `SignInScreen.kt`. Change composable function name from `GoogleSignInScreen` to `SignInScreen`. Update all internal references.

- [ ] **Step 2: Update NavGraph import and call site**

In `NavGraph.kt` line 56: change import. Line 178: change function call to `SignInScreen`.

- [ ] **Step 3: Add Email OTP button to SignInScreen**

Unhide the email sign-in button. Wire it to navigate to `Screen.EmailSignIn` (which will be updated to use `EmailOtpScreen` in a later step).

- [ ] **Step 4: Build and verify**

```bash
./gradlew assembleDevDebug
```

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: rename GoogleSignInScreen to SignInScreen and add email OTP button"
```

### Task 23: Update navigation routes

**Files:**
- Modify: `shared/src/commonMain/kotlin/com/shyden/shytalk/navigation/Screen.kt`
- Modify: `app/src/main/java/com/shyden/shytalk/navigation/NavGraph.kt`

- [ ] **Step 1: Add new Screen routes**

In `Screen.kt`, add:
```kotlin
object Lock : Screen("lock")
object PinSetup : Screen("pin_setup")
object SecuritySettings : Screen("security_settings")
```

Update `Screen.EmailSignIn` to point to `EmailOtpScreen`.

- [ ] **Step 2: Add composable routes in NavGraph**

Add `composable(Screen.Lock.route)` → `LockScreen`, `composable(Screen.PinSetup.route)` → `PinSetupScreen`, `composable(Screen.SecuritySettings.route)` → `SecuritySettingsScreen`. Update `Screen.EmailSignIn` composable to use `EmailOtpScreen` instead of `EmailSignInScreen`. Remove old `EmailSignInScreen.kt`.

- [ ] **Step 3: Wire SecuritySettingsScreen from AppSettingsScreen**

Add `Security` to `SettingsPage` enum in `AppSettingsScreen.kt` (line 93). Add "Security" row in main settings page navigating to `SecuritySettingsScreen`.

- [ ] **Step 4: Build and verify**

```bash
./gradlew assembleDevDebug
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(nav): add lock, PIN setup, and security settings routes"
```

### Task 24: Register new repositories and ViewModels in Koin

**Files:**
- Modify: `app/src/main/java/com/shyden/shytalk/core/di/AppKoinModule.kt`

- [ ] **Step 1: Add repository bindings**

```kotlin
singleOf(::OtpRepositoryImpl) bind OtpRepository::class
singleOf(::PinRepositoryImpl) bind PinRepository::class
singleOf(::BiometricRepositoryImpl) bind BiometricRepository::class
single<AppLockRepository> { AppLockRepositoryImpl(get()) }  // takes SecureStorage
single { SecureStorage(androidContext()) }  // iOS Koin module needs: single { SecureStorage() }
single { BiometricAuth(/* activity provider */) }  // iOS: single { BiometricAuth() }
single { CryptoKeyPair() }  // iOS: single { CryptoKeyPair() }
```

- [ ] **Step 2: Add ViewModel bindings**

```kotlin
viewModel { LockScreenViewModel(get(), get(), get(), get(), get(), get()) }
viewModel { PinSetupViewModel(get(), get(), get()) }
viewModel { EmailOtpViewModel(get()) }
```

- [ ] **Step 3: Build and verify**

```bash
./gradlew assembleDevDebug
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(di): register auth repositories and ViewModels in Koin"
```

### Task 24.5: Update User model with PIN fields

**Files:**
- Modify: `shared/src/commonMain/kotlin/com/shyden/shytalk/core/model/User.kt`

- [ ] **Step 1: Add PIN fields to User data class**

Add nullable fields:
```kotlin
val pinHash: String? = null,
val pinSetAt: Long? = null,
```

These are read from the Firestore user document to check if PIN setup is needed (migration detection).

- [ ] **Step 2: Build to verify**

```bash
./gradlew assembleDevDebug
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(model): add pinHash and pinSetAt fields to User model"
```

### Task 25: AuthViewModel integration — session lifecycle

**Files:**
- Modify: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/auth/AuthViewModel.kt`
- Modify: `shared/src/commonMain/kotlin/com/shyden/shytalk/data/repository/AuthRepository.kt`
- Modify: `app/src/main/java/com/shyden/shytalk/data/repository/AuthRepositoryImpl.kt`

- [ ] **Step 1: Add `signInWithCustomToken` to AuthRepository**

Interface:
```kotlin
suspend fun signInWithCustomToken(token: String): Result<Unit>
```

Implementation: call `firebaseAuth.signInWithCustomToken(token)`.

- [ ] **Step 2: Remove `signOut()` from AuthViewModel init block**

Remove lines 67-74 of `AuthViewModel.kt` (the init block that calls `authRepository.signOut()`). Replace with credential check:

```kotlin
init {
    viewModelScope.launch {
        if (appLockRepository.hasCredential) {
            // Returning user — navigate to lock screen or restore session
            if (appLockRepository.isAppLockEnabled && appLockRepository.isLockRequired()) {
                _navigateTo.emit(Screen.Lock)
            } else {
                // Silent restore — Firebase session is still valid (auto-refreshed by SDK)
                // Just verify the session is alive, no PIN/biometric needed
                restoreSession()
            }
        } else if (authRepository.isAuthenticated) {
            // First launch after update: user has Firebase session but no PIN
            // Route through identity resolution → PIN setup (migration path)
            resolveIdentityAndProceed(/* existing provider */)
        }
        // else: no credential AND no Firebase session → sign-in screen
    }
}
```

**`restoreSession()` definition:** Check if `FirebaseAuth.currentUser` is non-null (SDK persists session across app restarts). If valid, read the user's `uniqueId` from the cached token claims and proceed to the main app. If the session is expired or null, navigate to the lock screen for PIN/biometric verification (which gets a fresh custom token from the server). No server round-trip needed for silent restore if Firebase session is still valid.

- [ ] **Step 3: Add PIN setup routing after identity resolution**

In `resolveProfileState()` (line 263), after all profile checks pass, add:

```kotlin
// Check if user needs PIN setup (no pinHash on user document)
val userDoc = userRepository.getUser(userId)
if (userDoc?.pinHash == null) {
    _navigateTo.emit(Screen.PinSetup)
    return
}
```

- [ ] **Step 4: Add signOut cleanup**

Update `signOut()` (line 429) to also clear local credentials:
```kotlin
fun signOut() {
    viewModelScope.launch {
        appLockRepository.clearCredential()
        biometricRepository.revoke(deviceId)
        authRepository.signOut()
    }
}
```

- [ ] **Step 5: Write tests for new init behavior**

Test: credential exists + lock required → navigates to Lock. Credential exists + no lock → restores session. No credential → stays on sign-in.

- [ ] **Step 6: Run all tests**

```bash
./gradlew test
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(auth): integrate PIN/biometric session lifecycle into AuthViewModel"
```

### Task 26: App lock lifecycle (foreground/background)

**Files:**
- Modify: `app/src/main/java/com/shyden/shytalk/ShyTalkApp.kt` or `MainActivity.kt`

- [ ] **Step 1: Add lifecycle observer for background timeout**

Register `ProcessLifecycleOwner` observer in `ShyTalkApp` or `MainActivity`:
- `ON_STOP` (app backgrounded): record `lastActiveTimestamp` in `AppLockRepository`
- `ON_START` (app foregrounded): check `isLockRequired()`. If true, navigate to lock screen overlay.

On lockout (5 failed PINs in LockScreenViewModel):
- Disconnect LiveKit voice service
- Remove user from room seat
- Suppress push notifications (set flag that notification handler checks)

- [ ] **Step 2: Write tests**

Test: background → foreground after timeout → lock screen shown. Background → foreground within timeout → no lock. Lockout → voice disconnects.

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(lifecycle): add app lock with background timeout and lockout consequences"
```

### Task 27: Add user-facing strings (all 19 locales)

**Files:**
- Modify: `shared/src/commonMain/composeResources/values/strings.xml` (English)
- Modify: all 19 `values-{locale}/strings.xml` files

- [ ] **Step 1: Add English strings**

Add to `values/strings.xml`:
```xml
<!-- PIN & Security -->
<string name="create_pin">Create a PIN</string>
<string name="confirm_pin">Confirm your PIN</string>
<string name="enter_pin">Enter your PIN</string>
<string name="pin_mismatch">PINs don't match. Try again.</string>
<string name="pin_info">You can change or disable this in Security settings</string>
<string name="wrong_pin">Wrong PIN. %d attempts remaining.</string>
<string name="pin_locked">Too many attempts. Try again in %d minutes.</string>
<string name="pin_locked_reauth">Account locked. Please sign in again to reset your PIN.</string>
<string name="reset_pin">Reset PIN</string>
<string name="choose_pin_length">Choose PIN length</string>
<string name="digits">digits</string>

<!-- Biometric -->
<string name="enable_biometric">Enable biometric login?</string>
<string name="biometric_title">Unlock ShyTalk</string>
<string name="biometric_subtitle">Use your fingerprint or face to unlock</string>
<string name="use_pin">Use PIN instead</string>

<!-- Email OTP -->
<string name="email_otp_title">Sign in with email</string>
<string name="enter_email">Enter your email address</string>
<string name="enter_code">Enter verification code</string>
<string name="code_sent">Code sent to %s</string>
<string name="resend_code">Resend code</string>
<string name="resend_in">Resend in %ds</string>
<string name="invalid_code">Invalid code. Try again.</string>
<string name="code_expired">Code expired. Request a new one.</string>
<string name="too_many_requests">Too many requests. Try again later.</string>

<!-- Security Settings -->
<string name="security">Security</string>
<string name="app_lock">App Lock</string>
<string name="lock_timeout">Lock Timeout</string>
<string name="biometric_login">Biometric Login</string>
<string name="linked_accounts">Linked Accounts</string>
<string name="timeout_1min">1 minute</string>
<string name="timeout_5min">5 minutes</string>
<string name="timeout_15min">15 minutes</string>
<string name="timeout_30min">30 minutes</string>
<string name="timeout_never">Never</string>
```

- [ ] **Step 2: Add translations for all 19 locales**

Copy strings to all locale files (ar, de, es, fr, hi, id, it, ja, ko, nl, pl, pt, ru, sv, th, tr, uk, vi, zh) with translated values.

- [ ] **Step 3: Build to verify resources compile**

```bash
./gradlew assembleDevDebug
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(i18n): add PIN, biometric, OTP, and security strings for all 19 locales"
```

### Task 28: Remove old EmailSignInScreen

**Files:**
- Delete: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/auth/EmailSignInScreen.kt`

- [ ] **Step 1: Delete file**

Remove `EmailSignInScreen.kt`. All references should already point to `EmailOtpScreen` from Task 23.

- [ ] **Step 2: Build to verify no broken references**

```bash
./gradlew assembleDevDebug
```

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: remove old EmailSignInScreen replaced by EmailOtpScreen"
```

### Task 29: Final integration test

- [ ] **Step 1: Run all Kotlin unit tests**

```bash
./gradlew test
```

Fix any failures.

- [ ] **Step 2: Run all Express API tests**

```bash
cd express-api && npm test
```

Fix any failures.

- [ ] **Step 3: Build both flavors**

```bash
./gradlew assembleDevDebug assembleProdRelease
```

- [ ] **Step 4: Commit any fixes**

```bash
git commit -m "fix: resolve integration test failures"
```

### Task 30: Sensitive actions PIN gate

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/auth/PinVerifyDialog.kt`
- Modify: Settings screens that handle sensitive actions

- [ ] **Step 1: Create reusable PIN verification dialog**

A modal dialog with PIN keypad that must be completed before proceeding. Used before: change email/link provider, delete account, view/export personal data. Calls `PinRepository.verifyPin()` — on success invokes a callback, on failure shows error.

- [ ] **Step 2: Wire into sensitive action screens**

In LinkedAccounts (link/unlink provider), account deletion, and data export flows — show `PinVerifyDialog` before executing the action. This applies regardless of app lock setting.

- [ ] **Step 3: Write tests**

Test: dialog shown before sensitive action, correct PIN proceeds, wrong PIN blocks.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(security): gate sensitive actions behind PIN verification dialog"
```

### Task 31: Oracle Cloud Email Delivery DNS setup

- [ ] **Step 1: Create approved sender in OCI Console**

OCI Console → Developer Services → Email Delivery → Approved Senders → Add `noreply@shytalk.shyden.co.uk`

- [ ] **Step 2: Generate SMTP credentials**

OCI Console → Identity → Users → SMTP Credentials → Generate. Save username and password.

- [ ] **Step 3: Add SPF record to Cloudflare DNS**

Add TXT record for `shytalk.shyden.co.uk`:
```
v=spf1 include:rp.oracleemaildelivery.com ~all
```

- [ ] **Step 4: Add DKIM record to Cloudflare DNS**

OCI will provide a CNAME or TXT record for DKIM. Add it to Cloudflare DNS for the selector provided by Oracle.

- [ ] **Step 5: Verify domain in OCI**

Wait for DNS propagation, then verify the approved sender in OCI Console.

- [ ] **Step 6: Test email delivery**

Send a test OTP email to a Gmail address. Verify it lands in inbox (not spam). Check SPF/DKIM pass in email headers.

### Task 32: Update Firestore rules and deploy to dev

- [ ] **Step 1: Deploy Firestore rules to dev**

```bash
npx firebase deploy --only firestore:rules --project shytalk-dev
```

- [ ] **Step 2: Deploy Express API to dev**

```bash
cd express-api
tar czf /tmp/api.tar.gz --exclude='node_modules' --exclude='.env' .
scp /tmp/api.tar.gz ubuntu@145.241.224.13:/tmp/
ssh ubuntu@145.241.224.13 "cd ~/express-api && tar xzf /tmp/api.tar.gz && npm install && pm2 restart shytalk-api"
```

- [ ] **Step 3: Verify dev API health**

```bash
curl -sf https://dev-api.shytalk.shyden.co.uk/api/health
```

- [ ] **Step 4: Set SMTP env vars on dev server**

SSH to dev server and add SMTP credentials to `.env`:
```
SMTP_HOST=smtp.email.uk-london-1.oci.oraclecloud.com
SMTP_PORT=587
SMTP_USER=<generated-smtp-user>
SMTP_PASS=<generated-smtp-pass>
```

Restart PM2: `pm2 restart shytalk-api`

- [ ] **Step 5: Commit any remaining changes**

```bash
git commit -m "chore: finalize integration and deploy to dev"
```
