# Dev Environment Setup — Design

## Goal

Two fully isolated environments (Dev + Prod) so development, testing, and CI/CD never touch production data.

## Architecture

Each environment gets its own Firebase project, R2 bucket, API server, and app build flavor.

| Component | Prod (Asia) | Dev (Europe) |
|-----------|-------------|--------------|
| Firebase project | `shytalk-7ba69` | New project (TBD) |
| Firestore location | `asia-southeast1` | `europe-west2` (London) |
| RTDB location | `asia-southeast1` | `europe-west1` (Belgium) |
| API server | Singapore (213.35.98.160) | London (145.241.224.13) |
| API domain | `api.shytalk.shyden.co.uk` | `dev-api.shytalk.shyden.co.uk` |
| R2 bucket | `shytalk-media` | `shytalk-media-dev` |
| R2 location hint | auto | `WEUR` (Western Europe) |
| CDN domain | `images.shytalk.shyden.co.uk` | `dev-images.shytalk.shyden.co.uk` |
| App ID | `com.shyden.shytalk` | `com.shyden.shytalk.dev` |
| App name | ShyTalk | ShyTalk DEV |
| App icon | Normal | Debug banner overlay |

## Android Build Flavors

Two product flavors in `app/build.gradle.kts`:

- **`prod`** — Current behavior. Uses prod `google-services.json`, prod API URLs.
- **`dev`** — Uses dev `google-services.json`, dev API URLs. Appended `.dev` applicationId suffix. "ShyTalk DEV" label and debug icon overlay.

Build variants: `devDebug`, `devRelease`, `prodDebug`, `prodRelease`. Both flavors install side-by-side on the same device.

Each flavor has its own `google-services.json`:
- `app/src/prod/google-services.json` (current production file)
- `app/src/dev/google-services.json` (from dev Firebase project)

BuildConfig fields (`API_BASE_URL`, `WORKER_URL`, `LIVEKIT_SERVER_URL`) set per flavor, not from environment variables.

## Express API

Same codebase deployed to both servers. Only the `.env` file differs:

- London `.env` points to dev Firebase service account, dev R2 bucket, dev RTDB URL
- DNS: `dev-api.shytalk.shyden.co.uk` A record → `145.241.224.13`
- Caddy on London configured for `dev-api.shytalk.shyden.co.uk` (auto HTTPS)

## R2 Storage

Separate bucket `shytalk-media-dev` with `WEUR` location hint.

CDN: `dev-images.shytalk.shyden.co.uk` proxied through Cloudflare to the dev bucket.

Dev orphaned storage cron only touches the dev bucket — no risk to production images.

## Test Fixtures

A script (`scripts/seed-dev-fixtures.mjs`) creates a repeatable dev dataset against the dev Firebase project:

- 3-5 test users with different roles (admin, moderator, regular)
- Full gift catalog (copied from latest prod backup)
- Sample rooms, conversations, banners, fun facts
- Test economy data (coins, backpack items)

This script only runs against the dev Firebase project. It is not seeding production.

## CI/CD

GitHub Actions updated:
- `android-tests.yml` uses dev `google-services.json` (already uses a dummy one; replace with real dev credentials)
- Dev API server available at `dev-api.shytalk.shyden.co.uk` for integration tests

## What Stays Shared

- Git repository (same codebase)
- Cloudflare account (both R2 buckets, both DNS records)
- Oracle Cloud account (both VMs)
- LiveKit (same project — dev rooms use `dev-` prefix if needed)

## Decisions

- Dev data starts as a clean slate with fixtures, not a copy of production (no PII in dev)
- London server repurposed from prod rollback to dedicated dev API
- Separate R2 bucket to prevent orphaned storage cron cross-contamination
- Dev app visually distinct (different name + icon) to prevent confusion
