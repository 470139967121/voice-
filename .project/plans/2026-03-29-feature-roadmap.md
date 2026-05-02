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
| 58  | **GitHub org migration — Shyden Ltd namespace** — create free GitHub org (`shyden-ltd` or similar), transfer repo from personal account. Aligns with future Shyden Ltd company site. Update Cloudflare Pages source, README badges, in-app source links, Express API references, GitHub App installations. NOTE: does NOT unlock larger runners (paid on every plan), purely organisational/professional move | Medium |                                                               |
| 59  | **`actionlint`/`shellcheck` CI job** — catches unquoted globs, missing `set -euo pipefail`, and other bash anti-patterns in workflow `run:` blocks at PR time, not after a 20-min iOS deploy. Surfaced by 2026-04-29 audit                    | Small  | DONE (PR #387, 2026-04-29)                                    |
| 60  | **iOS deploy export-only dry-run job** — path-filtered (`iosApp/ExportOptions.plist`, `.github/workflows/deploy-*.yml`) PR job that runs archive + exportArchive + IPA verify but stops before TestFlight upload. Validates IPA materialises without burning a TestFlight build number. Would have caught the 2026-03-12 silent-upload regression in week 1 instead of week 7 | Medium |                                                               |
| 61  | **Composite `cleanup-ios-signing` action** — extract the cleanup logic currently inlined in `deploy-dev.yml` and `deploy-prod.yml` into a sibling action paired with `setup-ios-signing`. Single source of truth eliminates the drift trap that already cost us once (PR #372 audit found cleanup missing 3 paths) | Small  | DONE (PRs #388, #394, 2026-04-29)                             |
| 62  | **iOS deploy pre-cleanup step** — scrub leftovers from prior crashed runs (where `if: always()` cleanup didn't get to run — runner force-killed, machine reboot, network partition past cancel timeout). Mandatory hygiene for self-hosted Mac with persistent FS                                                                  | Small  | DONE (PR #395, 2026-04-29)                                    |
| 63  | **Move `.p8` to `$RUNNER_TEMP/private_keys/`** — App Store Connect API key currently lives in `$HOME/private_keys/`, persisting across runs if any prior run crashed before cleanup. Moving to `$RUNNER_TEMP` scopes it to per-job lifetime. Blocked on PR #372 merging (current cleanup path references `$HOME`)                | Small  | DONE (PR #396, 2026-04-29)                                    |
| 64  | **Health-check returns deployed git SHA** — `/api/health` should return the deployed commit SHA so deploy workflows can assert the new code is actually serving (not stale pm2 process from prior deploy). Closes the "deploy succeeded but new code isn't running" silent-failure class. Backend change                            | Small  | DONE (PR #397, 2026-04-29)                                    |
| 65  | **Smoke-test gate AND not OR** — `smoke-test-backend-web` runs if EITHER backend OR web deploy succeeded. After a partial deploy failure, the green smoke-test job visually contradicts the red deploy job. Either AND-gate or split into per-surface jobs                                                                          | Small  | DONE (PR #389, 2026-04-29)                                    |
| 66  | **LiveKitWebRTC dSYM ingestion** — re-enable `uploadSymbols: true` in `ExportOptions.plist` for proper crash-symbolication of WebRTC stack frames. **2026-04-29 research finding:** `LiveKitWebRTC` is a closed-source binary pod (version 125.6422.11) — the WebRTC binary itself isn't on any public LiveKit GitHub repo (only the Swift wrapper `livekit/client-sdk-swift` is). Need to open an upstream issue asking LiveKit if they ship dSYMs as separate download artifacts or via a private CocoaPod. Until then, `uploadSymbols: false` is correct (App Store doesn't reject builds for missing dSYMs; crash reports just won't symbolicate WebRTC frames) | Small  | BLOCKED on upstream LiveKit issue                             |
| 67  | **Allure landing page auto-generator** — currently `gh-pages:index.html` is a static, hand-maintained landing (every new suite — e.g. iOS E2E in commit `256921b329` — needs a separate PR to update the landing). Move to a `scripts/generate-allure-landing.js` that builds the landing from a registry of suites + their latest deploy/PR badges, called from `.github/workflows/allure-report.yml`                                                | Small  |                                                               |
| 68  | **CodeQL Kotlin re-enablement** — re-enable Kotlin analysis in `codeql-analysis.yml` once `github/codeql-action` extractor supports Kotlin 2.4.x. Currently disabled; tracked at `project-codeql-kotlin-update.md` (re-disabled 2026-04-27)                                                                                            | Small  | BLOCKED on upstream extractor support                         |
| 69  | **Kotlin 2.4.0-Beta2 → 2.4.0 stable upgrade** — `gradle/libs.versions.toml:3` is pinned to Beta2 because K/N 2.3.x has an `AutoboxingTransformer` crash blocking iOS linking. Upgrade to stable when released; remove the comment workaround                                                                                          | Small  |                                                               |
| 70  | **CI workflow audit follow-ups (2026-04-24)** — three remaining items from `project-ci-workflow-audit.md`: (a) macos-14 vs macos-15 mismatch in `ios-tests.yml`; (b) `xcrun altool --upload-app` deprecation switch to `xcrun notarytool` / Transporter; (c) dependabot-auto-merge approves before CI checks complete                | Small  |                                                               |
| 71  | **Environment secrets migration** — move ~17 secrets from repo-level to dev/prod GitHub environments so dev secrets aren't reachable from prod-flavoured workflows (and vice versa). Only `ADMIN_EMAIL`/`ADMIN_PASSWORD` migrated so far. Tracked at `project-environment-secrets-migration.md`                                          | Medium |                                                               |
| 72  | **Express API test depth** — ~220-250 new tests across 10 thin Express files; spec at `.project/plans/2026-03-20-express-api-test-depth-design.md`. Includes the latent `expireTempIds.js` 500-batch-write chunking bug. Paused for prior priority work; spec is ready                                                              | Large  |                                                               |
| 73  | **Dependabot configuration audit** — `.github/dependabot.yml` should cover gradle, npm, github-actions ecosystems with weekly cadence + auto-merge for patch versions. Verify coverage scope vs `project-dependabot.md` (PRs #270/#297 indicate it's live but coverage may be partial)                                                | Small  |                                                               |
| 74  | **Review standards enforcement automation** — encode the `pr-review-toolkit` / `feature-dev:code-reviewer` checks in pre-commit / pre-push so common-class issues (Gherkin scenario size, KMP/Compose conventions) fail PRs at lint time, not at human-review time. Tracked at `project-review-standards-enforcement.md`              | Medium |                                                               |
| 75  | **Self-hosted Postfix mail server (Oracle Cloud)** — provisions our own SMTP server so Firebase Auth Email Link sign-in (Resolved B12) works without paying for SendGrid. Blocked on Oracle Cloud port-25 unblock request. Tracked at `project-future-self-hosting.md`                                                                | Medium | BLOCKED on Oracle port 25 unblock request                     |
| 76  | **Self-hosted LiveKit (Oracle Cloud) — full migration** — already partial (multi-region routing in `livekit-asia` + `livekit-eu`); complete the migration off LiveKit Cloud to save ~£600/yr. Tracked at `project-future-self-hosting.md`                                                                                            | Medium |                                                               |
| 77  | **Gifts seed data + create-store redesign** — overhaul of how gifts are seeded (`local/seed.js`), created (admin tool), and stored (Firestore `gifts/`). Flagged by user 2026-05-02 as **NEEDS DISCUSSION** before implementation. See `project-gifts-seed-redesign.md`                                                              | Medium | NEEDS DISCUSSION                                              |
| B16 | **Cross-device E2E testing** — admin actions (suspension, moderation, ban cascade) performed in admin panel and verified in app on real device. Proves full pipeline end-to-end                  | Large  |                                                               |

---

## Phase 0.5 — Test Infrastructure (parallel to Phase 0)

19 sub-projects surfaced from `project-testing-roadmap.md` and `project-test-coverage-2026-03.md` that the previous roadmap collapsed under "Resolved B9/B10". These are **separate initiatives**, not "already integrated". Tier classification follows the source memory.

| #    | Feature                                                                                                                                                              | Tier | Effort | Status |
|------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|------|--------|--------|
| T-A  | **Zero-coverage screen E2E tests** — RequiredDOB, Splash, GroupChat, ReportReview, Browser, UnsafeDevice, ForceUpdate, Degraded, Suspension, Ban. 10 screens with no instrumented coverage today | 1    | Medium |        |
| T-B  | **Playwright BDD migration** — port the existing scenario-style Playwright admin tests to Cucumber/Gherkin so they share vocabulary with the Android E2E suite       | 1    | Medium |        |
| T-E  | **KMP test migration** — move shared-module tests from `:shared:jvmTest` to `:shared:commonTest` where applicable so the same tests run on iOS                       | 1    | Large  |        |
| T-D  | **Performance testing** — startup time, room-join latency, gift-burst frame budget. Track regression baseline + alert on PR-time delta                                | 2    | Medium |        |
| T-G  | **Pact contract testing** — between Express API and Kotlin/Web clients, so backend changes that break clients fail PR before deploy                                  | 2    | Medium |        |
| T-H  | **Accessibility testing (a11y)** — automated a11y assertions on Compose screens (talkBack labels, content descriptions) + Playwright a11y axe-core scans on web      | 2    | Medium |        |
| T-J  | **Visual regression (Paparazzi or screenshot-based)** — golden-image diff per Compose preview, fail PR on unintentional visual drift                                  | 2    | Medium |        |
| T-C  | **OWASP ZAP security scanning** — scheduled DAST scan against `dev-api.shytalk.shyden.co.uk` + admin panel; alert on new vulnerabilities                              | 3    | Medium |        |
| T-I  | **Flaky-test detection / quarantine** — track which tests have shipped a flake in last 30 days; auto-quarantine + reopen as bugs                                     | 3    | Medium |        |
| T-L  | **Locale screenshot diff** — render every screen in all 20 locales and diff against baseline so a translation that overflows a button fails CI                       | 3    | Medium |        |
| T-N  | **Voice chaos testing** — simulate flaky LiveKit network conditions (packet loss, jitter, disconnect/reconnect) and assert the room stays stable                     | 3    | Medium |        |
| T-K  | **Chaos / resilience testing** — kill Firebase emulators mid-test, restart Express mid-request, assert clients recover                                                | 4    | Medium |        |
| T-M  | **DB migration testing** — for every Firestore migration commit, run a fixture forward + rollback test to assert data integrity                                       | 4    | Small  |        |
| T-F  | **KMP E2E migration to XCTest** — convert Cucumber/Gherkin scenarios to a format that runs on the iOS simulator via XCUITest, not just Android                       | 4    | Large  |        |
| T-O  | **Cross-platform E2E** — single test definition runs on Android device, iOS simulator, and Web Playwright in one CI matrix job                                       | 4    | Large  |        |
| T-P  | **Deepen E2E** — every Gherkin scenario in `app/src/androidTest/assets/features/` audited for "smoke" depth; expand to cover negative paths and edge cases            | 4    | Large  |        |
| T-Q  | **Retroactive exhaustive testing** — sweep every public Express route + every commonMain ViewModel and add coverage for branches that have <80% line coverage         | 4    | Large  |        |
| T-R  | **Suggestions board test data fix** — `suggestions-board.spec.ts` + `admin-suggestions.spec.ts` selector mismatches (10.5s timeouts). See `project-playwright-test-data.md` | 1    | Small  |        |
| T-S  | **Test mock-isolation cleanup** — outstanding cases of cross-test mock bleed (`feedback-test-mock-isolation.md` was reactive; sweep for prevention)                  | 2    | Small  |        |

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
| C2  | **CCPA "Do Not Sell My Personal Information" link** — required on all pages for CA users. Even though we don't sell, the link is mandatory for compliance              | Small  |                            |
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
| B6.6  | **iOS push notifications (APNs/FCM) with Mutex-serialised token sync**     | Large  | DONE (PR #404, 2026-04-30)                                                  |
| B6.7  | **iOS image upload (PHPicker)**                                             | Small  | DONE                                                                        |
| B6.8  | **iOS `getPendingReports` Firestore query port + JSON-key bug fix**        | Small  | DONE (port #405, 2026-04-25; bug fix PR #420, 2026-05-02 in review)        |
| B6.9  | **iOS `deviceId` expect/actual via `UIDevice.identifierForVendor`** — replace `"ios-device-placeholder"` in `IosSmallRepositories.kt` | Small  |                                                                             |
| B6.10 | **iOS StoreKit billing integration** — mirrors Android Billing v8           | Large  | BLOCKED on Apple Developer account + App Store Connect product setup       |
| B6.11 | **Apple Sign-In Android typed cancellation exception** — replace English-literal cancel detection in `AuthRepositoryImpl.signInWithAppleViaProvider` with a typed exception (Phase 4 follow-up) | Small  |                                                                             |
| B6.12 | **`resolveReport` partial-failure flag surfacing** — admin UI must show per-sub-action failures (`warning.failed`, `suspension.failed`, `auditLog.failed`, `pms.failed`, `cascade`) currently swallowed by `Resource<Unit>`. See `feedback-partial-failure-contracts.md` | Medium |                                                                             |
| B6.13 | **`BuildVariant` atomic config holder** — multi-write race window between `isLocalEmulator` / `localDevPassword` / `localDevEmail` / `googleWebClientId`. Wrap into a single immutable holder to remove the window | Small  |                                                                             |
| B6.14 | **Local-flavour Google Sign-In button conditional render** — currently rendered with placeholder `WEB_CLIENT_ID = "placeholder-local"`; tap fails with cryptic Google framework error. Hide on local flavour or set empty + treat as unavailable | Small  |                                                                             |
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
| W1  | **Shared header component on all web pages** — single source of truth for nav/auth/language across all `public/*.html` pages. Bundled bugs to fix in same PR: COOP errors on prod, `/api/firebase-config` 503 on prod (FIREBASE_WEB_API_KEY missing in Cloudflare Pages env), watch bells re-prompt sign-in, `prompt: 'select_account'` on Google sign-in. Tracked at `project-shared-header.md` (NOT STARTED) | Medium |                                                                                              |
| W2  | **Homepage redesign** — fix non-clickable "coming soon" elements, general design pass. See `project-homepage-redesign.md`                                                                                                                                | Medium |                                                                                              |
| W3  | **Slogan rebrand** — replace "Voice chat rooms, reimagined" with language-learning + cultural-exchange positioning (matches the user's core mission). Coordinated with W2 above. See `project-rebrand-slogan.md`                                          | Small  |                                                                                              |
| W4  | **Roadmap page redesign** — replace Star Wars theme with standard ShyTalk dark theme; remove crawl/intro/audio assets. PR #255 was open + blocked on flaky inter-file Playwright tests; needs re-baselining                                              | Medium |                                                                                              |
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
