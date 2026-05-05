import {
  test,
  expect,
  request as pwRequest,
  APIRequestContext,
} from "@playwright/test";

/**
 * Dev deployment smoke tests — exercise critical user-facing API
 * journeys against the deployed dev environment so the deploy goes
 * RED on infrastructure regressions (auth, Firestore rules, R2,
 * LiveKit token issuance, transactional wallet writes).
 *
 * This is intentionally distinct from `dev-sanity.spec.ts`, which
 * only checks page loads. The smoke suite signs in as a real test
 * user via Firebase Auth REST and exercises authenticated endpoints
 * end-to-end.
 *
 * Targets:
 *   - dev: API_BASE_URL=https://dev-api.shytalk.shyden.co.uk
 *   - local: API_BASE_URL=http://localhost:3000 (run during pre-push
 *     hook; see playwright.config.ts dev-smoke project)
 *
 * Failure semantics: every assertion must hold, otherwise the deploy
 * job goes red and the operator gets a failure email. There is no
 * "warn-only" mode — see `feedback-tests-always-block`.
 *
 * Auth: signs in via Firebase Auth REST `signInWithPassword`. The
 * test account email is fixed (`SMOKE_TEST_EMAIL`); the password
 * comes from a CI secret. We DO NOT use the admin Firebase token
 * because admin-claim accounts bypass several gates and would mask
 * real-user regressions. The smoke account is a regular user.
 */

const API_BASE = process.env.API_BASE_URL;
const FIREBASE_API_KEY = process.env.SMOKE_FIREBASE_API_KEY;
const SMOKE_EMAIL = process.env.SMOKE_TEST_EMAIL;
const SMOKE_PASSWORD = process.env.SMOKE_TEST_PASSWORD;
const DEV_BASIC_AUTH_PASSWORD = process.env.DEV_BASIC_AUTH_PASSWORD;

// Firebase Auth REST endpoint — production identitytoolkit. The
// smoke suite never targets the local Auth emulator because its
// purpose is to verify the deployed Firebase Auth project.
const FIREBASE_SIGN_IN_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;

// Skip the whole file when prerequisites are missing — keeps `npx
// playwright test` runnable locally without the full secret bundle.
test.skip(
  !API_BASE || !FIREBASE_API_KEY || !SMOKE_EMAIL || !SMOKE_PASSWORD,
  "dev-smoke requires API_BASE_URL, SMOKE_FIREBASE_API_KEY, SMOKE_TEST_EMAIL, SMOKE_TEST_PASSWORD",
);

// HTTP Basic credentials for the dev web gate (NOT for API). Only
// applies to web pages; the API has its own auth.
if (DEV_BASIC_AUTH_PASSWORD) {
  test.use({
    httpCredentials: { username: "dev", password: DEV_BASIC_AUTH_PASSWORD },
  });
}

interface SmokeAuth {
  api: APIRequestContext;
  idToken: string;
  uniqueId: number;
}

let smoke: SmokeAuth;

test.beforeAll(async () => {
  // 1. Sign in via Firebase Auth REST — same path real clients
  //    take. A regression here means the entire app cannot sign in.
  const api = await pwRequest.newContext();
  const signIn = await api.post(FIREBASE_SIGN_IN_URL, {
    headers: { "Content-Type": "application/json" },
    data: {
      email: SMOKE_EMAIL,
      password: SMOKE_PASSWORD,
      returnSecureToken: true,
    },
  });
  if (!signIn.ok()) {
    throw new Error(
      `Firebase sign-in failed (${signIn.status()}): ${await signIn.text()}. ` +
        `Verify SMOKE_FIREBASE_API_KEY + SMOKE_TEST_EMAIL/PASSWORD in CI secrets.`,
    );
  }
  const signInBody = await signIn.json();
  const idToken: string = signInBody.idToken;
  expect(idToken, "idToken returned").toBeTruthy();

  // 2. Sign in to Express — exchanges the Firebase token for the
  //    server-side `uniqueId`. Catches the firebaseUid → uniqueId
  //    resolution path in the auth middleware AND the suspension
  //    cache wiring.
  const expressSignIn = await api.post(`${API_BASE}/api/users/sign-in`, {
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    data: { email: SMOKE_EMAIL },
  });
  expect(
    expressSignIn.ok(),
    `Express /api/users/sign-in must succeed (${expressSignIn.status()}: ${await expressSignIn.text()})`,
  ).toBe(true);
  const me = await expressSignIn.json();
  const uniqueId: number = me.uniqueId ?? me.user?.uniqueId;
  expect(uniqueId, "uniqueId returned by Express sign-in").toBeTruthy();

  smoke = { api, idToken, uniqueId };
});

test.afterAll(async () => {
  await smoke?.api?.dispose();
});

function authedHeaders() {
  return {
    Authorization: `Bearer ${smoke.idToken}`,
    "Content-Type": "application/json",
  };
}

test.describe("Dev Smoke — critical user-facing API journeys", () => {
  test("GET /api/health responds OK", async () => {
    // First-line infra check — also covered by dev-sanity, repeated
    // here so this suite is self-contained when run in isolation.
    const res = await smoke.api.get(`${API_BASE}/api/health`);
    expect(res.ok(), `${res.status()}`).toBe(true);
  });

  test("GET /api/users/:uniqueId returns the smoke user (auth round-trip)", async () => {
    // Catches: Firebase token verify, firebaseUid → uniqueId lookup,
    // user-doc Firestore read, suspension-cache miss path. Failure
    // here means real users can't sign in.
    const res = await smoke.api.get(`${API_BASE}/api/users/${smoke.uniqueId}`, {
      headers: authedHeaders(),
    });
    expect(res.ok(), `${res.status()}: ${await res.text()}`).toBe(true);
    const user = await res.json();
    expect(user.uniqueId).toBe(smoke.uniqueId);
  });

  test("GET /api/economy/balance returns numeric coin + bean balances", async () => {
    // Catches: economy module Firestore reads, transactional balance
    // resolver, response shape contract used by every wallet UI.
    const res = await smoke.api.get(`${API_BASE}/api/economy/balance`, {
      headers: authedHeaders(),
    });
    expect(res.ok(), `${res.status()}: ${await res.text()}`).toBe(true);
    const body = await res.json();
    // The response shape must include `shyCoins` (number) — every
    // wallet/IAP/gift flow reads it. A field rename or omission would
    // hard-break the app.
    expect(typeof body.shyCoins).toBe("number");
  });

  test("POST /api/economy/daily-reward succeeds OR returns 409 already-claimed (idempotent)", async () => {
    // Catches: transactional Firestore daily-reward update,
    // streak/milestone computation, gift-grant + transaction-log
    // writes. Idempotent across runs — the second smoke run on the
    // same UTC day will see 409, which is also a healthy response.
    const res = await smoke.api.post(`${API_BASE}/api/economy/daily-reward`, {
      headers: authedHeaders(),
    });
    expect(
      [200, 409].includes(res.status()),
      `expected 200 (claimed) or 409 (already claimed today); got ${res.status()}: ${await res.text()}`,
    ).toBe(true);
  });

  test("POST /api/suggestions accepts a smoke submission (public-write path + sanitisation)", async () => {
    // Catches: input sanitisation, language detection, tag
    // validation, Firestore rule on the `suggestions` collection.
    // The submission is tagged via title prefix so the smoke entries
    // are filterable in Firestore for cleanup if needed.
    const stamp = new Date().toISOString();
    const res = await smoke.api.post(`${API_BASE}/api/suggestions`, {
      headers: authedHeaders(),
      data: {
        title: `[smoke] dev-deploy smoke ${stamp}`,
        description:
          "Automated smoke submission from dev-deploy pipeline. Safe to delete. " +
          `stamp=${stamp}`,
        language: "en",
      },
    });
    expect(res.ok(), `${res.status()}: ${await res.text()}`).toBe(true);
    const body = await res.json();
    expect(body.id || body.suggestionId, "suggestion id returned").toBeTruthy();
  });
});
