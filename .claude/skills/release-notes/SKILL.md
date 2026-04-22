---
name: release-notes
description: Generate Google Play and App Store release notes (max 500 chars, non-technical) from recent commits
disable-model-invocation: true
---

# Generate Release Notes

Generate user-friendly release notes for Google Play internal track and App Store (TestFlight).

## Output Files

- **Google Play:** `app/src/main/play/release-notes/en-US/internal.txt`
- **App Store:** `iosApp/fastlane/metadata/en-US/release_notes.txt` (when iOS deployment is configured)

## Steps

1. Read recent commits since last release tag or last 20 commits:
   ```bash
   git log --oneline -20
   ```
2. Read the current release notes file to understand the existing style
3. Draft release notes following these rules:
   - **Max 500 characters** (Google Play hard limit)
   - **Non-technical language** — written for end users, not developers
   - Use phrases like "Improved...", "Fixed...", "Added..." — not "Refactored...", "Migrated...", "Updated dependency..."
   - Skip internal/infra changes (CI, refactors, dependency bumps)
   - Focus on what users will notice: new features, bug fixes, UX improvements
   - No version numbers, commit hashes, or technical jargon
4. Write the notes to the file
5. Verify character count:
   ```bash
   wc -c app/src/main/play/release-notes/en-US/internal.txt
   ```
   Must be under 500.

## Example Style

Good: "Improved connection stability in voice rooms. Fixed an issue where notifications weren't showing for new messages."

Bad: "Migrated from Durable Objects to RTDB. Fixed race condition in presence timeout handler. Bumped kotlinx-datetime to 0.6.2."
