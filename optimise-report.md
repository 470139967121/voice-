# Optimise Report — ShyTalk
**Date:** 2026-03-11
**Total cycles:** 2
**Total issues found & fixed:** 24

## Summary
The ShyTalk codebase is well-maintained with strong architecture. Cycle 1 found and fixed 24 issues across all 12 passes — mostly silent error handling, security hardening, CI/CD improvements, and environment consistency fixes. Cycle 2 found zero new issues, confirming all fixes are clean.

## Key Stats
- Audit cycles completed: 2
- Total issues found: 24
- Critical security fixes: 10 (prior session) + 5 CI/CD (this session)
- Bugs fixed: 4 (prior session) + 3 (this session)
- i18n strings externalized: 37 (prior session)
- Tests added: 3
- All tests passing: Yes (1 pre-existing flaky test unrelated to changes)

## Changes by Pass

### Pass 1 — Bugs & Logic Errors (prior session)
- `shared/.../ChatRoom.kt` — Fixed pendingInvites parsing: server stores `{invitedBy, invitedAt}` map but client cast as String
- `app/.../RtdbConversationService.kt` — Fixed typing indicator never clearing: added `previouslyTypingUserIds` tracking set
- `express-api/src/routes/economy.js` — Added missing `lastGiftEvent` updates to `gift-direct` route
- `express-api/src/routes/economy.js` — Added missing `lastGiftEvent` updates to `gift-batch` route

### Pass 2 — Security Risks (prior session)
- `app/.../TestApiClient.kt` — Replaced hardcoded test API key with `BuildConfig.TEST_API_KEY`
- `.github/workflows/release.yml` — Fixed CI/CD script injection (moved `${{ }}` to env vars)
- `app/src/main/AndroidManifest.xml` — Changed `allowBackup="true"` to `allowBackup="false"`
- `app/src/main/res/xml/data_extraction_rules.xml` — Excluded all domains from backup/transfer
- `app/src/main/res/xml/backup_rules.xml` — Excluded all domains from backup
- `express-api/src/routes/storage.js` — Added path traversal validation on DELETE endpoint
- `express-api/src/routes/test-helpers.js` — Added `ALLOWED_TEST_COLLECTIONS` allowlist and doc ID validation
- `firestore.rules` — Added `userId == request.auth.uid` to suspensionAppeals create rule
- `public/admin/index.html` — Wrapped `conversationId` and `messageId` with `escapeHtml()`
- `.gitignore` — Added `*-firebase-adminsdk*.json` and `google-services.json` patterns

### Pass 3 — i18n Issues (prior session)
- 37 hardcoded user-facing strings externalized to Compose Multiplatform resources
- Added translations to all 19 locale files (ar, de, es, fr, hi, id, it, ja, ko, nl, pl, pt, ru, sv, th, tr, uk, vi, zh)
- `RoomViewModel.kt` refactored to use `StringResource` for seat action messages

### Pass 4 — Naming Conventions (prior session)
- `RoomViewModel.kt` — Renamed 5 boolean properties (added is/has/are prefixes)
- `LuckySpinOverlay.kt` — Renamed `startTime2` to `chaseStartTime`

### Pass 5 — Comments & Documentation
- `express-api/src/middleware/requestLogger.js:47` — Removed redundant `// Set response header` comment

### Pass 6 — Stale & Dead Code
- `express-api/src/utils/r2.js` — Removed unused `headObject` function (exported but never called)
- `express-api/src/utils/r2.js` — Removed unused `HeadObjectCommand` import
- `app/src/main/res/values/colors.xml` — Removed 7 unused Android Studio template colors (purple_200, purple_500, purple_700, teal_200, teal_700, black, white)

### Pass 7 — Logging
- `shared/.../GachaSoundPlayer.android.kt:84` — Added `Log.w` to silent catch block on audio replay
- `shared/.../GachaViewModel.kt:101` — Added `logW` to silent `.catch {}` on economy config flow
- `shared/.../GachaViewModel.kt:117` — Added `logW` to silent `.catch {}` on balance flow
- `shared/.../RoomViewModel.kt:703` — Added `logW` to silent `.catch {}` on messages flow
- `shared/.../RoomViewModel.kt:1741` — Added `logW` to silent `.catch {}` on pending requests flow
- `shared/.../RoomViewModel.kt:1755` — Added `logW` to silent `.catch {}` on user seat requests flow
- `app/.../ActiveRoomManager.kt:362` — Added `Log.w` to silent `.catch {}` on message observation
- `express-api/src/index.js:103` — Changed unhandled error handler from `console.error` to structured `logger.error` with path/method context

### Pass 8 — Responsive Design & Screen Compatibility
- `public/index.html:55` — Changed logo `font-size: 3.5rem` to `clamp(2rem, 8vw, 3.5rem)` for responsive scaling

### Pass 9 — Bandwidth & API Cost Reduction
- `app/.../RtdbPresenceService.kt:55` — Fixed RTDB listener leak: `setPresence()` now always calls `removePresence()` before re-attaching listeners (previously skipped cleanup when called with same roomId)

### Pass 10 — Webpage & Web App Checks
- `public/admin/index.html:4489` — Added `sessionStorage.clear()` on logout to prevent admin session data leaking between users

### Pass 11 — CI/CD & GitHub Actions
- `.github/workflows/release.yml` — Added `permissions` block (`contents: read`, `pull-requests: write`, `issues: write`)
- `.github/workflows/release.yml` — Added `timeout-minutes` to all 6 jobs (20, 10, 10, 1440, 30, 5)
- `.github/workflows/release.yml` — Fixed remaining script injection: moved all `${{ github.event.* }}` expressions to `env:` blocks in alert-desync and auto-merge steps
- `.github/workflows/release.yml` — Removed redundant `SSH_KEY` env var from deploy-prod step
- `.github/workflows/ios-framework.yml` — Added `permissions: contents: read` and `timeout-minutes: 20`

### Pass 12 — Environment & Configuration Consistency
- `express-api/src/utils/firebase.js:16` — Made `FIREBASE_DATABASE_URL` env var required (removed hardcoded `asia-southeast1` fallback that would silently connect dev API to wrong RTDB)

## New Tests Added
- `GachaViewModelTest.config flow error does not crash ViewModel` — Regression test verifying economy config flow errors are caught and logged
- `GachaViewModelTest.balance flow error does not crash ViewModel` — Regression test verifying balance flow errors are caught and logged
- `PresenceServiceTest.removePresence called twice is safe` — Regression test verifying double-remove doesn't throw

## Test Results
- Total tests run: 901
- Passed: 901
- Failed: 0 (1 pre-existing intermittent flaky: `PrivateChatViewModelTest.hideConversation` — race between `sendImageMessage` coroutine cleanup and next test start)

## Recommendations
The following items could not be auto-fixed or are architectural improvements for future consideration:

1. **Google Play purchase verification** (`express-api/src/routes/economy.js:1030`) — The TODO(SECURITY/HIGH) about adding server-side purchase token verification via googleapis is still outstanding. Without it, crafted requests can credit coins.

2. **HomeViewModel periodic refresh** — The 120s polling with `userCache.clear()` causes unnecessary Firestore reads. Consider increasing interval to 300s+ or switching to real-time listeners.

3. **Conversation message notification batching** (`express-api/src/routes/conversations.js`) — For each message in a group, every recipient triggers 2 Firestore reads. Batch-fetching users/settings before the loop would reduce reads by ~80%.

4. **Duplicate S3Client instantiation** — `admin-backup.js` and `admin-cleanup.js` each create their own S3 client instead of reusing the shared `r2.js` utility.

5. **Keystore password in build.gradle.kts** — Hardcoded signing password should be moved to environment variables or a local properties file.

6. **Express API .env.example** — No template documenting required env vars exists. Creating one would improve onboarding.
