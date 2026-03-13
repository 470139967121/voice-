---
name: seed-dev
description: Reset and seed the dev Firebase environment with test fixtures and verify API health
disable-model-invocation: true
---

# Seed Dev Environment

Reset and populate the dev Firebase project with test data.

## Steps

1. **Confirm** this is running against dev (not prod):
   ```bash
   echo "Target: shytalk-dev (europe-west2)"
   ```

2. **Run seed script:**
   ```bash
   node scripts/seed-dev-fixtures.mjs
   ```

3. **Verify API health:**
   ```bash
   curl -s https://dev-api.shytalk.shyden.co.uk/api/config | head -c 200
   ```

4. **Run test setup** (if E2E tests will follow):
   ```bash
   curl -s -X POST https://dev-api.shytalk.shyden.co.uk/api/test/setup \
     -H "X-Test-Api-Key: $TEST_API_KEY" \
     -H "Content-Type: application/json"
   ```

## Safety

- This skill only targets the dev environment — NEVER run against prod
- The seed script checks the Firebase project ID before writing
- If the API health check fails, investigate before re-seeding
