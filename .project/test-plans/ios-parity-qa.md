# iOS Parity — Manual QA Test Plan

**Task**: B6 — iOS app full feature parity
**Date**: 2026-04-24
**Scope**: 3 screens migrated to shared, real VoiceService, web fixes

## Automated Test Results (pre-QA)

| Suite | Result |
|-------|--------|
| ktlint | PASS |
| Express API (4,224 tests) | PASS |
| Kotlin JVM + detekt | PASS |
| iOS compilation (compileKotlinIosArm64) | PASS |
| KMP compat check (215 files) | PASS — zero violations |
| Playwright chromium (676 tests) | PASS — 0 failures |
| Code scanning alerts | 0 open |
| Secret scanning alerts | 0 open |
| Dependabot alerts | 0 open |

## Web QA Tests

### WEB-01: Shared Header — All Pages
| Step | Expected | Device |
|------|----------|--------|
| Navigate to shytalk.shyden.co.uk | Shared header visible with ShyTalk logo + Sign In button | Desktop + Mobile |
| Navigate to /roadmap | Same header | Desktop + Mobile |
| Navigate to /privacy.html | Same header | Desktop + Mobile |
| Navigate to /terms.html | Same header | Desktop + Mobile |
| Navigate to /community-guidelines.html | Same header | Desktop + Mobile |
| Navigate to /cyber-bullying.html | Same header | Desktop + Mobile |
| Resize to 320px | Logo visible, Sign In visible, no overflow | Mobile |

### WEB-02: Sign-In Flow (Redirect)
| Step | Expected |
|------|----------|
| Click "Sign In" in header | Login modal appears with Google + Apple buttons |
| Click "Sign in with Google" | Page redirects to Google OAuth (not popup) |
| Complete Google sign-in | Redirected back to roadmap, "Logged in as: name" in header |
| Click user name in header | Dropdown appears with "Sign Out" |
| Click "Sign Out" | UI reverts to "Sign In" button |
| Sign in again | Account picker shows (not auto-select) |

### WEB-03: Subscribe Modal
| Step | Expected |
|------|----------|
| Click Subscribe button (when not signed in) | Login modal appears |
| Click bell icon on feature (when not signed in) | Login modal appears |
| Sign in, then click bell icon | Subscribe modal appears (not login) |
| Subscribe modal shows GDPR notice text | No checkbox, informational text only |
| Save button is always enabled | Not gated by checkbox |

### WEB-04: Console Errors
| Step | Expected |
|------|----------|
| Open browser console on /roadmap | Zero errors |
| Sign in via Google | Zero COOP errors (no popup.ts error) |
| Check /api/firebase-config | Returns 200 (not 503) |

### WEB-05: Translations
| Step | Expected |
|------|----------|
| Change language via globe button | All text translates including Sign In, Sign Out, GDPR notice |
| Check Arabic (RTL) | Header renders correctly in RTL |

## Android QA Tests

### AND-01: AppSettingsScreen
| Step | Expected |
|------|----------|
| Open Settings from profile | All settings pages render: Main, Blocked Users, Account, Privacy, Notifications, Permissions, About |
| Tap language, change to Arabic | App restarts, all text in Arabic |
| Tap Permissions | Shows notification, overlay, mic, bluetooth status |
| Tap Contact in About | Email compose opens |

### AND-02: ProfileScreen  
| Step | Expected |
|------|----------|
| Open own profile | Avatar, name, stats, backpack all visible |
| Tap camera icon on avatar | Photo picker opens |
| Pick photo | Photo uploads (server-side resize) |
| View other user's profile | Follow/block/report buttons visible |

### AND-03: RoomScreen
| Step | Expected |
|------|----------|
| Join a voice room | Room loads, seats visible, chat panel works |
| Take a seat | Mic permission requested, voice connected |
| Toggle mute | Mic icon changes, audio mutes/unmutes |
| Send message in chat | Message appears |
| Leave room | Navigates back, voice disconnects |

## iOS QA Tests (Simulator)

### IOS-01: AppSettingsScreen
| Step | Expected |
|------|----------|
| Open Settings | Full settings UI (same as Android) |
| All sub-pages navigate | Blocked Users, Account, Privacy, etc. |
| Language change | restartForLanguageChange() called (no-op on iOS) |

### IOS-02: ProfileScreen
| Step | Expected |
|------|----------|
| Open own profile | Same layout as Android |
| Photo picker | PHPicker opens, photo selects |

### IOS-03: RoomScreen + VoiceService
| Step | Expected |
|------|----------|
| Join voice room | Room loads via LiveKit bridge |
| LiveKit connection | Connected state shown, speaking indicators work |
| Microphone | Enable/disable works, errors reported via delegate |
| Leave room | Disconnect clean, delegate cleared |

## Firestore Rules QA

### FS-01: Message Edit/Delete
| Step | Expected |
|------|----------|
| Send message in room chat | Message appears |
| Long-press own message, delete | Succeeds (was broken before type mismatch fix) |

### FS-02: Seat Requests
| Step | Expected |
|------|----------|
| Non-owner requests seat | Request created |
| Owner approves request | Succeeds (was broken before fix) |
| Requester cancels own request | Succeeds (was broken before fix) |
