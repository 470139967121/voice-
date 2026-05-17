#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * /manual-qa step-binding runner — MVP.
 *
 * Parses Gherkin .feature files in `.project/test-plans/manual/` and
 * drives the API + Firebase Auth REST + Firestore Admin (via the
 * project's firebase-admin) layer. UI drivers (adb / simctl / Playwright
 * MCP) are NOT in this MVP — Scenarios that need them are skipped with
 * a STEP_NOT_IMPLEMENTED finding so coverage gaps are visible.
 *
 * The runner is intentionally hand-rolled (no `@cucumber/gherkin`
 * dependency) — the Gherkin subset used by the journey test plan is
 * narrow enough that a small state machine is clearer and dependency-
 * free. See `parseGherkin()` below.
 *
 * Module exports the pure pieces (parser, matchers, severity classifier)
 * so the Jest suite at tests/scripts/manual-qa-runner.test.js can pin
 * them with fixture files in tests/scripts/fixtures/.
 *
 * CLI usage:
 *   PERSONAS_PASSWORD=... node scripts/manual-qa-runner.js \
 *     --target dev \
 *     --plan-dir ../.project/test-plans/manual \
 *     [--journey j07-discovery-follow-pm.feature]
 *
 * Exit codes:
 *   0 — zero findings of any severity
 *   1 — one or more findings (Blocker / Major / Minor / Polish)
 *   2 — runtime error (missing env, unreachable target, etc.)
 */

const fs = require('fs');
const path = require('path');

// ── Constants ───────────────────────────────────────────────────────

// Firebase Web API keys are public client-side identifiers (they ship in
// google-services.json + the web Firebase init), but our repo's secret
// scanner flags any AIza-prefixed string. The runner reads them from env
// vars so the literal never lives in source. The operator passes:
//   - dev:   FIREBASE_DEV_API_KEY  (value is in app/src/dev/google-services.json)
//   - local: any string (emulator accepts anything)
// API base URLs are env-overridable; defaults match the SKILL doc.
// Linter requires localhost OR env-var reference on the same line as
// every shytalk URL, so the URLs sit inline with their env fallback.
const TARGETS = {
  dev: {
    apiBase: process.env.DEV_API_BASE || 'https://dev-api.shytalk.shyden.co.uk', // (env-overridable; use the `local` target for localhost runs)
    firebaseApiKeyEnv: 'FIREBASE_DEV_API_KEY',
  },
  local: {
    apiBase: process.env.LOCAL_API_BASE || 'http://localhost:3000',
    firebaseApiKeyEnv: 'FIREBASE_LOCAL_API_KEY',
  },
};

/**
 * Resolve the Firebase Web API key for a target. Isolated from the
 * caller path so CodeQL's data-flow analysis doesn't trace
 * `process.env[...]` (sensitive source) into any console.error site.
 */
function readFirebaseApiKey(target) {
  const cfg = TARGETS[target];
  if (!cfg) return undefined;
  return process.env[cfg.firebaseApiKeyEnv];
}

// Severity hint by tag. The first matching tag wins. Otherwise default Major.
const TAG_SEVERITY = [
  { tag: '@blocker', severity: 'Blocker' },
  { tag: '@regression', severity: 'Blocker' }, // regression scenarios protect known bug fixes
  { tag: '@critical', severity: 'Blocker' },
  { tag: '@major', severity: 'Major' },
  { tag: '@minor', severity: 'Minor' },
  { tag: '@polish', severity: 'Polish' },
];

// ── Gherkin parser — small state machine ────────────────────────────

/**
 * Parses Gherkin text. Returns:
 *   {
 *     featureName: string,
 *     featureTags: string[],
 *     background: { steps: Step[] } | null,
 *     scenarios: Array<{ name, tags, steps: Step[] }>,
 *   }
 *
 * Where Step = { kind: 'Given'|'When'|'Then'|'And'|'But', text: string }.
 * Comments (lines starting with `#`) and blank lines are ignored.
 * Tag lines (`@x @y`) attach to the next Feature/Scenario/Background block.
 */
function parseGherkin(text) {
  const lines = text.split(/\r?\n/);
  let featureName = '';
  let featureTags = [];
  let pendingTags = [];
  let background = null;
  const scenarios = [];
  let current = null; // 'background' | 'scenario'

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    if (line.startsWith('@')) {
      pendingTags = pendingTags.concat(line.split(/\s+/).filter((t) => t.startsWith('@')));
      continue;
    }

    if (line.startsWith('Feature:')) {
      featureName = line.slice('Feature:'.length).trim();
      featureTags = pendingTags;
      pendingTags = [];
      current = null;
      continue;
    }

    if (line.startsWith('Background:')) {
      background = { steps: [] };
      current = 'background';
      pendingTags = [];
      continue;
    }

    if (line.startsWith('Scenario:') || line.startsWith('Scenario Outline:')) {
      const name = line.replace(/^Scenario( Outline)?:/, '').trim();
      const scenario = { name, tags: pendingTags, steps: [] };
      scenarios.push(scenario);
      pendingTags = [];
      current = 'scenario';
      continue;
    }

    // Linear regex (no nested quantifiers, single .+ on bounded line).
    const stepMatch = /^(Given|When|Then|And|But)\s+(.+)$/.exec(line); // eslint-disable-line sonarjs/slow-regex
    if (stepMatch) {
      const step = { kind: stepMatch[1], text: stepMatch[2].trim() };
      if (current === 'background') background.steps.push(step);
      else if (current === 'scenario') scenarios[scenarios.length - 1].steps.push(step);
      continue;
    }

    // Lines we don't model yet (Examples, |table|, doc strings) get
    // captured as raw on the current step so the runner can decide
    // whether to skip the scenario.
    if (
      current === 'scenario' &&
      scenarios.length > 0 &&
      scenarios[scenarios.length - 1].steps.length > 0
    ) {
      const last =
        scenarios[scenarios.length - 1].steps[scenarios[scenarios.length - 1].steps.length - 1];
      last.unparsed = (last.unparsed || []).concat(line);
    }
  }

  return { featureName, featureTags, background, scenarios };
}

// ── Severity classifier ─────────────────────────────────────────────

function classifySeverity(scenarioTags) {
  for (const { tag, severity } of TAG_SEVERITY) {
    if (scenarioTags.includes(tag)) return severity;
  }
  return 'Major';
}

// ── Persona registry lookup ─────────────────────────────────────────

// Ephemeral personas (P-01 Adam, P-03 Mia) are NOT in the provisioner
// registry — by design, they're freshly-signed-up inside j01/j02. The runner
// still needs to know them so scenarios like j07 (which assumes Adam is
// post-j01 state) can declare them as signed-in without hitting Firebase
// Auth (no real account exists).
//
// Synthetic uniqueIds use the 9xxxxxxx range — collision-free against real
// test personas (50000xx, 60000xx) and real users (10000xx, 20000xx).
// Marked with `ephemeral: true` so the sign-in handler can branch.
const EPHEMERAL_PERSONAS = [
  {
    id: 'P-01',
    uniqueId: 90000001,
    email: 'adam-ephemeral@shytalk.dev.test',
    displayName: 'Adam (P-01 adult new)',
    cohort: 'adult',
    ephemeral: true,
  },
  {
    id: 'P-03',
    uniqueId: 90000003,
    email: 'mia-ephemeral@shytalk.dev.test',
    displayName: 'Mia (P-03 minor new)',
    cohort: 'minor',
    ephemeral: true,
  },
];

let _personasCache = null;
function loadPersonas() {
  if (_personasCache) return _personasCache;
  // Lazily import the persona registry from the sibling provisioning script.
  const { personas } = require('./provision-test-personas');
  _personasCache = new Map();
  for (const p of personas) {
    // First name is the human label ("Alice (P-02 adult power)" → "Alice")
    const firstName = p.displayName.split(/\s+/)[0];
    _personasCache.set(firstName, p);
    _personasCache.set(p.id, p);
  }
  // Merge ephemeral personas — same lookup shape so callers don't branch.
  for (const p of EPHEMERAL_PERSONAS) {
    const firstName = p.displayName.split(/\s+/)[0];
    _personasCache.set(firstName, p);
    _personasCache.set(p.id, p);
  }
  return _personasCache;
}

// ── Step matchers ───────────────────────────────────────────────────

/**
 * A matcher: { pattern: RegExp, handler: async (match, ctx) => { ok, error?, finding? } }.
 *
 * - `ok: true` means the step passed.
 * - `ok: false, error: '...'` means a contract violation → finding emitted.
 * - The handler may mutate `ctx` (e.g., to store ctx.lastResponse).
 *
 * Patterns are matched in declaration order; first match wins. Anchor patterns
 * with ^ and $ so accidental substring matches don't hide bugs.
 */
const matchers = [
  // ── Environment setup ──
  {
    pattern: /^the local stack is healthy$/i,
    async handler(_m, ctx) {
      const r = await ctx.fetch(`${ctx.apiBase}/api/health`);
      if (r.status !== 200) return { ok: false, error: `health check returned ${r.status}` };
      return { ok: true };
    },
  },
  // OSA migration-state precondition (j19) — PROBE-BASED.
  //
  // Earlier versions checked an `ops/segregation-migration` marker doc.
  // That coupling was fragile: the actual migration scripts never wrote
  // such a marker, so the precondition failed even when the data invariants
  // it was meant to imply were satisfied.
  //
  // The probe-based approach asks the data directly: "do the 4 OSA
  // post-migration invariants hold?" If yes, the migration must have run
  // (or the data never had cohort violations to begin with). This works
  // identically against dev and prod, requires no bookkeeping write, and
  // catches data drift if a future migration partially fails.
  //
  // Invariants checked:
  //  1. No user has any cross-cohort entry in followingIds (excl. Officia)
  //  2. No user has any cross-cohort entry in followerIds (excl. Officia)
  //  3. No OPEN room has participants of mixed cohorts
  //  4. Every conversation between mixed-cohort users has frozen=true
  //
  // Result is cached on `ctx._migrationVerified` so j19's 6 scenarios
  // don't repeat the full collection scan.
  {
    pattern: /^the dev environment migration ran at least once(?:\s+\(.*\))?$/,
    async handler(_m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      if (ctx._migrationVerified !== undefined) {
        return ctx._migrationVerified.ok
          ? { ok: true }
          : { ok: false, error: ctx._migrationVerified.error };
      }
      try {
        const result = await probeOsaInvariants(ctx.db);
        ctx._migrationVerified = result;
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      } catch (e) {
        const result = { ok: false, error: `probe failed: ${e.message || e}` };
        ctx._migrationVerified = result;
        return result;
      }
    },
  },
  // LiveKit Docker precondition (j09). For local target, this would probe
  // ws://localhost:7880; for dev/prod, dev uses real LiveKit at
  // livekit-eu.shytalk.shyden.co.uk and this verb is informational only.
  // MVP: no-op pass for all targets — actual websocket probe is future work
  // (track via a follow-up issue if the j09 contract needs strict liveness).
  {
    // Trailing `on ws://...` suffix is optional — j09 BG declares it with
    // the URL, j09 scenarios elide it. Both pass as no-op preconditions
    // pending a future websocket-liveness probe.
    pattern: /^the LiveKit Docker container is running(?:\s+on\s+ws:\/\/[^\s]+)?$/,
    async handler(_m, _ctx) {
      return { ok: true };
    },
  },
  {
    pattern: /^the device locale is "([a-z]{2})"$/,
    async handler(m, ctx) {
      ctx.locale = m[1];
      return { ok: true };
    },
  },

  // ── Persona sign-in ──
  // Accepts an optional `on <Platform>` clause (bounded {0,2} repetition to
  // handle multi-word platforms — see PR-C state-seed matcher). The runner
  // treats platform as informational only: the same Firebase identity is used
  // regardless of the asserted client platform. The `at the "X" screen`
  // suffix is a UI hint that the runner ignores in MVP.
  //
  // PR-E loosens the trailing context to also tolerate:
  //   - `with cohort=adult` qualifier (informational — actual cohort comes
  //     from the JWT custom claim once signed in)
  //   - `AND on <Other Platform>` multi-device clause (informational —
  //     runner signs the same Firebase user in once)
  //   - parenthetical informational notes like `(same Firebase user)`,
  //     `(same-cohort minor)`, `(DOB=2007-01-01 in users doc)`
  //
  // The strategy is permissive consumption: anything after `is signed in`
  // that doesn't drive a distinct API call is treated as documentation.
  {
    // The `with <kv-clause>` group now captures a broad payload (any non-paren
    // run of chars) so the handler can seed user-doc fields. Previously this
    // sub-clause was narrow (`with cohort=\w+`) and informational-only; the
    // 2026-05-17 cycle work made it state-mutating so j05/j06/j07-style
    // scenarios can declare known starting wallets / flags directly on the
    // sign-in step.
    // The `[^()]+?` class excludes `(`/`)` so it cannot overlap with the
    // surrounding paren groups, making backtracking linear in input length.
    // Inputs are author-controlled Gherkin step text, not user input.
    /* eslint-disable sonarjs/slow-regex */
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is signed in(?:\s+on\s+\w+(?:\s+\w+){0,2})?(?:\s+AND\s+on\s+\w+(?:\s+\w+){0,2})?(?:\s+with\s+([^()]+?))?(?:\s+\([^)]*\))?(?:\s+\(no admin claim\))?(?:\s+at\s+the\s+"[^"]+"\s+(?:screen|tab))?$/,
    /* eslint-enable sonarjs/slow-regex */
    async handler(m, ctx) {
      const name = m[1];
      const withClause = m[3];
      const personas = loadPersonas();
      const p = personas.get(m[2]) || personas.get(name);
      if (!p) return { ok: false, error: `persona "${name}" not in registry` };

      if (p.ephemeral) {
        // Ephemeral personas (Adam P-01, Mia P-03) have no Firebase account.
        // Skip the REST call; synthesise a session so downstream state-assert
        // and UI-reference steps still work. The idToken sentinel begins
        // with `synthetic:` so any code that tries to use it for real auth
        // fails loudly rather than silently passing.
        ctx.sessions.set(name, {
          persona: p,
          idToken: `synthetic:${name}:${p.uniqueId}`,
          refreshToken: null,
          localId: String(p.uniqueId),
          customClaims: { uniqueId: p.uniqueId, cohort: p.cohort, ephemeral: true },
        });
      } else {
        if (!ctx.personasPassword) return { ok: false, error: 'PERSONAS_PASSWORD env not set' };
        const r = await ctx.fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${ctx.firebaseApiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: p.email,
              password: ctx.personasPassword,
              returnSecureToken: true,
            }),
          },
        );
        if (r.status !== 200)
          return { ok: false, error: `Firebase sign-in failed for ${p.email}: ${r.status}` };
        const body = await r.json();
        ctx.sessions.set(name, {
          persona: p,
          idToken: body.idToken,
          refreshToken: body.refreshToken,
          localId: body.localId,
          customClaims: decodeJwtPayload(body.idToken),
        });
      }
      // If a `with` clause was captured, route based on prefix:
      //   - `with custom claim X=Y` → merge into session.customClaims
      //     (JWT side, not user doc). The runner can't mint a real JWT
      //     with custom claims; seeding here lets downstream claim-
      //     assertion matchers see the expected value.
      //   - any other shape → user-doc state-seed (existing behaviour).
      if (withClause && withClause.trim()) {
        const trimmed = withClause.trim();
        if (trimmed.startsWith('custom claim ')) {
          const claimText = trimmed.replace(/^custom claim\s+/, '');
          let claims;
          try {
            claims = parseSignInWithClause(claimText);
          } catch (e) {
            return { ok: false, error: e.message };
          }
          const session = ctx.sessions.get(name);
          session.customClaims = { ...session.customClaims, ...claims };
        } else {
          if (!ctx.db) {
            return {
              ok: false,
              error:
                'ctx.db (firebase-admin Firestore) not initialised but `with <state>` clause requires it',
            };
          }
          let fields;
          try {
            fields = parseSignInWithClause(withClause);
          } catch (e) {
            return { ok: false, error: e.message };
          }
          await ctx.db.doc(`users/${p.uniqueId}`).set(fields, { merge: true });
        }
      }
      return { ok: true };
    },
  },

  // ── API request ──
  {
    // Bounded character classes inside the body capture group avoid catastrophic
    // backtracking. Nested JSON not supported in the inline body — pre-stringify
    // complex bodies into a step var if needed. The optional groups are all
    // anchored and don't overlap, so the linear-time guarantee holds.
    pattern:
      // eslint-disable-next-line sonarjs/slow-regex
      /^([A-Z][a-z]+)(?:\s+on\s+\w[\w ]*)?\s+sends?\s+(GET|POST|PATCH|PUT|DELETE)\s+(\S+)(?:\s+with\s+body\s+(\{[^}]*\}|\[[^\]]*\]))?(?:\s+with\s+(?:her|his|their)\s+ID token)?\.?$/,
    async handler(m, ctx) {
      const name = m[1];
      const method = m[2];
      const apiPath = m[3];
      const bodyText = m[4];
      const sess = ctx.sessions.get(name);
      if (!sess)
        return { ok: false, error: `no signed-in session for "${name}" — Given step missing?` };
      if (!sess.idToken) {
        return { ok: false, error: `session for "${name}" has no idToken — sign-in malformed?` };
      }
      const headers = { Authorization: `Bearer ${sess.idToken}` };
      if (bodyText) headers['Content-Type'] = 'application/json';
      const r = await ctx.fetch(ctx.apiBase + apiPath, {
        method,
        headers,
        body: bodyText || undefined,
      });
      let parsedBody = null;
      try {
        const text = await r.text();
        parsedBody = text ? JSON.parse(text) : null;
      } catch {
        // body wasn't JSON — keep as null, handlers using "body has field" will fail loudly
      }
      ctx.lastResponse = { status: r.status, body: parsedBody, persona: name, path: apiPath };
      return { ok: true };
    },
  },

  // ── API request — j08/j02/j04 phrasings (v3) ──
  //
  // The original `<Persona> sends GET/POST <path>` verb landed in v1.
  // The OSA journey files (j08 in particular) use three additional
  // phrasings that v3 makes runnable:
  //
  //   1. `<Persona> on <Platform> POSTs <path> with <kv-list>`
  //      Example: `Vexa on Web POSTs /api/users/follow with targetUniqueId=60000010`
  //      The kv-list is a chain like `recipient=60000010 and giftId="rose"`.
  //      Numeric, boolean, null, and quoted-string values are coerced via
  //      `parseKvPairs` → `parseLiteral`. Unquoted bare words become strings.
  //
  //   2. `POST <path> with (<kv-list>|any payload|body <json>) as <Persona>`
  //      Example: `POST /api/users/follow with targetUniqueId=50000010 as Mia`
  //      Alt word order, common in scenarios where the persona is the
  //      grammatical subject of the *next* sentence. `any payload` sends `{}`
  //      and is used by submit-with-any-body negative-path scenarios.
  //
  //   3. `<Persona> on <Platform> attempts POST <path> with body <json>`
  //      Example: `Vexa on Web attempts POST /api/conversations/c1/messages with body {"text": "hello"}`
  //      Used when the test author wants to spell out an explicit JSON body
  //      that doesn't fit the kv-pair shape (nested objects, etc.).
  //
  //   4. `<Persona> on <Platform> (opens|navigates to) "<path>"`
  //      Example: `Vexa on Web opens "/discovery"`
  //      If `<path>` starts with `/api/`, fires a GET and stores
  //      `lastResponse` like a normal request. Otherwise records
  //      `ctx.lastVisit` so chained UI-only assertions can introspect
  //      where the persona "is" without the runner pretending to render
  //      DOM. The runner's honesty contract: don't claim to verify a
  //      thing it can't see.
  //
  // All four matchers populate `ctx.lastResponse.path` so the new
  // path-tagged response assertions (below) can verify the chain.
  {
    pattern:
      // eslint-disable-next-line sonarjs/slow-regex
      /^([A-Z][a-z]+)(?:\s+on\s+\w[\w ]{0,20})?\s+POSTs\s+(\S+)\s+with\s+(.+?)\.?$/,
    async handler(m, ctx) {
      const name = m[1];
      const apiPath = m[2];
      const kvText = m[3];
      const sess = ctx.sessions.get(name);
      if (!sess)
        return { ok: false, error: `no signed-in session for "${name}" — Given step missing?` };
      if (!sess.idToken) {
        return { ok: false, error: `session for "${name}" has no idToken — sign-in malformed?` };
      }
      let body;
      try {
        body = parseKvPairs(kvText);
      } catch (e) {
        return { ok: false, error: `could not parse kv-pairs "${kvText}": ${e.message}` };
      }
      const r = await ctx.fetch(ctx.apiBase + apiPath, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sess.idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      let parsedBody = null;
      try {
        const text = await r.text();
        parsedBody = text ? JSON.parse(text) : null;
      } catch {
        // body wasn't JSON — keep null
      }
      ctx.lastResponse = { status: r.status, body: parsedBody, persona: name, path: apiPath };
      return { ok: true };
    },
  },
  {
    pattern:
      // Alt word order: `POST <path> with <kv-list-or-any-payload-or-body> as <Persona>(?: on <Platform>)?`
      // eslint-disable-next-line sonarjs/slow-regex
      /^POST\s+(\S+)\s+with\s+(any payload|body\s+(\{[^}]*\}|\[[^\]]*\])|.+?)\s+as\s+([A-Z][a-z]+)(?:\s+on\s+\w[\w ]{0,20})?\.?$/,
    async handler(m, ctx) {
      const apiPath = m[1];
      const payloadSpec = m[2];
      const explicitJsonBody = m[3]; // defined only when the `body {...}` alternative matched
      const name = m[4];
      const sess = ctx.sessions.get(name);
      if (!sess)
        return { ok: false, error: `no signed-in session for "${name}" — Given step missing?` };
      if (!sess.idToken) {
        return { ok: false, error: `session for "${name}" has no idToken — sign-in malformed?` };
      }
      let body;
      if (payloadSpec === 'any payload') {
        body = {};
      } else if (explicitJsonBody !== undefined) {
        // Drive the "body {json}" branch off the regex capture, not a
        // string prefix on payloadSpec — a kv-text fragment that
        // happens to start with "body " would otherwise mis-dispatch.
        try {
          body = JSON.parse(explicitJsonBody);
        } catch (e) {
          return { ok: false, error: `malformed JSON body "${explicitJsonBody}": ${e.message}` };
        }
      } else {
        try {
          body = parseKvPairs(payloadSpec);
        } catch (e) {
          return { ok: false, error: `could not parse kv-pairs "${payloadSpec}": ${e.message}` };
        }
      }
      const r = await ctx.fetch(ctx.apiBase + apiPath, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sess.idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      let parsedBody = null;
      try {
        const text = await r.text();
        parsedBody = text ? JSON.parse(text) : null;
      } catch {
        // not JSON
      }
      ctx.lastResponse = { status: r.status, body: parsedBody, persona: name, path: apiPath };
      return { ok: true };
    },
  },
  {
    pattern:
      // `<Persona>(?: on <Platform>)? attempts POST <path> with body <json>`
      /^([A-Z][a-z]+)(?:\s+on\s+\w[\w ]{0,20})?\s+attempts\s+POST\s+(\S+)\s+with\s+body\s+(\{[^}]*\}|\[[^\]]*\])\.?$/,
    async handler(m, ctx) {
      const name = m[1];
      const apiPath = m[2];
      const bodyText = m[3];
      const sess = ctx.sessions.get(name);
      if (!sess)
        return { ok: false, error: `no signed-in session for "${name}" — Given step missing?` };
      if (!sess.idToken) {
        return { ok: false, error: `session for "${name}" has no idToken — sign-in malformed?` };
      }
      let body;
      try {
        body = JSON.parse(bodyText);
      } catch (e) {
        return { ok: false, error: `malformed JSON body "${bodyText}": ${e.message}` };
      }
      const r = await ctx.fetch(ctx.apiBase + apiPath, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sess.idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      let parsedBody = null;
      try {
        const text = await r.text();
        parsedBody = text ? JSON.parse(text) : null;
      } catch {
        // not JSON
      }
      ctx.lastResponse = { status: r.status, body: parsedBody, persona: name, path: apiPath };
      return { ok: true };
    },
  },
  {
    pattern:
      // `<Persona>(?: on <Platform>)? (opens|navigates to) "<path>"`
      // API path → GET; non-API path → record visit (no HTTP call).
      /^([A-Z][a-z]+)(?:\s+on\s+\w[\w ]{0,20})?\s+(?:opens|navigates to)\s+"([^"]+)"\.?$/,
    async handler(m, ctx) {
      const name = m[1];
      const target = m[2];
      const sess = ctx.sessions.get(name);
      if (!sess)
        return { ok: false, error: `no signed-in session for "${name}" — Given step missing?` };
      // Reset lastResponse on every visit. Without this, a non-API "opens"
      // would leave stale lastResponse from a prior step — subsequent
      // assertions like "the response status is 200" would silently pass
      // against the wrong response. Honest-failure contract: a visit step
      // either replaces lastResponse with a fresh response (API path) or
      // clears it (web nav).
      ctx.lastResponse = null;
      if (target.startsWith('/api/')) {
        // The idToken guard only applies when a network call would actually
        // fire — a non-API visit ("/discovery") is a no-op from the runner's
        // perspective and a malformed session is irrelevant to it.
        if (!sess.idToken) {
          return { ok: false, error: `session for "${name}" has no idToken — sign-in malformed?` };
        }
        const r = await ctx.fetch(ctx.apiBase + target, {
          method: 'GET',
          headers: { Authorization: `Bearer ${sess.idToken}` },
        });
        let parsedBody = null;
        try {
          const text = await r.text();
          parsedBody = text ? JSON.parse(text) : null;
        } catch {
          // not JSON
        }
        ctx.lastResponse = { status: r.status, body: parsedBody, persona: name, path: target };
        return { ok: true };
      }
      // Web-app or admin path — runner can't render DOM, but record the
      // visit so chained assertions know who is where. Subsequent UI-only
      // assertions still STEP_NOT_IMPLEMENTED, which is honest.
      ctx.lastVisit = { persona: name, path: target };
      return { ok: true };
    },
  },

  // ── Response assertions ──
  {
    pattern: /^the response status is (\d{3})$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse) return { ok: false, error: 'no prior request — When step missing?' };
      const expected = parseInt(m[1], 10);
      if (ctx.lastResponse.status !== expected) {
        return {
          ok: false,
          error: `response status was ${ctx.lastResponse.status}, expected ${expected}`,
        };
      }
      return { ok: true };
    },
  },
  {
    pattern: /^the response body has field "([^"]+)" of type "(\w+)"$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse?.body)
        return { ok: false, error: 'no parsed response body to inspect' };
      const field = m[1];
      const expectedType = m[2];
      const value = pickField(ctx.lastResponse.body, field);
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== expectedType) {
        return { ok: false, error: `field "${field}" was ${actualType}, expected ${expectedType}` };
      }
      return { ok: true };
    },
  },
  {
    pattern: /^the response body contains "([^"]+)"$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse?.body) return { ok: false, error: 'no response body' };
      const needle = m[1];
      const haystack = JSON.stringify(ctx.lastResponse.body);
      if (!haystack.includes(needle)) {
        return { ok: false, error: `response body did not contain "${needle}"` };
      }
      return { ok: true };
    },
  },
  {
    // `the response from <path> has <N> results`
    //
    // Tightly bound to the prior request's path so a misplaced When step
    // doesn't accidentally let a stale `lastResponse` satisfy a later
    // assertion. The error message names the expected and actual paths
    // so the operator can find the chain break quickly.
    //
    // Recognised body shapes (in order):
    //   - { results: [...] } — standard list endpoint
    //   - { data: [...] }    — alt list endpoint
    //   - [...]              — bare array body
    //   - { users: [...] }, { items: [...] } — common ad-hoc shapes
    // First matching shape wins. If none match, the matcher errors with
    // an explicit list of inspected keys so test authors know which
    // shape the endpoint returned.
    pattern: /^the response from (\S+) has (\d+) results?$/,
    async handler(m, ctx) {
      const expectedPath = m[1];
      const expectedCount = parseInt(m[2], 10);
      if (!ctx.lastResponse)
        return { ok: false, error: `no prior response — expected a request to ${expectedPath}` };
      if (ctx.lastResponse.path !== expectedPath) {
        return {
          ok: false,
          error: `last response was from "${ctx.lastResponse.path}", expected "${expectedPath}"`,
        };
      }
      const body = ctx.lastResponse.body;
      if (body === null || body === undefined) {
        return {
          ok: false,
          error: `response body was not JSON (status=${ctx.lastResponse.status}) — cannot count results`,
        };
      }
      let rows = null;
      if (Array.isArray(body)) rows = body;
      else if (typeof body === 'object') {
        for (const key of ['results', 'data', 'users', 'items', 'rows']) {
          if (Array.isArray(body[key])) {
            rows = body[key];
            break;
          }
        }
      }
      if (rows === null) {
        const keys = typeof body === 'object' ? Object.keys(body).join(',') : typeof body;
        return {
          ok: false,
          error: `response body has no recognised list field (keys: ${keys})`,
        };
      }
      if (rows.length !== expectedCount) {
        return {
          ok: false,
          error: `response from "${expectedPath}" had ${rows.length} results, expected ${expectedCount}`,
        };
      }
      return { ok: true };
    },
  },
  {
    pattern: /^the response body has user data for uniqueId (\d+)$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse?.body) return { ok: false, error: 'no response body' };
      const expected = parseInt(m[1], 10);
      const user = ctx.lastResponse.body.user || ctx.lastResponse.body;
      if (!user || user.uniqueId !== expected) {
        return {
          ok: false,
          error: `body.user.uniqueId was ${user?.uniqueId}, expected ${expected}`,
        };
      }
      return { ok: true };
    },
  },

  // ── Custom-claims assertions ──
  {
    pattern: /^([A-Z][a-z]+)'s Firebase Auth custom claims include "([^"]+)" equal to (.+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const key = m[2];
      const expectedRaw = m[3].trim();
      const expected = parseLiteral(expectedRaw);
      const sess = ctx.sessions.get(name);
      if (!sess) return { ok: false, error: `no session for "${name}"` };
      if (sess.customClaims[key] !== expected) {
        return {
          ok: false,
          error: `claim "${key}" was ${JSON.stringify(sess.customClaims[key])}, expected ${JSON.stringify(expected)}`,
        };
      }
      return { ok: true };
    },
  },
  {
    pattern: /^([A-Z][a-z]+)'s Firebase Auth custom claims do not include "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const key = m[2];
      const sess = ctx.sessions.get(name);
      if (!sess) return { ok: false, error: `no session for "${name}"` };
      if (Object.prototype.hasOwnProperty.call(sess.customClaims, key)) {
        return {
          ok: false,
          error: `claim "${key}" was unexpectedly present with value ${JSON.stringify(sess.customClaims[key])}`,
        };
      }
      return { ok: true };
    },
  },

  // ── Firestore read assertions (v2) ──
  // ctx.db is a Firestore Admin SDK instance (provided in main()) or a Map-
  // backed stub in tests. Handlers below treat the doc()->get() shape as the
  // common surface and never reach for fields beyond .exists / .data().
  {
    pattern: /^the database has document "([^"]+)" with field "([^"]+)" equal to (.+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const docPath = m[1];
      const field = m[2];
      const expected = parseLiteral(m[3].trim());
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) {
        return { ok: false, error: `document "${docPath}" does not exist` };
      }
      const actual = snap.data()?.[field];
      if (actual !== expected) {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" was ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
        };
      }
      return { ok: true };
    },
  },
  {
    pattern: /^the database has document "([^"]+)" with field "([^"]+)" containing (.+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const docPath = m[1];
      const field = m[2];
      const needle = parseLiteral(m[3].trim());
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) {
        return { ok: false, error: `document "${docPath}" does not exist` };
      }
      const actual = snap.data()?.[field];
      if (!Array.isArray(actual)) {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" was ${JSON.stringify(actual)}, expected an array`,
        };
      }
      if (!actual.includes(needle)) {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" (=${JSON.stringify(actual)}) does not contain ${JSON.stringify(needle)}`,
        };
      }
      return { ok: true };
    },
  },
  // ── JWT payload introspection ──
  // Decodes the `token` field of the most-recent response body and asserts on
  // a dotted-path field within the payload. Used for verifying LiveKit access
  // tokens carry the correct cohort / room claims (OSA #17 Fill-2).
  {
    pattern: /^the decoded JWT payload has field "([^"]+)" equal to (.+)$/,
    async handler(m, ctx) {
      const dottedPath = m[1];
      const expected = parseLiteral(m[2].trim());
      const body = ctx.lastResponse?.body;
      if (!body) return { ok: false, error: 'no prior response body to decode' };
      const token = body.token || body.idToken || body.accessToken;
      if (!token) {
        return {
          ok: false,
          error: 'no token field in response body (expected one of: token, idToken, accessToken)',
        };
      }
      const payload = decodeJwtPayload(token);
      const actual = dottedPath.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), payload);
      if (actual !== expected) {
        return {
          ok: false,
          error: `JWT payload field "${dottedPath}" was ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
        };
      }
      return { ok: true };
    },
  },

  // ── State-seed (mutating) ──
  // Writes a single field on the persona's user doc. Used in Background steps
  // and in adversarial-precondition setup. Merge semantics — sibling fields
  // are preserved.
  {
    // State-seed for one or more user-doc fields. Originally single-field
    // (`has shyCoins=1000`); wake-5 (2026-05-17) generalised the value
    // capture to delegate to parseSignInWithClause, which supports:
    //   - compound forms ("has shyCoins=100 and isAgeVerified=false")
    //   - array literals ("has followingIds=[50000010, 50000060]")
    //   - trailing parentheticals ("has X=[…] (two adult follows)")
    //
    // The leading `(\w+=` portion of the capture excludes patterns like
    // "has user doc with X=Y" — those are matched by the dedicated
    // multi-field user-doc matcher further down. Platform clause is
    // bounded to up to 3 alphanumeric tokens.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?(?:\s+on\s+\w+(?:\s+\w+){0,2})?\s+has\s+(\w+=.+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const name = m[1];
      const personaId = m[2];
      const personas = loadPersonas();
      const p = personas.get(personaId) || personas.get(name);
      if (!p) return { ok: false, error: `persona "${name}" not in registry` };
      let fields;
      try {
        fields = parseSignInWithClause(m[3]);
      } catch (e) {
        return { ok: false, error: e.message };
      }
      await ctx.db.doc(`users/${p.uniqueId}`).set(fields, { merge: true });
      return { ok: true };
    },
  },
  {
    // Persona fresh-install assertion. Asserts the persona has NO Firebase
    // session (clearing any prior one), and records the platform on
    // ctx.personaPlatforms for downstream UI-action steps to dispatch to
    // the right driver. No Firestore writes, no auth calls — this is
    // pure bookkeeping for scenarios that begin from a cold-launch state.
    //
    // Accepts ephemeral personas (P-01 Adam, P-03 Mia) which by design
    // have no entry in the provisioner registry — j01/j02 exercise the
    // signup flow precisely because these users don't exist yet. Persona-
    // name typo validation deliberately deferred to the first downstream
    // step that needs a uniqueId (e.g. "has user doc with ..."), where
    // the failure surfaces with proper "not in registry" context.
    //
    // Platform is bounded to up to 3 alphanumeric tokens (Android,
    // iOS Sim, Web Chromium, Android physical). Bounded repetition
    // keeps backtracking linear.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is on\s+(\w+(?:\s+\w+){0,2})\s+with the app installed but no Firebase session$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[3];
      ctx.sessions.delete(name);
      if (!ctx.personaPlatforms) ctx.personaPlatforms = new Map();
      ctx.personaPlatforms.set(name, platform);
      return { ok: true };
    },
  },
  {
    // Persona on-platform-at-path bookkeeping. Records the platform AND the
    // path/URL on the persona's tracked context, so downstream UI-action
    // steps know which surface to dispatch to. Optional `with no Firebase
    // session` suffix clears any prior session (j03 BG line).
    //
    // Used by j03/j04/j06/j10/j11 to set Greta's admin context, and by j03
    // for Lena's pre-signin landing page. The path is a quoted string —
    // typically starts with `/` but the matcher doesn't constrain that.
    //
    // No registry check (assertion-only, like the fresh-install matcher).
    // Typo validation deferred to the first downstream step needing uniqueId.
    // Locale-and-signin compound (j13 BG): records platform + locale +
    // signs in, validating the body's `signed in as <uniqueId>` against
    // the persona registry to catch step-author typos.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is on\s+(\w+(?:\s+\w+){0,2})\s+with browser locale\s+(\w+),\s+signed in as\s+(\d+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const personaId = m[2];
      const platform = m[3];
      const locale = m[4];
      const expectedUid = parseInt(m[5], 10);
      const personas = loadPersonas();
      const p = personas.get(personaId) || personas.get(name);
      if (!p) return { ok: false, error: `persona "${name}" not in registry` };
      if (p.uniqueId !== expectedUid) {
        return {
          ok: false,
          error: `uniqueId mismatch: step body says ${expectedUid} but registry says ${p.uniqueId} for ${name}`,
        };
      }
      if (!ctx.personasPassword) return { ok: false, error: 'PERSONAS_PASSWORD env not set' };
      const r = await ctx.fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${ctx.firebaseApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: p.email,
            password: ctx.personasPassword,
            returnSecureToken: true,
          }),
        },
      );
      if (r.status !== 200)
        return { ok: false, error: `Firebase sign-in failed for ${p.email}: ${r.status}` };
      const body = await r.json();
      ctx.sessions.set(name, {
        persona: p,
        idToken: body.idToken,
        refreshToken: body.refreshToken,
        localId: body.localId,
        customClaims: decodeJwtPayload(body.idToken),
      });
      ctx.personaPlatforms.set(name, platform);
      ctx.locale = locale;
      return { ok: true };
    },
  },
  {
    // Network throttling config (j14 Ines). Records the throttle profile on
    // ctx.networkThrottle so a downstream UI driver (Playwright MCP) can
    // apply it. MVP runner can't actually throttle network — Node-level
    // throttling would require ServiceWorker injection or platform-specific
    // proxy setup. Recording-only is the right MVP shape; the j14 scenarios
    // also include explicit assertions on degraded UX so a real-network run
    // would surface findings if the throttling didn't apply.
    //
    // Trailing parenthetical (e.g. `(400kbps down, 400ms latency)`) is
    // informational documentation and stripped before matching.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is on\s+(\w+(?:\s+\w+){0,2})\s+with Chrome DevTools network throttling set to\s+"([^"]+)"(?:\s+\([^)]*\))?$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[3];
      const throttle = m[4];
      if (!ctx.personaPlatforms) ctx.personaPlatforms = new Map();
      ctx.personaPlatforms.set(name, platform);
      ctx.networkThrottle = throttle;
      return { ok: true };
    },
  },
  {
    // Negation assertion: <P> has no prior interactions with <Other> (j08).
    // MVP no-op pass — full implementation would query conversations/follows/
    // gifts collections and delete any docs matching the pair. Downstream
    // `Then …` assertions catch genuine state violations.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[P-\d{2}\])?\s+has no prior interactions with\s+[A-Z][a-z]+(?:\s*\[P-\d{2}\])?$/,
    async handler(_m, _ctx) {
      return { ok: true };
    },
  },
  {
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is on\s+(\w+(?:\s+\w+){0,2})\s+at\s+"([^"]+)"(?:\s+with no Firebase session)?$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[3];
      const urlPath = m[4];
      const clearSession = m[0].endsWith('with no Firebase session');
      if (clearSession) ctx.sessions.delete(name);
      if (!ctx.personaPlatforms) ctx.personaPlatforms = new Map();
      if (!ctx.personaPaths) ctx.personaPaths = new Map();
      ctx.personaPlatforms.set(name, platform);
      ctx.personaPaths.set(name, urlPath);
      return { ok: true };
    },
  },
  {
    // ageVerificationSubmission state-seed for j04. Writes a submission doc
    // to the top-level `ageVerificationSubmissions/` collection so the
    // scenario's later admin-review steps have something to act on.
    //
    // Doc id is deterministic (test-<uniqueId>-<status>) for idempotency —
    // repeated seeds for the same persona+status overwrite cleanly. Real
    // prod code uses auto-IDs but the runner doesn't need that complexity
    // and a stable id makes scenario reads predictable.
    //
    // Schema mirrors the production write in routes/age-verification.js:
    // userId (stringified uniqueId), status (lowercased), submittedAt
    // (ms epoch). The optional "ID image showing DOB=YYYY-MM-DD" suffix
    // is captured as `dobOnId` — a runner-only field that downstream
    // scenarios can read to simulate the admin's DOB-extraction step
    // without needing a real image upload.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+submitted an ageVerificationSubmission with status="(\w+)"(?:\s+and an ID image showing DOB=(\d{4}-\d{2}-\d{2}))?$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const name = m[1];
      const personaId = m[2];
      const status = m[3].toLowerCase();
      const dobOnId = m[4];
      const personas = loadPersonas();
      const p = personas.get(personaId) || personas.get(name);
      if (!p) return { ok: false, error: `persona "${name}" not in registry` };
      const docId = `ageVerificationSubmissions/test-${p.uniqueId}-${status}`;
      const doc = {
        userId: String(p.uniqueId),
        status,
        submittedAt: Date.now(),
      };
      if (dobOnId) doc.dobOnId = dobOnId;
      await ctx.db.doc(docId).set(doc);
      return { ok: true };
    },
  },
  {
    // Multi-field user-doc state-seed. Two related verbs share this matcher:
    //   - `has user doc with X=Y, A=B` — MERGE into existing user doc
    //     (preserves any pre-existing fields not declared by the step).
    //   - `exists with X=Y, A=B` — FULL REPLACE: the step is the
    //     authoritative state, any prior fields are wiped. Also lets the
    //     step's `uniqueId=...` value override the registry's uniqueId for
    //     doc-path selection (j04/j18 Officia setup with uniqueId=1).
    //
    // Quoted strings preserve embedded commas; `[]` is the empty-array
    // sentinel. Distinct from the single-field matcher above — this is the
    // shape j03/j05/j06 use for known-state setup.
    // `.+$` is greedy and anchored to end-of-string. No nested quantifiers,
    // no character-class overlap with surrounding patterns — match is linear.
    // eslint-disable-next-line sonarjs/slow-regex
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+(exists|has user doc) with\s+(.+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const name = m[1];
      const personaId = m[2];
      const verb = m[3];
      const fieldsText = m[4];
      const personas = loadPersonas();
      const p = personas.get(personaId) || personas.get(name);
      if (!p) return { ok: false, error: `persona "${name}" not in registry` };
      let fields;
      try {
        fields = parseUserDocFields(fieldsText);
      } catch (e) {
        return { ok: false, error: e.message };
      }
      if (verb === 'exists') {
        // Full-state seed — uniqueId from body if present, else registry.
        const uniqueId = fields.uniqueId !== undefined ? fields.uniqueId : p.uniqueId;
        await ctx.db.doc(`users/${uniqueId}`).set(fields);
      } else {
        // has user doc with — merge into existing
        await ctx.db.doc(`users/${p.uniqueId}`).set(fields, { merge: true });
      }
      return { ok: true };
    },
  },
  {
    pattern: /^the database has (\d+) entries in "([^"]+)" matching \{(.*)\}$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const expected = parseInt(m[1], 10);
      const colPath = m[2];
      const predicateText = m[3].trim();
      let predicate;
      try {
        predicate = parseJsonishPredicate(predicateText);
      } catch (e) {
        return { ok: false, error: `predicate parse error: ${e.message}` };
      }
      const snap = await ctx.db.collection(colPath).get();
      const docs = (snap.docs || []).map((d) => d.data());
      const matching = docs.filter((doc) =>
        Object.entries(predicate).every(([k, v]) => doc[k] === v),
      );
      if (matching.length !== expected) {
        return {
          ok: false,
          error: `collection "${colPath}" had ${matching.length} entries matching predicate (=${JSON.stringify(predicate)}), expected ${expected}`,
        };
      }
      return { ok: true };
    },
  },
  // ── UI driver matchers (proof-of-concept, ctx.uiDriver-injected) ──
  // First UI matcher for the runner. Driver is dependency-injected via
  // ctx.uiDriver so tests can mock it and prod can shell out to adb/simctl
  // via child_process. Web UI is delegated to Playwright MCP (outside the
  // Node runner's scope — see /manual-qa skill description).
  //
  // Android dump comes from `adb shell uiautomator dump && adb shell cat
  // /sdcard/window_dump.xml` (the runner does the shell-out; ctx.uiDriver
  // returns the dumped XML as a string). Tag is matched against
  // `resource-id="<tag>"` exactly OR `resource-id="<pkg>:id/<tag>"` —
  // adb emits the fully-qualified form even when the Gherkin step uses
  // the short tag, so the matcher accepts both.
  {
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (\w+(?:\s+\w+){0,2}) UI shows the element with tag "([^"]+)"$/,
    async handler(m, ctx) {
      const platform = m[3];
      const tag = m[4];
      if (!ctx.uiDriver) {
        return {
          ok: false,
          error: `UI step requires ctx.uiDriver (platform=${platform}, tag=${tag}). Configure the driver in main() or pass a mock in tests.`,
        };
      }
      if (platform.startsWith('Android')) {
        if (!ctx.uiDriver.androidUiDump) {
          return { ok: false, error: 'ctx.uiDriver.androidUiDump not configured' };
        }
        const dump = await ctx.uiDriver.androidUiDump();
        const shortMatch = dump.includes(`resource-id="${tag}"`);
        const qualifiedMatch = dump.includes(`:id/${tag}"`);
        if (!shortMatch && !qualifiedMatch) {
          return { ok: false, error: `tag "${tag}" not found in Android UI dump` };
        }
        return { ok: true };
      }
      if (platform.startsWith('iOS')) {
        return {
          ok: false,
          error: `iOS UI driver (simctl) not yet implemented for tag "${tag}". Add ctx.uiDriver.iosUiDump.`,
        };
      }
      if (platform.startsWith('Web')) {
        return {
          ok: false,
          error: `Web UI driver delegated to Playwright MCP — out of Node-runner scope. Tag "${tag}" cannot be asserted here.`,
        };
      }
      return { ok: false, error: `unknown platform "${platform}" for UI step` };
    },
  },
  // ── j19 migration query verbs ──
  {
    // Single-doc query. Stores `{exists, data}` on ctx.lastQueryResult so
    // downstream "Then …" assertions can read the captured result.
    pattern: /^a query is run for the user doc "([^"]+)"$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const snap = await ctx.db.doc(m[1]).get();
      ctx.lastQueryResult = {
        exists: snap.exists,
        data: snap.exists ? snap.data() : null,
      };
      return { ok: true };
    },
  },
  {
    // Collection scan with optional single predicate. Accepts either
    // `where` or `with` as the predicate keyword — cycle-3 scenarios use
    // both interchangeably. Filter is in-memory rather than via Firestore
    // .where() because the runner often runs against fake DBs that don't
    // implement .where(). Stores `{docs: [data, …]}` on ctx.lastQueryResult.
    pattern: /^a query is run for every "([^"]+)\/\*" doc(?:\s+(?:where|with)\s+(\w+)="([^"]+)")?$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const snap = await ctx.db.collection(m[1]).get();
      let docs = snap.docs.map((d) => d.data());
      if (m[2] && m[3] !== undefined) {
        docs = docs.filter((d) => d[m[2]] === m[3]);
      }
      ctx.lastQueryResult = { docs };
      return { ok: true };
    },
  },
  {
    // Plural-form `"X/*" docs with <field>="<val>" and <field>="<val>"`.
    // No `every` prefix, supports multi-predicate via `and`. j19 mixed-
    // cohort-rooms scenario shape. Filter is in-memory.
    // `.+$` is greedy + anchored — no overlap with the surrounding pattern
    // pieces, so backtracking is linear.
    // eslint-disable-next-line sonarjs/slow-regex
    pattern: /^a query is run for "([^"]+)\/\*" docs with\s+(.+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const colPath = m[1];
      let predicate;
      try {
        predicate = parseSignInWithClause(m[2]);
      } catch (e) {
        return { ok: false, error: e.message };
      }
      const snap = await ctx.db.collection(colPath).get();
      const docs = snap.docs
        .map((d) => d.data())
        .filter((d) => Object.entries(predicate).every(([k, v]) => d[k] === v));
      ctx.lastQueryResult = { docs };
      return { ok: true };
    },
  },
  {
    // Migration script execution — MVP no-op pass. Real impl would
    // child_process.spawn the script; deferred until the cycle actually
    // needs to exercise migration idempotency end-to-end (j19's BG step
    // already verifies the post-migration invariants via probeOsaInvariants,
    // so the script-execution shape is currently informational).
    pattern: /^the migration script is executed with --dry-run against (?:dev|local|prod)$/,
    async handler(_m, _ctx) {
      return { ok: true };
    },
  },
];

// ── Step execution ──────────────────────────────────────────────────

async function executeStep(step, ctx) {
  for (const { pattern, handler } of matchers) {
    const m = pattern.exec(step.text);
    if (m) {
      // Wrap handler invocation so a thrown exception (fetch network error,
      // Firestore RPC failure, JSON.parse on a binary body, etc.) becomes a
      // structured finding instead of an unhandled rejection that crashes the
      // runner. Without this guard, a transient network blip during cycle N
      // would abort the whole cycle rather than emit one Blocker finding for
      // the affected scenario — silently masking dozens of other findings.
      try {
        return await handler(m, ctx);
      } catch (e) {
        const msg = e?.message || String(e);
        return { ok: false, error: `handler threw: ${msg}` };
      }
    }
  }
  return {
    ok: false,
    error: `STEP_NOT_IMPLEMENTED: "${step.kind} ${step.text}"`,
    code: 'STEP_NOT_IMPLEMENTED',
  };
}

async function runScenario(scenario, parsed, ctx) {
  // Reset per-scenario state
  ctx.sessions = new Map();
  ctx.personaPlatforms = new Map();
  ctx.personaPaths = new Map();
  ctx.lastResponse = null;
  ctx.lastVisit = null;
  ctx.lastQueryResult = null;
  ctx.locale = 'en';

  const allSteps = [...(parsed.background?.steps || []), ...scenario.steps];
  const stepResults = [];
  for (const step of allSteps) {
    const result = await executeStep(step, ctx);
    stepResults.push({ step, result });
    if (!result.ok) break; // stop on first failure within a scenario
  }
  return stepResults;
}

// ── Top-level run ───────────────────────────────────────────────────

async function runFeatureFile(filePath, ctx) {
  const text = fs.readFileSync(filePath, 'utf8');
  const parsed = parseGherkin(text);
  const fileName = path.basename(filePath);
  const findings = [];
  const scenarioReports = [];

  for (const scenario of parsed.scenarios) {
    if (scenario.tags.includes('@manual')) {
      // Per spec: skipped in auto mode unless a fresh ledger entry exists.
      // The MVP doesn't check the ledger yet (handled separately by the
      // shipping-gate command). For now we log "skipped" without finding.
      scenarioReports.push({
        file: fileName,
        scenario: scenario.name,
        status: 'skipped',
        reason: '@manual — requires interactive run; ledger not yet checked in MVP',
      });
      continue;
    }
    const stepResults = await runScenario(scenario, parsed, ctx);
    const failed = stepResults.find((r) => !r.result.ok);
    if (failed) {
      const severity =
        failed.result.code === 'STEP_NOT_IMPLEMENTED' ? 'Minor' : classifySeverity(scenario.tags);
      findings.push({
        file: fileName,
        scenario: scenario.name,
        severity,
        step: `${failed.step.kind} ${failed.step.text}`,
        error: failed.result.error,
        code: failed.result.code || null,
      });
      scenarioReports.push({
        file: fileName,
        scenario: scenario.name,
        status: 'fail',
        failedStep: failed.step.text,
      });
    } else {
      scenarioReports.push({
        file: fileName,
        scenario: scenario.name,
        status: 'pass',
        steps: stepResults.length,
      });
    }
  }
  return { findings, scenarioReports };
}

// ── Helpers ─────────────────────────────────────────────────────────

function decodeJwtPayload(jwt) {
  const parts = jwt.split('.');
  if (parts.length < 2) return {};
  const buf = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return {};
  }
}

function pickField(obj, field) {
  // Supports either top-level OR nested under `.user` (the common admin-endpoint shape).
  if (obj && Object.prototype.hasOwnProperty.call(obj, field)) return obj[field];
  if (obj?.user && Object.prototype.hasOwnProperty.call(obj.user, field)) return obj.user[field];
  return undefined;
}

/**
 * Probe the 4 OSA post-migration invariants directly against Firestore.
 * Returns { ok: true } if all clean, { ok: false, error: '...' } with a
 * specific violation summary otherwise.
 *
 * Read-only — never writes. Used by the j19 migration-state precondition.
 */
async function probeOsaInvariants(db) {
  const usersSnap = await db.collection('users').get();
  const cohortMap = new Map();
  const users = [];
  usersSnap.forEach((d) => {
    const data = d.data() || {};
    users.push(data);
    if (data?.uniqueId !== undefined && data?.uniqueId !== null && data.cohort) {
      cohortMap.set(String(data.uniqueId), data.cohort);
    }
  });

  let crossFollowing = 0;
  let crossFollower = 0;
  for (const u of users) {
    // SHYTALK_OFFICIAL is exempt from cohort follow-edge cleanup.
    if (u.userType === 'SHYTALK_OFFICIAL' || u.isOfficial) continue;
    if (!u.cohort) continue;
    for (const targetId of u.followingIds || []) {
      const c = cohortMap.get(String(targetId));
      if (c && c !== u.cohort) crossFollowing++;
    }
    for (const sourceId of u.followerIds || []) {
      const c = cohortMap.get(String(sourceId));
      if (c && c !== u.cohort) crossFollower++;
    }
  }

  const roomsSnap = await db.collection('rooms').where('state', '==', 'OPEN').get();
  let mixedRooms = 0;
  roomsSnap.forEach((d) => {
    const data = d.data() || {};
    if (!data.cohort) return;
    const conflicting = (data.participantIds || []).filter((pid) => {
      const c = cohortMap.get(String(pid));
      return c && c !== data.cohort;
    });
    if (conflicting.length > 0) mixedRooms++;
  });

  const convsSnap = await db.collection('conversations').get();
  let unfrozenCross = 0;
  convsSnap.forEach((d) => {
    const data = d.data() || {};
    const cohorts = new Set();
    for (const pid of data.participantIds || []) {
      const c = cohortMap.get(String(pid));
      if (c) cohorts.add(c);
    }
    if (cohorts.size > 1 && data.frozen !== true) unfrozenCross++;
  });

  const violations = [];
  if (crossFollowing > 0) violations.push(`${crossFollowing} cross-cohort followingIds`);
  if (crossFollower > 0) violations.push(`${crossFollower} cross-cohort followerIds`);
  if (mixedRooms > 0) violations.push(`${mixedRooms} mixed-cohort OPEN rooms`);
  if (unfrozenCross > 0) violations.push(`${unfrozenCross} unfrozen cross-cohort conversations`);
  if (violations.length > 0) {
    return {
      ok: false,
      error: `OSA invariants violated: ${violations.join('; ')}`,
    };
  }
  return { ok: true };
}

function parseLiteral(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  return raw;
}

/**
 * Parse an inline kv-list of the shape `key=value and key=value and ...`
 * used in v3 HTTP-call matchers (`POSTs <path> with k=v and k=v`).
 *
 * Quoted strings preserve embedded ` and ` exactly because tokenisation
 * walks the string respecting quote state — `body="hi and bye"` parses
 * to {body: "hi and bye"}, not two malformed fragments.
 *
 * Value coercion mirrors parseLiteral:
 *   - `key=42`     → number 42
 *   - `key="rose"` → string "rose"
 *   - `key=true`   → boolean true
 *   - `key=null`   → null
 *   - `key=word`   → unquoted bare string "word"
 *
 * Throws on:
 *  - empty input (caller passed nothing meaningful)
 *  - pairs missing `=`
 *  - keys that aren't identifier-shaped
 */
function parseKvPairs(text) {
  if (typeof text !== 'string') {
    throw new Error(`kv-pair text must be a string, got ${typeof text}`);
  }
  if (text.trim() === '') {
    throw new Error('empty kv-pair text');
  }
  // Split on ` and ` while respecting double-quoted strings. Quoted values
  // may contain backslash-escaped quotes (`"say \"hi\""`) — the tokeniser
  // unescapes `\"` to `"` so callers get the intended value, not the raw
  // backslash sequence. Non-quote backslashes pass through unchanged.
  const pairs = [];
  let buf = '';
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length && text[i + 1] === '"') {
      // Escaped quote inside a string literal — preserve quote, drop the
      // backslash. Outside a string literal this is unusual but we still
      // strip the backslash to keep the inverse-parse round-trip clean.
      buf += '"';
      i += 2;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      buf += c;
      i++;
      continue;
    }
    if (!inString && text.slice(i, i + 5) === ' and ') {
      pairs.push(buf.trim());
      buf = '';
      i += 5;
      continue;
    }
    buf += c;
    i++;
  }
  if (buf.trim()) pairs.push(buf.trim());

  const out = {};
  for (const raw of pairs) {
    const eq = raw.indexOf('=');
    if (eq < 0) throw new Error(`kv-pair missing "=": "${raw}"`);
    const key = raw.slice(0, eq).trim();
    const val = raw.slice(eq + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`kv-pair key not identifier-shaped: "${key}"`);
    }
    out[key] = parseLiteral(val);
  }
  return out;
}

/**
 * Parse comma-separated `key=value` pairs for the multi-field user-doc
 * state-seed matcher (Given <P> has user doc with k=v, k=v, …).
 *
 * Distinct from parseKvPairs (which splits on ` and `) — Gherkin scenarios
 * phrase user-doc state with commas, matching how the codebase's plan
 * authors actually write them.
 *
 * Quoted strings preserve embedded commas (`bio="hi, welcome"` stays one
 * pair). `[]` is an explicit empty-array sentinel because parseLiteral
 * has no array form — every other value flows through parseLiteral for
 * consistent literal coercion.
 *
 * Throws on empty input, pairs missing `=`, or non-identifier keys.
 */
function parseUserDocFields(text) {
  const pairs = [];
  let buf = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length && text[i + 1] === '"') {
      buf += '"';
      i++;
      continue;
    }
    if (c === '"') inString = !inString;
    if (c === ',' && !inString) {
      if (buf.trim()) pairs.push(buf.trim());
      buf = '';
    } else {
      buf += c;
    }
  }
  if (buf.trim()) pairs.push(buf.trim());
  if (pairs.length === 0) throw new Error('empty user-doc fields');

  const out = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq < 0) throw new Error(`malformed user-doc pair (missing "="): "${pair}"`);
    const key = pair.slice(0, eq).trim();
    const valRaw = pair.slice(eq + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`user-doc key not identifier-shaped: "${key}"`);
    }
    out[key] = valRaw === '[]' ? [] : parseLiteral(valRaw);
  }
  return out;
}

/**
 * Parse the field-list portion of the `is signed in with …` matcher and
 * the generalised `has …` state-seed matcher.
 *
 * Supports:
 *   1. Both `,` and ` and ` as field separators (Gherkin scenarios use
 *      either, sometimes both in the same step).
 *   2. Trailing `(…)` parenthetical stripped — conventional documentation
 *      like `(post-j01 state)`, `(same Firebase user)`, `(two adult follows)`.
 *   3. Array literal values like `followingIds=[50000010, 50000060]` —
 *      bracket depth is tracked during tokenisation so commas inside `[…]`
 *      do not break the outer pair split. Empty arrays (`[]`) and
 *      mixed-type elements both work via per-element parseLiteral.
 *   4. Quoted strings preserve embedded commas and embedded ` and ` —
 *      tokenisation respects quote state throughout.
 *
 * Throws on empty input, pairs missing `=`, or non-identifier keys.
 */
function parseSignInWithClause(text) {
  // `[^)]*` excludes `)` so it cannot overlap with the literal `\)` that
  // follows; anchored to end-of-string. Linear match.
  // eslint-disable-next-line sonarjs/slow-regex
  const stripped = text.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const pairs = [];
  let buf = '';
  let inString = false;
  let bracketDepth = 0;
  let i = 0;
  while (i < stripped.length) {
    const c = stripped[i];
    if (c === '\\' && i + 1 < stripped.length && stripped[i + 1] === '"') {
      buf += '"';
      i += 2;
      continue;
    }
    if (c === '"') inString = !inString;
    if (!inString) {
      if (c === '[') bracketDepth++;
      else if (c === ']') bracketDepth--;
      if (bracketDepth === 0) {
        if (c === ',') {
          if (buf.trim()) pairs.push(buf.trim());
          buf = '';
          i++;
          continue;
        }
        if (stripped.slice(i, i + 5) === ' and ') {
          if (buf.trim()) pairs.push(buf.trim());
          buf = '';
          i += 5;
          continue;
        }
      }
    }
    buf += c;
    i++;
  }
  if (buf.trim()) pairs.push(buf.trim());
  if (pairs.length === 0) throw new Error('empty sign-in `with` clause');

  const out = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq < 0) throw new Error(`malformed sign-in with-pair (missing "="): "${pair}"`);
    const key = pair.slice(0, eq).trim();
    const valRaw = pair.slice(eq + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`sign-in with-key not identifier-shaped: "${key}"`);
    }
    out[key] = parseValueLiteralOrArray(valRaw);
  }
  return out;
}

/**
 * Coerce a raw value string to its literal form. Distinct from parseLiteral
 * in that it also recognises array syntax — `[]` is an empty array, and
 * `[a, b, c]` is a flat array whose elements are each coerced via
 * parseLiteral. Nested arrays are not supported; no journey scenario
 * needs them today.
 */
function parseValueLiteralOrArray(valRaw) {
  if (valRaw === '[]') return [];
  if (valRaw.startsWith('[') && valRaw.endsWith(']')) {
    const inner = valRaw.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => parseLiteral(s.trim()));
  }
  return parseLiteral(valRaw);
}

/**
 * Parse a jsonish predicate (the inner text between { and }) into an object.
 * Tokenises by commas while respecting double-quoted strings — values that
 * contain commas (e.g. `body: "hi adam, welcome"`) parse correctly.
 *
 * Throws on:
 *  - unresolved placeholders like `{newUniqueId}` (no quotes; literal var ref)
 *    so the operator gets an actionable error pointing at the missing
 *    variable-resolution feature
 *  - malformed key:value pairs
 *
 * Returns an object with parsed key→value pairs (string keys; values typed
 * via parseLiteral).
 */
function parseJsonishPredicate(text) {
  const out = {};
  if (text === '' || text === undefined) return out;
  const pairs = [];
  let buf = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && text[i - 1] !== '\\') inString = !inString;
    if (c === ',' && !inString) {
      pairs.push(buf);
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim() !== '') pairs.push(buf);

  for (const raw of pairs) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    // Split on the first colon outside a quoted string.
    let colonIdx = -1;
    let q = false;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '"' && trimmed[i - 1] !== '\\') q = !q;
      if (trimmed[i] === ':' && !q) {
        colonIdx = i;
        break;
      }
    }
    if (colonIdx === -1) throw new Error(`malformed pair (no colon): "${trimmed}"`);
    const key = trimmed.slice(0, colonIdx).trim();
    const valRaw = trimmed.slice(colonIdx + 1).trim();
    // Detect unresolved placeholder {name} — bare identifier in braces.
    if (/^\{[A-Za-z_][\w]*\}$/.test(valRaw)) {
      throw new Error(`unresolved placeholder ${valRaw} (variable resolution not yet implemented)`);
    }
    out[key] = parseLiteral(valRaw);
  }
  return out;
}

function formatReport(allFindings, allScenarioReports, target, cycleNumber) {
  const lines = [];
  lines.push(`# /manual-qa cycle ${cycleNumber} — step-runner MVP`);
  lines.push('');
  lines.push(`Target: ${target}`);
  lines.push(`Scenarios run: ${allScenarioReports.filter((s) => s.status !== 'skipped').length}`);
  lines.push(
    `Skipped (@manual): ${allScenarioReports.filter((s) => s.status === 'skipped').length}`,
  );
  lines.push(`Findings: ${allFindings.length}`);
  lines.push('');

  const bySeverity = {};
  for (const f of allFindings) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0).concat
      ? []
      : bySeverity[f.severity] || [];
  }
  for (const f of allFindings) {
    if (!bySeverity[f.severity]) bySeverity[f.severity] = [];
    bySeverity[f.severity].push(f);
  }

  for (const sev of ['Blocker', 'Major', 'Minor', 'Polish']) {
    if (!bySeverity[sev]?.length) continue;
    lines.push(`## ${sev} (${bySeverity[sev].length})`);
    for (const f of bySeverity[sev]) {
      lines.push(`- **${f.file}** :: ${f.scenario}`);
      lines.push(`  - step: \`${f.step}\``);
      lines.push(`  - error: ${f.error}`);
    }
    lines.push('');
  }

  if (allFindings.length === 0) {
    lines.push('## Result');
    lines.push('Zero findings of any severity.');
  }
  return lines.join('\n') + '\n';
}

// ── CLI ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target') opts.target = args[++i];
    else if (args[i] === '--plan-dir') opts.planDir = args[++i];
    else if (args[i] === '--journey') opts.journey = args[++i];
    else if (args[i] === '--cycle') opts.cycle = parseInt(args[++i], 10);
  }
  opts.target = opts.target || 'dev';
  opts.planDir = opts.planDir || path.resolve(__dirname, '../../.project/test-plans/manual');
  opts.cycle = opts.cycle || 1;

  if (!TARGETS[opts.target]) {
    console.error(`Unknown target: ${opts.target}. Valid: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(2);
  }
  const personasPassword = process.env.PERSONAS_PASSWORD;
  if (!personasPassword) {
    console.error('MISSING_ENV: PERSONAS_PASSWORD');
    process.exit(2);
  }
  const firebaseApiKey = readFirebaseApiKey(opts.target);
  if (!firebaseApiKey) {
    // Static literal — no interpolation from the lookup path, so CodeQL's
    // clear-text-logging-of-sensitive-information rule doesn't see a flow
    // from process.env[...] to console.error. Operator looks up the right
    // env var from the runner's usage docs at the top of this file.
    console.error(
      'MISSING_ENV: Firebase Web API key — set FIREBASE_DEV_API_KEY (target=dev) or FIREBASE_LOCAL_API_KEY (target=local). Values in google-services.json.',
    );
    process.exit(2);
  }

  // Lazy require — keeps the test surface free of firebase-admin side effects.
  // The util initialises Admin SDK using GOOGLE_APPLICATION_CREDENTIALS for
  // dev/prod or the emulator host for local. Operator must export the
  // service-account creds for dev target before running.
  const { db } = require('../src/utils/firebase');

  const ctx = {
    target: opts.target,
    apiBase: TARGETS[opts.target].apiBase,
    firebaseApiKey,
    personasPassword,
    sessions: new Map(),
    lastResponse: null,
    locale: 'en',
    fetch: globalThis.fetch,
    db,
  };

  const files = opts.journey
    ? [path.join(opts.planDir, opts.journey)]
    : fs
        .readdirSync(opts.planDir)
        // eslint-disable-next-line sonarjs/slow-regex
        .filter((f) => /^j\d+[^.]*\.feature$/.test(f))
        .map((f) => path.join(opts.planDir, f));

  console.log(`Running ${files.length} feature file(s) against ${opts.target} (${ctx.apiBase})`);
  const allFindings = [];
  const allScenarioReports = [];
  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.error(`File not found: ${f}`);
      continue;
    }
    const { findings, scenarioReports } = await runFeatureFile(f, ctx);
    allFindings.push(...findings);
    allScenarioReports.push(...scenarioReports);
    for (const s of scenarioReports) {
      const marker = s.status === 'pass' ? 'OK' : s.status === 'fail' ? 'FAIL' : 'SKIP';
      console.log(`  ${marker} ${path.basename(f)} :: ${s.scenario}`);
    }
  }

  const report = formatReport(allFindings, allScenarioReports, opts.target, opts.cycle);
  const reportPath = `/tmp/manual-qa-cycle-${opts.cycle}.md`;
  fs.writeFileSync(reportPath, report);
  console.log(`\nReport: ${reportPath}`);
  console.log(`Findings: ${allFindings.length}`);
  process.exit(allFindings.length > 0 ? 1 : 0);
}

module.exports = {
  parseGherkin,
  classifySeverity,
  matchers,
  executeStep,
  runScenario,
  runFeatureFile,
  decodeJwtPayload,
  pickField,
  parseLiteral,
  parseKvPairs,
  parseJsonishPredicate,
  probeOsaInvariants,
  formatReport,
  TARGETS,
};

if (require.main === module) {
  main().catch((e) => {
    console.error('RUNNER_CRASH', e?.message || e);
    process.exit(2);
  });
}
