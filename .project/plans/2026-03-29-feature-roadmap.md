# ShyTalk Feature Roadmap

_Prioritised 2026-03-29 — last revised 2026-05-02 (memory-vs-roadmap diff pass: corrected B5/B6/#37/#46 PR numbers, split iOS parity into accurate sub-items, surfaced 19 testing sub-projects from `project-testing-roadmap.md`, added missing infrastructure/web/regulatory items)._

> **Tri-platform policy (2026-04-19):** All work must keep desktop (web), iOS, and Android in
> sync. No platform can fall behind. Every future feature must ship on all applicable platforms simultaneously.

---

## Phase 0 — Infrastructure & Code Health (do first)

These enable everything else. SonarCloud blocks all future PRs. Allure gives visibility. Legal
branding is quick and overdue. Phase 0 is internal infrastructure and not shown on the public
roadmap — user-facing web features previously listed here have moved to Phase 6.

| #   | Feature                                                                                                                                                                                          | Effort | Status                                                        |
|-----|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------|---------------------------------------------------------------|
| 36  | **Fix all SonarCloud issues on main** — 500+ issues, must be clean before quality gate blocks PRs                                                                                                | Medium | DONE (PR #223, 2026-03-30) — 400+ fixed, quality gate passing |
| 37  | **Allure report directory structure** — per-suite, per-environment, landing page. See `2026-03-29-allure-directory-spec.md`                                                                      | Medium | DONE (PR #243, 2026-03-31) — landing page is hand-maintained `gh-pages:index.html`; new suites need a manual update (#67 below tracks the auto-generator) |
| 35  | **Legal docs: Shyden Ltd branding** — update all public docs and legal pages                                                                                                                     | Small  | DONE (PR #280, 2026-04-09)                                    |
| 40  | **CI workflow deduplication** — extract duplicated steps into reusable workflows (Firebase rules deploy, google-services decode, iOS signing, Allure report). 6+ workflows have duplicated logic | Small  | DONE (PR #282, 2026-04-09)                                    |
| 41  | **Admin panel restructure** — break 12,000+ line index.html into modular ES modules. PR A (core modules), PR B (tab extraction), PR C (wiring + cleanup)                                        | Large  | DONE (PR A #289, PR B #301, PR C #304, 2026-04-20)            |
| 51  | **Seasonal events system** — reusable date-gated theming for holidays (Khmer New Year, Diwali, etc.). Events.json registry, seasonal-theme.js, SeasonalTheme.kt, educational pages               | Medium | DONE (PR #302, 2026-04-16)                                    |
| 52  | **Khmer (km) as 20th locale** — full app translation to Khmer script (771/781 strings)                                                                                                           | Medium | DONE (PR #302, 2026-04-16)                                    |
| 53  | **Admin core module tests** — 34 Jest unit tests + 9 Playwright integration tests for PR A core modules                                                                                          | Small  | DONE (PR #290, 2026-04-13)                                    |
| 56  | **CI paid-runner lint guard** — pre-push + workflow lint that rejects `*-xlarge`, `*-cores`, `large-*` runner specs. Prevents repeat of PR #370 (queued indefinitely on nonexistent paid runners). See `feedback-larger-runners-paid.md` | Small  | DONE (PR #390, 2026-04-29)                                    |
| 57  | **CI stuck-run reaper** — scheduled workflow auto-cancels any run stuck in `queued` for >30 min. Self-heals stale concurrency locks regardless of cause (deleted self-hosted runner, account quota, ghosted dispatch, paid-runner mistake) | Small  | DONE (PR #399, 2026-04-29)                                    |
| 58  | **GitHub org migration — Shyden Ltd namespace** — create free GitHub org (`shyden-ltd` or similar), transfer repo from personal account. Aligns with future Shyden Ltd company site (coordinated with W6). Update Cloudflare Pages source, README badges, in-app source links, Express API references, GitHub App installations. NOTE: does NOT unlock larger runners (paid on every plan), purely organisational/professional move | Medium |                                                               |
| 59  | **`actionlint`/`shellcheck` CI job** — catches unquoted globs, missing `set -euo pipefail`, and other bash anti-patterns in workflow `run:` blocks at PR time, not after a 20-min iOS deploy. Surfaced by the 2026-04-24 CI audit (`project-ci-workflow-audit.md`)                                                                          | Small  | DONE (PR #387, 2026-04-29)                                    |
| 60  | **iOS deploy export-only dry-run job** — path-filtered (`iosApp/ExportOptions.plist`, `.github/workflows/deploy-*.yml`) PR job that runs archive + exportArchive + IPA verify but stops before TestFlight upload. Validates IPA materialises without burning a TestFlight build number. Would have caught the 2026-03-12 silent-upload regression in week 1 instead of week 7 | Medium |                                                               |
| 61  | **Composite `cleanup-ios-signing` action** — extract the cleanup logic currently inlined in `deploy-dev.yml` and `deploy-prod.yml` into a sibling action paired with `setup-ios-signing`. Single source of truth eliminates the drift trap that already cost us once (PR #372 audit found cleanup missing 3 paths) | Small  | DONE (PRs #388, #394, 2026-04-29)                             |
| 62  | **iOS deploy pre-cleanup step** — scrub leftovers from prior crashed runs (where `if: always()` cleanup didn't get to run — runner force-killed, machine reboot, network partition past cancel timeout). Mandatory hygiene for self-hosted Mac with persistent FS                                                                  | Small  | DONE (PR #395, 2026-04-29)                                    |
| 63  | **Move `.p8` to `$RUNNER_TEMP/private_keys/`** — App Store Connect API key currently lives in `$HOME/private_keys/`, persisting across runs if any prior run crashed before cleanup. Moving to `$RUNNER_TEMP` scopes it to per-job lifetime. Blocked on PR #372 merging (current cleanup path references `$HOME`)                | Small  | DONE (PR #396, 2026-04-29)                                    |
| 64  | **Health-check returns deployed git SHA** — `/api/health` should return the deployed commit SHA so deploy workflows can assert the new code is actually serving (not stale pm2 process from prior deploy). Closes the "deploy succeeded but new code isn't running" silent-failure class. Backend change                            | Small  | DONE (PR #397, 2026-04-29)                                    |
| 65  | **Smoke-test gate AND not OR** — `smoke-test-backend-web` runs if EITHER backend OR web deploy succeeded. After a partial deploy failure, the green smoke-test job visually contradicts the red deploy job. Either AND-gate or split into per-surface jobs                                                                          | Small  | DONE (PR #389, 2026-04-29)                                    |
| 66  | **LiveKitWebRTC dSYM ingestion** — re-enable `uploadSymbols: true` in `ExportOptions.plist` for proper crash-symbolication of WebRTC stack frames. **2026-04-29 research finding:** `LiveKitWebRTC` is a closed-source binary pod (version 125.6422.11) — the WebRTC binary itself isn't on any public LiveKit GitHub repo (only the Swift wrapper `livekit/client-sdk-swift` is). Need to open an upstream issue asking LiveKit if they ship dSYMs as separate download artifacts or via a private CocoaPod. Until then, `uploadSymbols: false` is correct (App Store doesn't reject builds for missing dSYMs; crash reports just won't symbolicate WebRTC frames) | Small  | TODO — file upstream LiveKit issue first, then this PR        |
| 67  | **Allure landing page auto-generator** — currently `gh-pages:index.html` is a static, hand-maintained landing (every new suite — e.g. iOS E2E in commit `256921b329` — needs a separate PR to update the landing). Move to a `scripts/generate-allure-landing.js` that builds the landing from a registry of suites + their latest deploy/PR badges, called from `.github/workflows/allure-report.yml`                                                | Small  | DONE (2026-05-03) — `scripts/allure-suites.json` registry + `scripts/generate-allure-landing.js` ship the static-card layout from a JSON list. Adding a new suite is now a one-entry registry append. 12 Jest tests pin the contract (escaping, required fields, output structure). Workflow integration (per-deploy regen via `allure-report.yml`) deferred to a follow-up PR — no functional impact, hand-running `node scripts/generate-allure-landing.js` is the immediate replacement |
| 68  | **CodeQL Kotlin re-enablement** — re-enable Kotlin analysis in `codeql-analysis.yml` once `github/codeql-action` extractor supports Kotlin 2.4.x. Currently disabled; tracked at `project-codeql-kotlin-update.md` (re-disabled 2026-04-27)                                                                                            | Small  | BLOCKED on upstream extractor support                         |
| 69  | **Kotlin 2.4.0-Beta2 → 2.4.0 stable upgrade** — `gradle/libs.versions.toml:3` is pinned to Beta2 because K/N 2.3.x has an `AutoboxingTransformer` crash blocking iOS linking. Upgrade to stable when released; remove the comment workaround                                                                                          | Small  |                                                               |
| 70  | **CI workflow audit follow-ups (2026-04-24)** — three remaining items from `project-ci-workflow-audit.md`: (a) macos-14 vs macos-15 mismatch in `ios-tests.yml`; (b) `xcrun altool --upload-app` deprecation switch to `xcrun notarytool` / Transporter; (c) dependabot-auto-merge approves before CI checks complete                | Small  | (a) DONE (2026-05-03) — `ios-tests.yml` bumped from macos-14 to macos-15 to match the deploy workflow runner pool. (b) DEFERRED — altool deprecation is non-blocking; iTMSTransporter migration has different auth/exit-code semantics worth a dedicated PR. (c) DEFERRED — `gh pr merge --auto` already gates on CI; the early `gh pr review --approve` is informational only |
| 71  | **Environment secrets migration** — move ~17 secrets from repo-level to dev/prod GitHub environments so dev secrets aren't reachable from prod-flavoured workflows (and vice versa). Only `ADMIN_EMAIL`/`ADMIN_PASSWORD` migrated so far. Tracked at `project-environment-secrets-migration.md`                                          | Medium |                                                               |
| 72  | **Express API test depth** — ~220-250 new tests across 10 thin Express files; spec at `.project/plans/2026-03-20-express-api-test-depth-design.md`. Includes the latent `expireTempIds.js` 500-batch-write chunking bug. Paused for prior priority work; spec is ready                                                              | Large  |                                                               |
| 73  | **Dependabot configuration audit** — `.github/dependabot.yml` should cover gradle, npm, github-actions ecosystems with weekly cadence + auto-merge for patch versions. Verify coverage scope vs `project-dependabot.md` (PR #270 confirmed live; coverage may still be partial across ecosystems)                                | Small  | DONE (verified 2026-05-03) — `.github/dependabot.yml` covers all 4 directory/ecosystem pairs (gradle root, npm `/express-api`, npm root, github-actions root) all weekly Mon 06:00 UTC. `dependabot-auto-merge.yml` auto-merges patch + minor + all github-actions updates per `gh pr merge --auto --squash` (which gates on CI). Major-version updates of Firebase / Compose / Kotlin / Android Gradle Plugin are explicitly ignored to prevent runaway upgrades |
| 74  | **Review standards enforcement automation** — encode the `pr-review-toolkit` / `feature-dev:code-reviewer` checks in pre-commit / pre-push so common-class issues (Gherkin scenario size, KMP/Compose conventions) fail PRs at lint time, not at human-review time. Tracked at `project-review-standards-enforcement.md`              | Medium | PARTIAL (2026-05-03) — Gherkin already enforced via `.claude/hooks/check-gherkin.sh`. Added `.claude/hooks/check-kmp-compat.sh` (KMP-only-API ban for commonMain) wired into `*.{kt,kts}` lint-staged. 8 Jest cases pin the rules. Compose-specific conventions (no fixed sp/dp, etc.) remain a follow-up |
| 75  | **Self-hosted Postfix mail server (Oracle Cloud)** — provisions our own SMTP server so Firebase Auth Email Link sign-in (Resolved B12) works without paying for SendGrid. Blocked on Oracle Cloud port-25 unblock request. Tracked at `project-future-self-hosting.md`                                                                | Medium | BLOCKED on Oracle port 25 unblock request                     |
| 76  | **Self-hosted LiveKit (Oracle Cloud) — full migration** — already partial (multi-region routing in `livekit-asia` + `livekit-eu`); complete the migration off LiveKit Cloud to save ~£600/yr. Tracked at `project-future-self-hosting.md`                                                                                            | Medium |                                                               |
| 77  | **Gifts seed data + create-store redesign** — overhaul of how gifts are seeded (`local/seed.js`), created (admin tool), and stored (Firestore `gifts/`). Flagged by user 2026-05-02 as **NEEDS DISCUSSION** before implementation. See `project-gifts-seed-redesign.md`                                                              | Medium | NEEDS DISCUSSION                                              |
| B16 | **Cross-device E2E testing** — admin actions (suspension, moderation, ban cascade) performed in admin panel and verified in app on real device. Proves full pipeline end-to-end                  | Large  |                                                               |

---

## Phase 0.5 — Test Infrastructure (parallel to Phase 0)

19 sub-projects surfaced from `project-testing-roadmap.md` and `project-test-coverage-2026-03.md` that the previous roadmap collapsed under "Resolved B9/B10". These are **separate initiatives**, not "already integrated". Letter codes T-A through T-S align with the source memory's letter codes for cross-reference. T-T and T-U are additional items not in the original testing-roadmap memory.

| #    | Feature                                                                                                                                                              | Tier | Effort | Status |
|------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|------|--------|--------|
| T-A  | **Express API test gaps** — fill missing route tests (auth.js, admin-backup.js, admin-migrate.js, test-helpers.js), util tests (r2.js, system-pm.js, firebase.js), cron tests (staleRooms.js, index.js, testDataCleanup.js), middleware tests (cors.js, rateLimit.js). Foundation gap; precedes #72 (Express API test depth) | 1 | Medium |  |
| T-B  | **Kotlin test gaps** — 3 missing repository tests (BiometricRepositoryImpl, OtpRepositoryImpl, PinRepositoryImpl) + Jest/Gradle coverage config | 1 | Small | DONE (verified 2026-05-03) — all three test files exist (820 LoC total), pass green via `./gradlew :app:testLocalDebugUnitTest --tests '*BiometricRepositoryImplTest' --tests '*OtpRepositoryImplTest' --tests '*PinRepositoryImplTest'`. Coverage configs already wired (`jacoco` plugin in `app/build.gradle.kts`, `--coverage --coverageReporters=lcov` in Jest CLI invocations). Marked stale-as-of-discovery |
| T-C  | **Playwright upgrade** — convert 101 tests from visibility checks to functional BDD with real Firestore verification + setup/teardown | 3 | Medium |  |
| T-D  | **E2E screen coverage** — 10 screens with zero E2E coverage (RequiredDOB, Splash, GroupChat, ReportReview, Browser, UnsafeDevice, ForceUpdate, Degraded, Suspension, Ban) | 2 | Medium |  |
| T-E  | **E2E workflow validation** — get the shell-based emulator CI (`e2e-tests.yml`) working for first successful run | 1 | Small |  |
| T-F  | **KMP E2E migration to commonTest / XCTest** — move E2E tests from `app/src/androidTest/` to shared Compose Multiplatform so the same scenarios run on iOS via XCUITest | 4 | Large |  |
| T-G  | **Performance testing** — Express API load testing + Android app benchmarks (startup time, room-join latency, gift-burst frame budget). Track regression baseline + alert on PR-time delta | 2 | Medium |  |
| T-H  | **Contract testing (Pact)** — between Express API and Kotlin/Web clients, so backend changes that break clients fail PR before deploy | 2 | Medium |  |
| T-I  | **Visual regression (Paparazzi or screenshot-based)** — Compose screenshot tests for UI drift detection, golden-image diff per Compose preview, fail PR on unintentional visual drift | 3 | Medium |  |
| T-J  | **Accessibility testing (a11y)** — automated a11y assertions on Compose screens (TalkBack labels, content descriptions, touch targets, contrast ratios) + Playwright a11y axe-core scans on web | 2 | Medium |  |
| T-K  | **Chaos / resilience testing** — fault injection (Firebase down, RTDB disconnect, network drops mid-room); kill Firebase emulators mid-test, restart Express mid-request, assert clients recover | 4 | Medium |  |
| T-L  | **OWASP ZAP security scanning** — scheduled DAST scan in CI against Express API + admin panel; alert on new vulnerabilities | 3 | Medium |  |
| T-M  | **Database migration testing** — for every Firestore migration commit, run a fixture forward + rollback test to assert data integrity (Firestore schema compatibility with `fromMap()` methods) | 4 | Small |  |
| T-N  | **Flaky-test detection / quarantine** — multi-run analysis to identify and fix inconsistent tests; auto-quarantine + reopen as bugs | 3 | Medium |  |
| T-O  | **Localization testing** — automated screenshot comparison across all 20 locales (text truncation, RTL issues); render every screen and diff against baseline so a translation that overflows a button fails CI | 4 | Medium |  |
| T-P  | **Voice chaos testing** — LiveKit edge cases (connection drops, rejoining, speaker switching under load); simulate flaky network conditions (packet loss, jitter) and assert the room stays stable | 4 | Medium |  |
| T-Q  | **Cross-platform E2E testing** — unified E2E test suite that runs the same scenarios on Android + iOS + Web Playwright in one CI matrix job, verifying feature parity across platforms | 4 | Large |  |
| T-R  | **Deepen current E2E testing** — expand existing 33 feature files / 141 scenarios with more edge cases, negative paths, error states, and deeper assertions beyond happy paths | 4 | Large |  |
| T-S  | **Retroactive exhaustive testing** — apply the full testing depth standard (see `feedback-testing-depth.md`) to ALL existing areas. Audit every feature, screen, API endpoint, cron job, utility, middleware, admin panel section, and CI workflow against all testing dimensions (functional, security, accessibility, i18n, performance, chaos, state machine, absence, contracts, regression). Decompose into sub-tasks per feature area | 4 | Large |  |
| T-T  | **Suggestions board test data fix** — `suggestions-board.spec.ts` + `admin-suggestions.spec.ts` selector mismatches (10.5s timeouts). See `project-playwright-test-data.md`. Not in original testing-roadmap memory | 1 | Small | DONE (verified 2026-05-03) — `suggestions-board.spec.ts` passes 137/137 chromium locally (1.7m); admin-suggestions only flake remaining is the badge-count timing case fixed in PR #427 (commit 1e726f60c4). Selectors and route mocking aligned in prior PRs |
| T-U  | **Test mock-isolation cleanup** — outstanding cases of cross-test mock bleed (`feedback-test-mock-isolation.md` was reactive; sweep for prevention). Not in original testing-roadmap memory | 2 | Small |  |
| T-V  | **Full cross-platform manual QA regression cycle** — run the complete `/manual-qa` skill end-to-end (37 cross-platform journeys + 312 manual TCs across Chrome/Firefox/Safari/Android device/iOS Simulator/admin panel/portal), achieve two consecutive zero-failure cycles per the skill's gate. Deferred from 2026-05-04 dev bug-triage session — surfaced 7 user-reported bugs (DMs, voice connect, follow, photo upload, voice-error auto-close, banner gaps, toast UX) that escaped because the last clean full regression was Cycle 4 on 2026-04-16; cycles 5–6 never re-converged. Multi-day work. Treat the pass as a coverage-discovery exercise — every undocumented finding adds a TC + an automated test before its fix lands | 1 | Large |  |

---

## Phase 1 — Compliance & Legal (non-negotiable)

App store rejection or legal liability if missing. All features must be implemented on both Android AND iOS.

| #   | Feature                                                                                                                                                                | Effort | Status                     |
|-----|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------|----------------------------|
| B1  | **Account deletion** — GDPR Art.17, Google Play & Apple requirement                                                                                                    | Large  | DONE (PR #218, 2026-03-29) |
| B2  | **Data export** — GDPR Art.20 data portability. See `2026-03-29-data-export-design.md`                                                                                 | Medium | DONE (PR #238, 2026-03-30) |
| 17  | **Age-based segregation** — UK OSA, adults/minors must not interact                                                                                                    | Large  |                            |
| B3  | **Room message reporting** — UK OSA, report mechanism on every UGC screen                                                                                              | Small  |                            |
| 16  | **Gambling self-exclusion** — responsible gambling regulation, irreversible opt-out                                                                                    | Medium |                            |
| B4  | **Privacy policy rewrite** — GDPR, missing data controller, lawful basis, DPO, children's section                                                                      | Medium |                            |
| 55  | **Inactive account deletion** — automated process to delete accounts inactive for extended period. Needs discussion on retention period, warnings, data handling       | Medium |                            |
| B15 | **VPN detection and blocking** — prevent VPN connections. Cascading ban system risks banning innocent users sharing VPN exit nodes                                     | Medium |                            |
| B19 | **Account sharing detection & prevention** — detect concurrent sessions from different devices/IPs/geolocations, impossible travel. Alert admin, force re-auth or lock | Large  |                            |
| B21 | **Automated content moderation** — AI-powered detection: image nudity, voice toxicity (speech-to-text), text profanity. Auto-flag or auto-action based on severity     | XL     |                            |
| C1  | **EU DSA transparency reporting + designated point-of-contact** — annual transparency report on moderation actions; named EU point-of-contact published on the website | Medium |                            |
| C2  | **CCPA "Do Not Sell My Personal Information" link** — required on all pages for CA users. Even though we don't sell, the link is mandatory for compliance              | Small  | DONE (2026-05-03) — `public/do-not-sell.html` explanatory page (no-sale affirmation, CA rights, authorised-agent process) + footer link on all 6 footer-bearing pages (index, privacy, terms, community-guidelines, cyber-bullying, roadmap). 10 Playwright tests pin page accessibility + per-page footer link presence so a future page added without the link fails CI |
| C3  | **Granular consent mechanism** — separate opt-ins per processing purpose (analytics, marketing, etc.) instead of single blanket accept                                 | Medium |                            |
| C4  | **Consent withdrawal mechanism** — users can revoke each previously-granted consent at any time, persisted server-side                                                  | Medium |                            |
| C5  | **Defined retention periods + UI surfacing** — publish per-data-type retention windows in the privacy policy + show users in-app                                         | Small  |                            |
| C6  | **Data-breach notification process** — defined runbook + 72-hour notification template + user-facing in-app banner mechanism for triggered breaches                     | Medium |                            |
| C7  | **Gift-blocked-but-profile-viewable gap** — block-list integrity bug: blocked user can still view profile + see public gifts even though they can't send                | Small  |                            |
| C8  | **Age-gating per feature** — separate age gates for voice rooms / gifting / DMs-with-strangers. Currently single 13+ gate at signup; needs per-feature age sensitivity   | Medium |                            |
| C9  | **Voice content reporting** — reporting mechanism for live voice content (record-on-report, server-side review). UK OSA + Apple guidelines                              | Large  |                            |

---

## Phase 2 — Platform Foundation

Keep Play Store billing current. Ship iOS alongside Android.

| #     | Feature                                                                     | Effort | Status |
|-------|-----------------------------------------------------------------------------|--------|--------|
| B5    | **iOS build fix** — K/N AutoboxingTransformer crash blocking iOS linking; resolved by upgrading to Kotlin 2.4.0-Beta2 + static frameworks + Koin init fix | Medium | DONE (PRs #332, #333, 2026-04-23). Beta workaround pinned at `gradle/libs.versions.toml:3`; #69 above tracks the stable upgrade |
| B6.1  | **iOS sign-in helpers — Google + Apple + Dev expect/actual**                | Medium | DONE (PRs #416, #417, #418, 2026-04-30 — 2026-05-01)                       |
| B6.2  | **iOS SignInScreen consolidation to commonMain**                            | Medium | DONE (PR #419, 2026-05-02)                                                  |
| B6.3  | **iOS app — 4 Android-only screens to commonMain (UnsafeDevice/Ban/Degraded/ForceUpdate)** | Medium | DONE (PR #407, 2026-04-25)                                                  |
| B6.4  | **iOS StartingScreen to commonMain**                                        | Small  | DONE (PR #408, 2026-04-25)                                                  |
| B6.5  | **iOS GachaSoundPlayer port (AVAudioEngine)**                               | Large  | DONE (PR #410, 2026-04-30)                                                  |
| B6.6  | **iOS push notifications (APNs/FCM)** — Mutex-serialised token sync, fail-closed deep-link authz with timeout/identity/block-list/conversation-membership gates, single commonMain `verifyPushNavigation` helper for cross-platform parity, 32 unit tests | Large  | DONE (PR #404, 2026-04-30, commit 47dff697be)                              |
| B6.7  | **iOS image upload (PHPicker)** — `PlatformImagePicker.ios.kt` → `IosImagePicker`, all three pickers wired | Small  | DONE (pre-Phase-3, exact PR not recorded in this roadmap; see `project-ios-parity-critical.md`) |
| B6.8  | **iOS `getPendingReports` Firestore query port + JSON-key bug fix**        | Small  | DONE (port #405, 2026-04-25; bug fix PR #420, 2026-05-02 in review)        |
| B6.9  | **iOS `deviceId` expect/actual via `UIDevice.identifierForVendor`** — replace `"ios-device-placeholder"` in `IosSmallRepositories.kt` | Small  | REVERTED — first attempt PR #406 merged then reverted by commit `043cdf47ce` (iOS ClassCastException blocker). Re-implementation needed |
| B6.10 | **iOS StoreKit billing integration** — mirrors Android Billing v8. Full 4-step plan at `.project/plans/2026-04-30-ios-storekit-blocker.md` | Large  | BLOCKED on Apple Developer account + App Store Connect product setup       |
| B6.11 | **Apple Sign-In Android typed cancellation exception** — replace English-literal cancel detection in `AuthRepositoryImpl.signInWithAppleViaProvider` with a typed exception (Phase 4 follow-up) | Small  | DONE (2026-05-03) — `AppleSignInCancelledException` attached to `Resource.Error.exception`; AuthViewModel branches on type; SignInScreen string-match dropped |
| B6.12 | **`resolveReport` partial-failure flag surfacing** — admin UI must show per-sub-action failures (`warning.failed`, `suspension.failed`, `auditLog.failed`, `pms.failed`, `cascade`) currently swallowed by `Resource<Unit>`. Mostly DONE for admin-bans / economy / devices / warn / backpack PMs (PRs #385, #392, #393). Remaining: re-audit `resolveReport` itself + `reportMessage` / `reportUser` paths and any iOS admin surface when added. See `feedback-partial-failure-contracts.md` | Medium | IN PROGRESS — admin UI partial-failure plumbing landed PRs #385, #392, #393. resolveReport-specific outcome shape still pending |
| B6.13 | **`BuildVariant` atomic config holder** — multi-write race window between `isLocalEmulator` / `localDevPassword` / `localDevEmail` / `googleWebClientId`. Wrap into a single immutable holder to remove the window | Small  | DONE (2026-05-03) — `BuildVariantConfig` data class, single `@Volatile` holder reference, `init*` functions `copy()` + atomic swap. All 9 fields (incl. apiBaseUrl, environment, buildVersion, deviceInfo, iosDeviceId) now read/write via the holder; backward-compat property accessors keep the public API surface unchanged. 5 new tests pin atomicity contract |
| B6.14 | **Local-flavour Google Sign-In button conditional render** — currently rendered with placeholder `WEB_CLIENT_ID = "placeholder-local"`; tap fails with cryptic Google framework error. Hide on local flavour or set empty + treat as unavailable | Small  | DONE (2026-05-03) — Android local `BuildConfig.WEB_CLIENT_ID = ""` (was `"placeholder-local"`) coerces to null in BuildVariant; new `BuildVariant.isGoogleSignInAvailable` convenience; SignInScreen hides the Google button when false. 3 new tests pin the visibility logic |
| B6.15 | **iOS dev sign-in multi-account picker** — Phase 4 simplified iOS to single-account dev sign-in (parity with Android). Restoring the picker on both platforms requires `BuildVariant.localDevEmails: List<String>`. Defer pending UX decision | Small  |                                                                             |
| B7    | **Billing v7→v8** — Google Play Billing major version, deprecation deadline | Medium | IN PROGRESS — Dependabot PR #270 build fails; needs investigation          |

---

## Phase 3 — Revenue Engine

Monetisation features that fund everything else.

| #  | Feature                                                                                                   | Effort | Status |
|----|-----------------------------------------------------------------------------------------------------------|--------|--------|
| 13 | **Nobility system** — ranks from gift value sent, perks per rank                                          | Large  |        |
| 1  | **Relationships** — paid tiers (friend→partner→family), perks, seat connections                           | Large  |        |
| 7  | **Decorations** — profile decorations, avatar borders, speech bubbles, entrance effects, room backgrounds | Large  |        |

---

## Phase 4 — Core Social & Discovery

Features that drive daily active usage and retention.

| #   | Feature                                                                                                                                                     | Effort | Status |
|-----|-------------------------------------------------------------------------------------------------------------------------------------------------------------|--------|--------|
| 2   | **Posts & Stories** — social feed + ephemeral stories                                                                                                       | XL     |        |
| 3   | **User search** — discovery of met/unmet users, advanced filters behind SuperShy                                                                            | Medium |        |
| 14  | **Leaderboards** — multiple categories, daily/weekly/monthly/all-time                                                                                       | Medium |        |
| 15  | **Hall of Fame** — weekly & monthly top-up leaderboards                                                                                                     | Small  |        |
| 8   | **Room rankings** — rooms ranked by gift activity                                                                                                           | Small  |        |
| 20  | **Gift wall overhaul** — leaderboard, history, categories, full customization                                                                               | Large  |        |
| B20 | **Clans system** — user-created groups with leaders, members, ranks, shared chat, clan-level leaderboards, inter-clan competitions. Clan badges on profiles | XL     |        |

---

## Phase 5 — Quality of Life

Retention and UX improvements.

| #   | Feature                                                                                                                                     | Effort | Status |
|-----|---------------------------------------------------------------------------------------------------------------------------------------------|--------|--------|
| 12  | **Auto-translation** — real-time translation in chats, free tier + SuperShy full access                                                     | Medium |        |
| 30  | **Pin chats** — pin DMs/group chats to top of list                                                                                          | Small  |        |
| 9   | **Chat toggle** — room owners/hosts disable in-room text chat                                                                               | Small  |        |
| 18  | **Room filters** — filter rooms by language, category, activity                                                                             | Small  |        |
| 21  | **Gift wishlist** — users curate desired gifts                                                                                              | Small  |        |
| 22  | **Gift collections** — unlock special gift by completing a set                                                                              | Medium |        |
| 19  | **Announcements** — room-wide & global messages, gated behind nobility rank                                                                 | Medium |        |
| 10  | **Granular suspensions** — suspend specific features per user                                                                               | Medium |        |
| 11  | **Report reliability score** — track report accuracy per user                                                                               | Medium |        |
| B22 | **App startup redesign** — prevent login screen flash on auto-login (race condition), improve perceived startup time, better loading states | Medium |        |
| B23 | **Error notification UX redesign** — replace the current red, opaque, blocking error toast with a lighter, transparent, tap-through notification: dark text on a low-alpha (≤0.6) blurred/translucent background, no card chrome, no input interception. Buttons rendered underneath must remain clickable while the notification is visible. Add Compose UI test asserting hit-testing passes through, plus a snapshot test to lock the styling. Deferred from 2026-05-04 bug-triage session | Small  |        |

---

## Phase 6 — Website & Public Presence

Public-facing website improvements and creator/admin tools.

| #   | Feature                                                                                                                                                                                                                                                 | Effort | Status                                                                                       |
|-----|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------|----------------------------------------------------------------------------------------------|
| 47  | **Unified web portal** — single login page where users authenticate with their ShyTalk account. Routes to Admin panel, MC Host panel, MC Singer panel, Teacher panel, or suggestions+roadmap based on role. Must be done BEFORE admin restructure (#41) | Medium | DONE (PR #284, 2026-04-10)                                                                   |
| 38  | **Website About section** — service details, GitHub repo link, Allure test reports link, GitHub Issues for bug reporting with template + walkthrough                                                                                                    | Small  |                                                                                              |
| 34  | **Website support section** — FAQ + categorised support contact, matching in-app                                                                                                                                                                        | Medium |                                                                                              |
| 33  | **Website interactive demo** — screenshots + simulated video recordings of realistic users                                                                                                                                                              | Large  |                                                                                              |
| 39  | **Website public roadmap** — show upcoming features so users can see what's planned. Keep it high-level (no internal details), update when phases complete                                                                                              | Small  | DONE (PR #223, 2026-03-30)                                                                   |
| 48  | **Web personal profile** — full profile management on portal: avatar upload, display name, SuperShy status/purchase, coins, linked accounts, voting history, submitted suggestions. Needs its own design cycle                                          | Medium |                                                                                              |
| 46  | **Web page i18n completion** — full translations for all web pages including admin panel, legal pages. Language selector on every page                                                                                                                  | Medium | SUBSTANTIALLY DONE (PR #325, 2026-04-23 added Khmer + portal block; legal pages translated). Residual hardcoded strings in `public/events/khmer-new-year.html` (year-badge, English greeting cards) tracked under #46.1 |
| 46.1| **Khmer New Year event page i18n cleanup** — remaining hardcoded strings on `public/events/khmer-new-year.html`: hero `<h1 lang="km">`, year-badge, individual greeting cards (lines ~593-622)                                                          | Small  |                                                                                              |
| 54  | **Portal CSS/i18n unification** — migrate portal from separate portal-translations.js + portal.css to shared language-selector.js + inline styles                                                                                                       | Small  |                                                                                              |
| W1  | **Shared header component on all web pages** — single source of truth for nav/auth/language across all `public/*.html` pages. Bundled bugs to fix in same PR: COOP errors on prod, `/api/firebase-config` 503 on prod (FIREBASE_WEB_API_KEY missing in Cloudflare Pages env), watch bells re-prompt sign-in, `prompt: 'select_account'` on Google sign-in. Tracked at `project-shared-header.md` | Medium | NOT STARTED                                                                                  |
| W2  | **Homepage redesign** — fix non-clickable "coming soon" elements, general design pass. See `project-homepage-redesign.md`                                                                                                                                | Medium |                                                                                              |
| W3  | **Slogan rebrand** — replace "Voice chat rooms, reimagined" with language-learning + cultural-exchange positioning (matches the user's core mission). Coordinated with W2 above. See `project-rebrand-slogan.md`                                          | Small  |                                                                                              |
| W4  | **Roadmap page redesign** — replace Star Wars theme with standard ShyTalk dark theme; remove crawl/intro/audio assets. PR #255 was open + blocked on flaky inter-file Playwright tests; needs re-baselining + pushing 7 unpushed local commits (`global-setup.ts` test-collection clear, `test/clear/:collection` endpoint, `refreshSuggestionsList()` fix, factCard `.first()`) and resolving the rotating ~10 inter-file dependency failures (admin-funfacts, admin-keyboard, admin-economy-config, admin-cross-tab, admin-suggestions, admin-reports, admin-logs). See `project-roadmap-redesign-progress.md`                                              | Medium |                                                                                              |
| W5  | **Roadmap page features** — subscribe-to-updates form (email) + comments/suggestions form on the public roadmap. See `project-roadmap-page-features.md`                                                                                                  | Medium |                                                                                              |
| W6  | **Shyden Ltd company website** — professional company site at shyden.co.uk with portfolio, mission page, AI-powered open-source software focus. Coordinated with #58 (org migration). See `project-shyden-website.md`                                  | Medium |                                                                                              |
| 42  | **Admin role-based access control** — internal admin roles (super-admin, moderator, viewer) controlling which tools each admin can use. Store roles in Firestore, enforce server-side                                                                   | Medium |                                                                                              |
| W7  | **Admin auth-management UI (Security subtab)** — Express admin routes + UI for PIN lockout reset, biometric key revoke, OTP metrics dashboard. Distinct from #41. See `project-admin-auth-panel.md`                                                     | Medium |                                                                                              |
| 43  | **MC Host dedicated panel** — separate login + dashboard for MC Hosts to manage games, participants, prizes. Isolated from main admin panel                                                                                                             | Medium |                                                                                              |
| 49  | **MC Host Team Leader panel** — oversight panel for Team Leaders who manage multiple MC Hosts. View team performance, assign games/events, review MC Host activity, handle escalations                                                                  | Medium |                                                                                              |
| 44  | **MC Singer dedicated panel** — separate login + dashboard for MC Singers to manage singing sessions, rooms, competitions                                                                                                                               | Medium |                                                                                              |
| 50  | **MC Singer Team Leader panel** — oversight panel for Team Leaders who manage multiple MC Singers. View team performance, assign singing sessions, review MC Singer activity, handle escalations                                                        | Medium |                                                                                              |
| 45  | **Teacher dedicated panel** — separate login + dashboard for Teachers to manage teaching rooms, students, schedules                                                                                                                                     | Medium |                                                                                              |

---

## Phase 7 — Entertainment

Rich interactive features that differentiate ShyTalk.

| #  | Feature                                                                            | Effort | Status |
|----|------------------------------------------------------------------------------------|--------|--------|
| 4  | **Animated stickers** — temporary animated overlays on avatars in room seats       | Medium |        |
| 27 | **PK battles** — two rooms compete via gifts, winners get beans bonus              | Large  |        |
| B8 | **Video & screen sharing** — camera toggle + screen share in voice rooms (depends on self-hosted LiveKit #76 for cost reasons)           | Medium |        |
| 5  | **In-room games** — pool/billiards, ludo playable within voice rooms               | XL     |        |
| 26 | **Karaoke** — turn-taking singing, background music, audience scoring              | XL     |        |
| 28 | **Singing competitions** — MC Singer role, special rooms, time-limited             | Large  |        |
| 31 | **MC Host games** — MC Hosts design/run interactive games, participants win prizes | Large  |        |
| 6  | **Admin events** — one-time events with prizes/gifts for winners                   | Large  |        |

---

## Phase 8 — Support & Specialised

In-app support and niche room types.

| #   | Feature                                                                                                                            | Effort | Status |
|-----|------------------------------------------------------------------------------------------------------------------------------------|--------|--------|
| 25  | **Help & Support** — FAQ + categorised support contact (in-app)                                                                    | Small  |        |
| 24  | **Feedback system** — in-app feedback, complaints, appraisals                                                                      | Small  |        |
| 23  | **Feature requests** — in-app suggestion/voting system                                                                             | Small  |        |
| 29  | **Teaching rooms** — special room type for language teachers                                                                       | Medium |        |
| B13 | **Contact form** — private feedback/bug reports/safety concerns sent to admin panel. Category dropdown, optional email for replies | Small  |        |
| B14 | **Contact support page for suspended users** — suspended users need a way to reach support even when locked out                    | Small  |        |

---

## Resolved Backlog Items

Items previously in the backlog, now integrated into phases above or resolved:

| ID  | Item                            | Resolution                                                    |
|-----|---------------------------------|---------------------------------------------------------------|
| B9  | E2E screen coverage gaps        | Re-surfaced — see Phase 0.5 T-A (was incorrectly marked "integrated") |
| B10 | Playwright BDD upgrade          | Re-surfaced — see Phase 0.5 T-B (was incorrectly marked "integrated") |
| B11 | Branded sign-in (Apple browser) | Accepted as Firebase limitation — no action needed             |
| B12 | Email sign-in                   | Blocked on self-hosted Postfix (Phase 0 #75)                  |
| B5  | iOS build fix                   | Moved to Phase 2 (DONE PRs #332, #333, 2026-04-23)            |
| B6  | iOS parity                      | Moved to Phase 2, split into B6.1–B6.15 sub-items (most DONE through PRs #310, #404–#420; remaining: deviceId, StoreKit blocked, 5 Phase-4 follow-ups) |
| B18 | Admin panel restructure         | Duplicate of #41 — removed                                     |
| B13 | Contact form                    | Moved to Phase 8                                               |
| B14 | Suspended user support          | Moved to Phase 8                                               |
| B15 | VPN detection                   | Moved to Phase 1 (safety)                                      |
| B16 | Cross-device E2E testing        | Moved to Phase 0                                               |
| B19 | Account sharing detection       | Moved to Phase 1 (safety)                                      |
| B20 | Clans system                    | Moved to Phase 4 (social)                                      |
| B21 | Automated content moderation    | Moved to Phase 1 (safety)                                      |
| B22 | App startup redesign            | Moved to Phase 5 (QoL)                                         |

---

## Nice to Have (deferred — end-of-roadmap polish)

Items that are useful but not blocking. Do these only after all numbered phases are complete.

| ID | Item                                                                                               | Effort | Notes                                                                                                    |
|----|----------------------------------------------------------------------------------------------------|--------|----------------------------------------------------------------------------------------------------------|
| 32 | **OnPush CLI** — local doc generation (`onpush init/generate/clean`). CI is paid; run locally only | Small  | Moved from Phase 0 (2026-04-11) — productivity tool, not user-visible. Defer until core roadmap is done. |
