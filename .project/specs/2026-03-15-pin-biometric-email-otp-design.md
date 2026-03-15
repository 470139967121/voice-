# PIN + Biometric + Email OTP Authentication

**Date:** 2026-03-15
**Status:** Approved

## Overview

Universal session layer: PIN and biometric authentication on top of all sign-in methods (Google, Apple, Email OTP). Eliminates the current forced re-auth on every app launch. Email OTP via Oracle Cloud Email Delivery enables email-based sign-up without third-party email services.

## Auth Flow

### First time (new device)

1. Sign-in screen → Google / Apple / Email OTP
2. Identity resolution (existing flow)
3. Device binding check (all sign-in methods)
4. PIN creation screen (mandatory, 4-8 digits)
5. Biometric prompt ("Enable biometric login?" — optional)
6. Info note: "You can change or disable this in Security settings"
7. → App

### Returning (same device, credential exists)

1. App lock screen → Biometric (auto-triggers if enabled) or PIN
2. Express API verifies → issues Firebase custom token
3. Client signs in with custom token → app
4. **Offline fallback:** if server unreachable, use cached Firebase session (valid up to 1 hour). PIN verified against local bcrypt hash stored in `SecureStorage`. Full server verification on next online unlock.

### New device with existing account

1. Sign-in screen → Google / Apple / Email OTP
2. Identity resolution finds existing account
3. Device binding check
4. PIN creation screen (server replaces old hash)
5. Biometric prompt
6. → App

### Key change

The current `authRepository.signOut()` on every launch is removed. The app checks for a stored device credential and shows the lock screen if found.

### Sign-out flow

When the user signs out:
1. Clear local credential store (`uniqueId`, `deviceId`, preferences, cached session)
2. Revoke biometric key for this device on server (`DELETE /api/auth/biometric/{deviceId}`)
3. Do NOT delete server-side `pinHash` (user may sign in on same device again)
4. Clear `SecureStorage` (removes local PIN hash, biometric flag, lock settings)
5. Show sign-in screen

## Email OTP System

### Oracle Cloud Email Delivery

- SMTP via port 587 (TLS) — no port 25 unblock needed
- Sender: `noreply@shytalk.shyden.co.uk`
- SPF + DKIM records on Cloudflare DNS
- Always Free tier: 100 emails/day. Monitor usage; if limit approached, log warnings. If limit hit, OTP send returns error and client shows "Too many requests, try again later or use Google/Apple sign-in."

### OTP Generation (Express API)

- 6-digit numeric code
- Stored in Firestore: `otpCodes/{email}` → `{hashedCode, expiresAt, attempts, requestCount, firstRequestAt}`
- Expires after 10 minutes
- Max 3 verification attempts per code (then must request new one)
- Rate limit: max 5 OTP requests per email per hour. Fixed window from `firstRequestAt`; after 60 minutes from `firstRequestAt`, both `requestCount` and `firstRequestAt` reset.

### Flow

1. User enters email → `POST /api/auth/otp/send` → generates code, sends email
2. User enters code → `POST /api/auth/otp/verify` → validates, returns Firebase custom token
3. Client signs in with custom token → identity resolution → device binding check → PIN creation

## PIN System

### Creation

- Shown after first successful sign-in on a device (any method)
- Numeric keypad UI, 4-8 digits, user chooses length
- Enter PIN → confirm PIN → stored

### Storage

- Server: `users/{uniqueId}` gets new fields: `pinHash` (bcrypt), `pinSetAt`, `pinAttempts`, `pinLockedUntil`, `pinLockoutCount`
- Express API handles all hashing — client sends plaintext PIN over HTTPS, server bcrypts
- Local: bcrypt hash also cached in `SecureStorage` for offline PIN verification
- Certificate pinning recommended: OkHttp `CertificatePinner` on Android, `NSAppTransportSecurity` on iOS

### Verification

- `POST /api/auth/pin/verify` — body: `{uniqueId, deviceId, pin}`
- Server compares bcrypt hash
- On success: returns Firebase custom token + resets attempt counter
- On failure: increments attempt counter
- Offline: verify against local bcrypt hash in `SecureStorage`, use cached Firebase session

### Lockout

- 5 failed attempts → 15-minute timed lockout
- After lockout expires → 5 more attempts
- Second lockout → re-auth required:
  - **Google/Apple users:** re-authenticate via Google/Apple → forced PIN re-creation
  - **Email-only users:** email OTP → unlock → forced PIN re-creation
- After successful re-auth and PIN re-creation, `pinLockoutCount` resets to 0
- Lockout fields stored on user document: `users/{uniqueId}` → `pinAttempts`, `pinLockedUntil`, `pinLockoutCount`
- Biometric bypasses PIN lockout (separate auth factor)

### Lockout consequences

- On lockout (5 failed attempts): voice service disconnects, user removed from room, push notifications suppressed
- On successful unlock: notifications resume, user not auto-rejoined to room
- Lock screen (before lockout) does NOT disconnect voice or suppress notifications
- **Biometric grace period:** if biometric succeeds within 10 seconds of lockout triggering, skip voice disconnect and notification suppression (undo lockout consequences)

### Reset PIN

1. Settings → Security → Reset PIN
2. Verify identity via any linked method:
   - Google/Apple → re-authenticate
   - Email-only → email OTP
3. Clears lockout state (`pinAttempts`, `pinLockedUntil`, `pinLockoutCount` reset)
4. Enter new PIN → confirm → saved

## Biometric System

### Setup

- Offered after PIN creation: "Enable biometric login?"
- Also available in Settings → Security → toggle on/off
- Uses platform native APIs:
  - Android: `BiometricPrompt` (fingerprint/face)
  - iOS: `LAContext` (Face ID/Touch ID)
- KMP `expect/actual` in `core/util/PlatformBiometric`

### How it works

- On enable: generate keypair, store private key in platform keystore (Android Keystore / iOS Keychain), send public key to server
- On unlock: biometric prompt → signs challenge with private key → server verifies signature → issues Firebase custom token
- No PIN sent, no biometric data leaves device

### Challenge endpoint security

- `GET /api/auth/biometric/challenge` requires `uniqueId + deviceId` in query params
- Server validates the pair exists in `biometricKeys` before issuing a challenge
- Challenge is a random 32-byte nonce, expires after 60 seconds
- Rate limited: 10 per minute per deviceId

### Fallback

- Lock screen shows both biometric and PIN — biometric auto-triggers, PIN keypad visible underneath
- "Use PIN instead" button on biometric prompt
- If biometric hardware fails/unavailable → auto-fall back to PIN
- Biometric bypasses PIN lockout entirely

### KMP interface

```kotlin
sealed class BiometricResult {
    object Success : BiometricResult()
    object Fallback : BiometricResult()  // user chose "Use PIN"
    data class Error(val message: String) : BiometricResult()
}

expect class BiometricAuth {
    fun isAvailable(): Boolean
    suspend fun authenticate(title: String, subtitle: String): BiometricResult
}
```

- `androidMain`: `BiometricPrompt` with `CryptoObject`, wrapped in `suspendCancellableCoroutine`
- `iosMain`: `LAContext.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)`, wrapped in `suspendCancellableCoroutine`

## App Lock & Session Management

### Background timeout (configurable)

- Options: 1 min, 5 min, 15 min, 30 min, Never
- Default: 5 min
- Timer starts when app goes to background, counts while backgrounded
- No timeout while app is in foreground — session stays alive indefinitely
- Background voice stays connected — audio continues, presence remains

### App lock toggle

- Settings → Security → App Lock (on/off)
- Off = never prompted for PIN/biometric on launch (still required for sensitive actions)
- On = prompted after background timeout expires

### Sensitive actions (always require PIN regardless of app lock setting)

- Change email / link new provider
- Change PIN
- Delete account
- View/export personal data

### Session lifecycle

1. App launches → check device credential exists?
   - No → sign-in screen (first time / cleared data)
   - Yes → check app lock enabled?
     - No → restore session silently (custom token from server; if offline, use cached Firebase session)
     - Yes → check background timeout expired?
       - No → restore session silently
       - Yes → lock screen (biometric + PIN)
2. Lock screen → verify → custom token → Firebase session → app
3. App backgrounded → start timeout timer
4. App foregrounded → check timer → lock or resume

### Lock screen behavior

- Before lockout: voice stays connected, push notifications continue normally
- On lockout (5 failed PINs): voice disconnects, removed from room, notifications suppressed
- On unlock after lockout: notifications resume, not auto-rejoined to room
- Biometric grace period: if biometric succeeds within 10 seconds of lockout, undo consequences

### Local storage (per device)

- `SecureStorage` (KMP expect/actual): `EncryptedSharedPreferences` on Android, `Keychain` on iOS
- Fields: `credentialVersion` (integer, currently 1), `uniqueId`, `deviceId`, `appLockEnabled`, `biometricEnabled`, `lockTimeoutMinutes`, `lastActiveTimestamp`, `localPinHash` (bcrypt, for offline verification)
- No plaintext PINs stored — only bcrypt hash for offline fallback
- `deviceId`: uses existing `DeviceRepository` which reads `Settings.Secure.ANDROID_ID` on Android
- **EncryptedSharedPreferences corruption recovery (Android API 28):** if decryption fails, treat as no stored credential and force fresh sign-in flow. Log the corruption event.
- **Android Auto Backup:** exclude `SecureStorage` file via `android:fullBackupContent` rules to prevent stale credentials on restore
- **Credential versioning:** `credentialVersion` checked on launch; if outdated, run migration logic. If missing, treat as no credential.

## Settings — Security Tab

New `SettingsPage.Security` entry:

- **App Lock** — toggle (on/off), default on
- **Lock Timeout** — dropdown: 1 min, 5 min, 15 min, 30 min, Never (only visible when app lock is on)
- **Biometric Login** — toggle (on/off), shows device capability (e.g. "Fingerprint" / "Face ID")
- **Reset PIN** — verify via linked sign-in method → set new PIN + clear lockout state
- **Linked Accounts** — (existing, moved under Security)

Navigation: Settings main page gets a "Security" row.

## Email Templates

### Template engine

HTML strings in Express API (`src/utils/email-templates.js`). No external templating library.

### Sender

`noreply@shytalk.shyden.co.uk` via Oracle Cloud Email Delivery SMTP (port 587).

### Design

- Dark background (#1a1a2e), light text
- ShyTalk app logo from `images.shytalk.shyden.co.uk`
- OTP code in large spaced digits on darker pill (#2a2a4e)
- Minimal footer: "ShyTalk — Voice Chat Rooms"
- No unsubscribe link (transactional emails, not marketing)

### Email types

| Email | Subject | Content |
|---|---|---|
| Sign-up / new device OTP | "Your ShyTalk verification code" | Code + 10 min expiry note |
| PIN lockout unlock | "Unlock your ShyTalk account" | Code + explanation of why locked |
| Account recovery | "Reset your ShyTalk PIN" | Code + instructions |

### Shared structure

- Logo header
- Greeting ("Hi there,")
- Purpose line (varies per type)
- OTP code block
- Expiry/security note
- Footer + "If you didn't request this, ignore this email."

## Express API Routes

New file: `express-api/src/routes/auth.js`

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/otp/send` | None | Send OTP to email (rate limited) |
| POST | `/api/auth/otp/verify` | None | Verify OTP, return Firebase custom token |
| POST | `/api/auth/pin/setup` | Firebase token | Create/replace PIN hash for user |
| POST | `/api/auth/pin/verify` | None | Verify PIN + deviceId, return custom token |
| POST | `/api/auth/pin/reset` | Firebase token | Reset PIN + clear lockout (after re-auth) |
| POST | `/api/auth/biometric/register` | Firebase token | Store public key for device |
| POST | `/api/auth/biometric/verify` | None | Verify signed challenge, return custom token |
| GET | `/api/auth/biometric/challenge` | None* | Get random challenge (*requires valid uniqueId+deviceId pair in biometricKeys) |
| DELETE | `/api/auth/biometric/:deviceId` | Firebase token | Revoke biometric key on sign-out |

### Firestore collections

| Collection | Document ID | Fields |
|---|---|---|
| `otpCodes` | `{email}` | `hashedCode`, `expiresAt`, `attempts`, `requestCount`, `firstRequestAt` |
| `biometricKeys` | `{uniqueId}:{deviceId}` | `publicKey`, `createdAt` |

PIN and lockout fields stored on user document: `users/{uniqueId}` → `pinHash`, `pinSetAt`, `pinAttempts`, `pinLockedUntil`, `pinLockoutCount`

### Rate limiting

- OTP send: 5 per email per hour (fixed window from firstRequestAt)
- PIN verify: 5 attempts before lockout
- Biometric challenge: 10 per minute per deviceId (requires valid biometricKeys entry)

## KMP Architecture (shared module)

### New expect/actual classes

| Interface | commonMain | androidMain | iosMain |
|---|---|---|---|
| `BiometricAuth` | expect class | `BiometricPrompt` | `LAContext` |
| `SecureStorage` | expect class | `EncryptedSharedPreferences` | `Keychain` |
| `CryptoKeyPair` | expect class | `Android Keystore` | `iOS SecureEnclave` |

### New repositories (shared)

| Repository | Purpose |
|---|---|
| `PinRepository` | Setup, verify, reset PIN via Express API |
| `BiometricRepository` | Register, challenge/verify via Express API |
| `OtpRepository` | Send, verify OTP via Express API |
| `AppLockRepository` | Local lock state, timeout, preferences via SecureStorage |

### New ViewModels (shared)

| ViewModel | Screens |
|---|---|
| `LockScreenViewModel` | Lock screen (PIN + biometric) |
| `PinSetupViewModel` | PIN creation/reset |
| `EmailOtpViewModel` | Email OTP entry (replaces current email link flow) |

### New screens (shared, Compose Multiplatform)

| Screen | Purpose |
|---|---|
| `LockScreen` | PIN keypad + biometric prompt on foreground return |
| `PinSetupScreen` | Create PIN (4-8 digits) + confirm, shown after first sign-in |
| `EmailOtpScreen` | Enter email → enter code (replaces `EmailSignInScreen`) |
| `SecuritySettingsScreen` | App lock, timeout, biometric, reset PIN |

### Existing screen changes

- `GoogleSignInScreen` → rename to `SignInScreen` (file, class, nav route, all references). Stays in `app/` (Android-only); iOS has its own sign-in in `iosApp/`.
- `EmailSignInScreen` → replaced by `EmailOtpScreen` in `shared/`. Update `Screen.EmailSignIn` route in NavGraph to use `EmailOtpScreen`. Remove old `EmailSignInScreen.kt`.
- `AppSettingsScreen` → add "Security" row navigating to `SecuritySettingsScreen`
- `NavGraph` → add routes for new screens (LockScreen, PinSetupScreen, SecuritySettingsScreen), update SignIn and EmailSignIn routes
- `AuthViewModel` → remove `signOut()` on init, add PIN setup routing after identity resolution (check `pinHash` on user document)

## Infrastructure

### Oracle Cloud Email Delivery setup

1. OCI Console → Developer Services → Email Delivery
2. Add approved sender: `noreply@shytalk.shyden.co.uk`
3. Generate SMTP credentials
4. Cloudflare DNS: add SPF + DKIM records
5. Express API: Nodemailer with SMTP endpoint + credentials
6. Store SMTP credentials as environment variables on Oracle Cloud VMs

### Firestore security rules

Add rules for new collections: `otpCodes`, `biometricKeys`. Server-side only (no client read/write). PIN/lockout fields on `users/{uniqueId}` already covered by existing user rules (writes via Admin SDK bypass rules).

### New dependencies

- Express API: `nodemailer`, `bcrypt`
- Android: `androidx.biometric:biometric` (already available via AndroidX)
- iOS: `LocalAuthentication` framework (system, no dependency needed)
- KMP: `androidx.security:security-crypto` (for EncryptedSharedPreferences on Android)

## Existing user migration

Current Google/Apple users will see a mandatory "Create a PIN" screen on next app launch. Non-dismissable. The app detects no `pinHash` on the user document and routes to `PinSetupScreen` after identity resolution.
