---
name: run-tests
description: Run unit tests, E2E tests, iOS compilation, or all with clear pass/fail summary
---

Run the appropriate test suite based on the user's request. Default to running all if unspecified.

## Test Suites

**Unit tests (Android + JVM):**
```bash
./gradlew testDevDebugUnitTest :shared:jvmTest
```

**iOS compilation check:**
```bash
./gradlew :shared:compileKotlinIosArm64
```

**E2E / Instrumented tests** (requires connected device):
```bash
./gradlew connectedDevDebugAndroidTest
```

**Express API tests:**
```bash
cd express-api && npm test
```

**Playwright tests** (requires local stack):
```bash
npx playwright test
```

## Instructions

1. Run the requested suite(s)
2. **Always include iOS compilation check** when shared code has changed — tri-platform sync is mandatory
3. Parse the output for pass/fail counts
4. Report a clear summary:
   - Total tests run
   - Total passed
   - Total failed (list each failing test name)
   - Any compilation errors (including iOS cinterop failures)
5. If tests fail, suggest fixes based on the error messages

## Examples

- `/run-tests` → run unit + iOS compile + E2E
- `/run-tests unit` → unit tests + iOS compilation
- `/run-tests e2e` → E2E only
- `/run-tests api` → Express API tests only
- `/run-tests ios` → iOS compilation check only
- `/run-tests playwright` → Playwright browser tests only
- `/run-tests all` → all suites (unit + iOS + E2E + API + Playwright)
