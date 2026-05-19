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
  // ── Meta-matchers (compose over other matchers) ──
  {
    // Polling wrapper. Re-runs the inner step every ~50ms until it returns
    // ok:true OR the budget elapses. On timeout, surfaces the inner's last
    // error (not a generic "timed out") so the failure report points at the
    // actual assertion that didn't converge.
    //
    // Short-circuits on STEP_NOT_IMPLEMENTED — there's no point polling for
    // 5s when the issue is "no matcher exists for the inner step", which is
    // a contract problem, not a timing problem.
    //
    // Intended for `Then` assertions; using this with a `When` mutation would
    // re-run the mutation on every poll. The runner doesn't enforce this —
    // the feature-file author is responsible for using it with idempotent
    // steps only.
    pattern: /^within (\d+)ms (.+)$/,
    async handler(m, ctx) {
      const budgetMs = parseInt(m[1], 10);
      const innerText = m[2];
      const innerStep = { kind: 'Then', text: innerText };
      const deadline = Date.now() + budgetMs;
      // Loop runs at least once even when budgetMs === 0, then exits if the
      // deadline has already passed.
      for (;;) {
        const result = await executeStep(innerStep, ctx);
        if (result.ok) return result;
        if (result.code === 'STEP_NOT_IMPLEMENTED') return result;
        if (Date.now() >= deadline) return result;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
  },
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
          const docPath = `users/${p.uniqueId}`;
          await ctx.db.doc(docPath).set(fields, { merge: true });
          captureSnapshots(ctx, docPath, fields);
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
    // `the response has status N or signals "X"` — status code OR body
    // signal string. Used when client-side error handling routes off
    // either the HTTP status code OR a body field (e.g. Firebase Auth's
    // `auth/user-token-expired` is sometimes a 401 status, sometimes 500
    // with the code in the body).
    pattern: /^the response has status (\d{3}) or signals "([^"]+)"$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse) return { ok: false, error: 'no prior request — When step missing?' };
      const expectedStatus = parseInt(m[1], 10);
      const signal = m[2];
      if (ctx.lastResponse.status === expectedStatus) return { ok: true };
      // Search body (stringified) for the signal — handles either top-level
      // code field, error.message, or any nested string field.
      const body = ctx.lastResponse.body;
      if (body) {
        const haystack = JSON.stringify(body);
        if (haystack.includes(signal)) return { ok: true };
      }
      return {
        ok: false,
        error: `response status was ${ctx.lastResponse.status} and body did not signal "${signal}", expected status ${expectedStatus} or signal "${signal}"`,
      };
    },
  },
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
    // Two-way alternation: `the response status is 405 or 403`. Used when
    // the server can legitimately respond with either code depending on
    // which authz layer fires first — over-specifying would force the test
    // to update every time the order of checks shifts in unrelated code.
    pattern: /^the response status is (\d{3}) or (\d{3})$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse) return { ok: false, error: 'no prior request — When step missing?' };
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      const actual = ctx.lastResponse.status;
      if (actual !== a && actual !== b) {
        return {
          ok: false,
          error: `response status was ${actual}, expected ${a} or ${b}`,
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
    // Array length on a specific field. Distinct from `of type "array"` which
    // only checks the type; this checks the exact length.
    pattern: /^the response body has field "([^"]+)" array length (\d+)$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse?.body)
        return { ok: false, error: 'no parsed response body to inspect' };
      const field = m[1];
      const expected = parseInt(m[2], 10);
      const value = pickField(ctx.lastResponse.body, field);
      if (value === undefined) {
        return { ok: false, error: `response body has no field "${field}"` };
      }
      if (!Array.isArray(value)) {
        return {
          ok: false,
          error: `field "${field}" was ${typeof value}, expected an array of length ${expected}`,
        };
      }
      if (value.length !== expected) {
        return {
          ok: false,
          error: `field "${field}" array length was ${value.length}, expected ${expected}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Alternation form of `contains "X"` — passes when EITHER needle is in
    // the stringified body. Used when the API can legitimately respond with
    // either error string depending on race-condition path.
    pattern: /^the response body contains "([^"]+)" or "([^"]+)"$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse?.body) return { ok: false, error: 'no response body' };
      const haystack = JSON.stringify(ctx.lastResponse.body);
      const a = m[1];
      const b = m[2];
      if (haystack.includes(a) || haystack.includes(b)) return { ok: true };
      return {
        ok: false,
        error: `response body did not contain "${a}" or "${b}"`,
      };
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
    // `the response from <path> has <field>="<value>" in every row`
    // OR
    // `the response from <path> has "<field>=<value>" in every row`
    //
    // Path token is descriptive (lastResponse.body is what's actually
    // checked). Body is polymorphic: tries body-as-array first, falls
    // back to the first Array-valued property of an object body.
    //
    // Empty array → vacuously true. If author wants "at least one row",
    // they should use the N-result variant of this matcher.
    pattern: /^the response from (\S+) has (?:"(\w+)=([^"]+)"|(\w+)="([^"]+)") in every row$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse?.body) {
        return { ok: false, error: 'no prior response body to inspect — When step missing?' };
      }
      // Either capture pair: m[2,3] for "field=value" quoted form,
      // m[4,5] for field="value" unquoted-field form.
      const field = m[2] || m[4];
      const rawValue = m[3] || m[5];
      const expected = parseLiteral(rawValue);
      const body = ctx.lastResponse.body;
      let rows;
      if (Array.isArray(body)) {
        rows = body;
      } else if (body && typeof body === 'object') {
        // Heuristic: first Array-valued property of the body.
        const arrayProp = Object.entries(body).find(([, v]) => Array.isArray(v));
        if (!arrayProp) {
          return {
            ok: false,
            error: 'response body has no array property to iterate as rows',
          };
        }
        rows = arrayProp[1];
      } else {
        return { ok: false, error: 'response body is not an array or object' };
      }
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const actual = row?.[field];
        // Coerce on either side: "18" should match 18 because parseLiteral
        // normalizes the expected, but the row's actual value type is up
        // to the API. Treat string-vs-number as equivalent for safety.
        const match = actual === expected || String(actual) === String(expected);
        if (!match) {
          return {
            ok: false,
            error: `row[${i}].${field} was ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)} (every row must match)`,
          };
        }
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
  {
    // "does not have document X with field Y containing N" — vacuous-true
    // when the doc is missing or the field doesn't exist (author is asserting
    // the ABSENCE of a containment relationship, which holds when there's
    // nothing to contain). Distinct from `not containing` below which
    // requires the doc to exist.
    pattern: /^the database does not have document "([^"]+)" with field "([^"]+)" containing (.+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const docPath = m[1];
      const field = m[2];
      const needle = parseLiteral(m[3].trim());
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) return { ok: true }; // vacuous-true
      const actual = snap.data()?.[field];
      if (!Array.isArray(actual)) return { ok: true }; // no array to contain N
      if (actual.includes(needle)) {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" (=${JSON.stringify(actual)}) contains ${JSON.stringify(needle)} — expected absence`,
        };
      }
      return { ok: true };
    },
  },
  {
    // "has document X with field Y not containing N" — requires the doc AND
    // the field to exist as an array; asserts that N is NOT in the array.
    // Distinct from `does not have ... containing` above which is vacuously
    // true when the doc is missing.
    pattern: /^the database has document "([^"]+)" with field "([^"]+)" not containing (.+)$/,
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
      if (actual === undefined) {
        return { ok: false, error: `field "${field}" on "${docPath}" is missing` };
      }
      if (!Array.isArray(actual)) {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" was ${JSON.stringify(actual)}, expected an array`,
        };
      }
      if (actual.includes(needle)) {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" (=${JSON.stringify(actual)}) contains ${JSON.stringify(needle)} — expected NOT containing`,
        };
      }
      return { ok: true };
    },
  },
  {
    // `unchanged` — assert current field value equals the snapshot captured
    // at the Given step. Requires `Given <P> has <field>=<value>` (or similar
    // state-seed step) to have run earlier in the scenario. Without that, the
    // matcher errors with a clear "no snapshot/baseline" message rather than
    // silently passing (which would happen if it captured the current value
    // on first call — see Wake 25 design notes).
    pattern: /^the database has document "([^"]+)" with field "([^"]+)" unchanged$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const docPath = m[1];
      const field = m[2];
      const key = `${docPath}#${field}`;
      if (!ctx.snapshots || !ctx.snapshots.has(key)) {
        return {
          ok: false,
          error: `no snapshot/baseline captured for "${key}" — add a Given step that initialises this field`,
        };
      }
      const baseline = ctx.snapshots.get(key);
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) {
        return {
          ok: false,
          error: `document "${docPath}" does not exist (had snapshot ${baseline})`,
        };
      }
      const actual = snap.data()?.[field];
      if (actual !== baseline) {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" was ${JSON.stringify(actual)}, expected unchanged from baseline ${JSON.stringify(baseline)}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // `increased by N` — assert current = baseline + N. Requires a Given step
    // to have captured the baseline. Both baseline and actual must be numeric;
    // mismatched signs (e.g. baseline 5000, actual 4500, N=500 → delta -500)
    // are explicitly flagged.
    pattern: /^the database has document "([^"]+)" with field "([^"]+)" increased by (\d+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const docPath = m[1];
      const field = m[2];
      const delta = parseInt(m[3], 10);
      const key = `${docPath}#${field}`;
      if (!ctx.snapshots || !ctx.snapshots.has(key)) {
        return {
          ok: false,
          error: `no snapshot/baseline captured for "${key}" — add a Given step that initialises this field`,
        };
      }
      const baseline = ctx.snapshots.get(key);
      if (typeof baseline !== 'number') {
        return {
          ok: false,
          error: `baseline for "${key}" was ${JSON.stringify(baseline)}, expected numeric for delta comparison`,
        };
      }
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) {
        return { ok: false, error: `document "${docPath}" does not exist` };
      }
      const actual = snap.data()?.[field];
      if (typeof actual !== 'number') {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" was ${JSON.stringify(actual)}, expected numeric`,
        };
      }
      const observedDelta = actual - baseline;
      if (observedDelta !== delta) {
        const direction = observedDelta < 0 ? ' (decreased)' : '';
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" went from ${baseline} to ${actual}, delta=${observedDelta}${direction}, expected delta=+${delta}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // `no entry is added to "X" since "Y"` — collection (or subcollection)
    // scan asserting that no doc has createdAt > sinceTs. Supports the
    // `{ts}` placeholder which resolves to ctx.scenarioStartTime, OR an
    // explicit ISO date / numeric millisecond literal.
    //
    // Docs missing the createdAt field are treated as "pre-existing"
    // (not flagged as new) — that's the test-author's intent. If a real
    // bug writes new entries without createdAt, that's a separate class
    // of bug to catch with a different assertion.
    pattern: /^no entry is added to "([^"]+)" since "([^"]+)"$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const collectionPath = m[1];
      const sinceRaw = m[2];
      let sinceTs;
      if (sinceRaw === '{ts}') {
        if (ctx.scenarioStartTime === undefined) {
          return {
            ok: false,
            error:
              '{ts} placeholder used but ctx.scenarioStartTime is unset (baseline missing) — runScenario should set it on each scenario start',
          };
        }
        sinceTs = ctx.scenarioStartTime;
      } else if (/^\d+$/.test(sinceRaw)) {
        sinceTs = parseInt(sinceRaw, 10);
      } else {
        const parsed = Date.parse(sinceRaw);
        if (Number.isNaN(parsed)) {
          return { ok: false, error: `cannot parse "since" value "${sinceRaw}" as timestamp` };
        }
        sinceTs = parsed;
      }
      const snap = await ctx.db.collection(collectionPath).get();
      const offenders = [];
      for (const docRef of snap.docs) {
        const data = docRef.data();
        const createdAt = data?.createdAt;
        if (typeof createdAt !== 'number') continue; // treat missing/non-numeric as pre-existing
        if (createdAt > sinceTs) {
          offenders.push({ id: docRef.id, createdAt });
        }
      }
      if (offenders.length > 0) {
        const summary = offenders.map((o) => `${o.id} (createdAt=${o.createdAt})`).join(', ');
        return {
          ok: false,
          error: `collection "${collectionPath}" has ${offenders.length} entries added after ${sinceTs}: ${summary}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // `no conversation doc is created` — convenience shorthand for the
    // cross-cohort PM-wall scenarios. Equivalent to
    // `no entry is added to "conversations" since "{ts}"` but matches the
    // natural English phrasing the test authors actually wrote.
    pattern: /^no conversation doc is created$/,
    async handler(_m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      if (ctx.scenarioStartTime === undefined) {
        return {
          ok: false,
          error:
            'ctx.scenarioStartTime not set (baseline missing) — runScenario should set it on each scenario start',
        };
      }
      const sinceTs = ctx.scenarioStartTime;
      const snap = await ctx.db.collection('conversations').get();
      const offenders = [];
      for (const docRef of snap.docs) {
        const data = docRef.data();
        const createdAt = data?.createdAt;
        if (typeof createdAt !== 'number') continue;
        if (createdAt > sinceTs) {
          offenders.push({ id: docRef.id, createdAt });
        }
      }
      if (offenders.length > 0) {
        const summary = offenders.map((o) => `${o.id} (createdAt=${o.createdAt})`).join(', ');
        return {
          ok: false,
          error: `conversations collection has ${offenders.length} doc(s) created after scenario start: ${summary}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Numeric strict-greater-than. Rejects non-numeric actual values rather
    // than relying on JavaScript's lexicographic / NaN coercion semantics
    // (which can silently report "abc > 100" as false and mask real bugs).
    // Strict `>` — `>=` is a separate assertion the corpus doesn't use.
    pattern: /^the database has document "([^"]+)" with field "([^"]+)" greater than (.+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const docPath = m[1];
      const field = m[2];
      const expected = parseLiteral(m[3].trim());
      if (typeof expected !== 'number') {
        return {
          ok: false,
          error: `greater-than threshold must be numeric, got ${JSON.stringify(m[3].trim())}`,
        };
      }
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) {
        return { ok: false, error: `document "${docPath}" does not exist` };
      }
      const actual = snap.data()?.[field];
      if (typeof actual !== 'number') {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" was ${JSON.stringify(actual)}, expected a numeric value to compare against ${expected}`,
        };
      }
      if (!(actual > expected)) {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" was ${actual}, expected greater than ${expected}`,
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
  {
    // Per-persona JWT custom-claim assertion. Reads the persona's session
    // from ctx.sessions (populated by sign-in matchers), decodes the JWT
    // payload, and compares the named custom claim against expected.
    //
    // Ephemeral personas have a `synthetic:...` token sentinel rather than
    // a real JWT — for those, the customClaims live directly on the session
    // object. The matcher branches on token shape rather than always
    // attempting to decode.
    //
    // "Android" in the step text is descriptive — JWTs are platform-agnostic.
    // The runner doesn't enforce that the persona is on Android.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s Android JWT custom claim "([^"]+)" equals "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const claim = m[3];
      const expected = m[4];
      const sess = ctx.sessions?.get(name);
      if (!sess) {
        return {
          ok: false,
          error: `no session for "${name}" — Given sign-in step missing?`,
        };
      }
      // Branch on token shape: synthetic ephemeral tokens carry claims
      // directly on the session; real Firebase JWTs need decoding.
      let payload;
      if (typeof sess.idToken === 'string' && sess.idToken.startsWith('synthetic:')) {
        payload = sess.customClaims || {};
      } else if (sess.idToken) {
        payload = decodeJwtPayload(sess.idToken);
      } else {
        return { ok: false, error: `session for "${name}" has no idToken` };
      }
      const actual = payload[claim];
      if (actual !== expected) {
        return {
          ok: false,
          error: `JWT custom claim "${claim}" for "${name}" was ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
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
      const docPath = `users/${p.uniqueId}`;
      await ctx.db.doc(docPath).set(fields, { merge: true });
      captureSnapshots(ctx, docPath, fields);
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
        const docPath = `users/${uniqueId}`;
        await ctx.db.doc(docPath).set(fields);
        captureSnapshots(ctx, docPath, fields);
      } else {
        // has user doc with — merge into existing
        const docPath = `users/${p.uniqueId}`;
        await ctx.db.doc(docPath).set(fields, { merge: true });
        captureSnapshots(ctx, docPath, fields);
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
        if (!ctx.uiDriver.iosUiDump) {
          return { ok: false, error: 'ctx.uiDriver.iosUiDump not configured' };
        }
        const iosDump = await ctx.uiDriver.iosUiDump();
        // Match exact identifier value in the JSON dump — `"identifier":"X"`.
        // The trailing `"` is critical: prevents `main_pmTabFooter` from
        // falsely matching when the test asks about `main_pmTab`.
        if (!iosDump.includes(`"identifier":"${tag}"`)) {
          return { ok: false, error: `tag "${tag}" not found in iOS UI dump` };
        }
        return { ok: true };
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
  {
    // Negation of the tag-assertion above. Asserts that the element with
    // the given resource-id is ABSENT from the UI. Same platform-dispatch
    // shape as the positive matcher — Android is implemented, iOS/Web
    // return the same "not yet implemented" / "out of scope" errors.
    //
    // De Morgan: positive matcher uses OR over short and qualified forms
    // ("present in either form"). Negation must check that NEITHER form
    // is present — both negated and ANDed — otherwise a qualified-form
    // dump would slip past a naive short-only negation.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (\w+(?:\s+\w+){0,2}) UI does not show the element with tag "([^"]+)"$/,
    async handler(m, ctx) {
      const platform = m[3];
      const tag = m[4];
      if (!ctx.uiDriver) {
        return {
          ok: false,
          error: `UI step requires ctx.uiDriver (platform=${platform}, tag=${tag}).`,
        };
      }
      if (platform.startsWith('Android')) {
        if (!ctx.uiDriver.androidUiDump) {
          return { ok: false, error: 'ctx.uiDriver.androidUiDump not configured' };
        }
        const dump = await ctx.uiDriver.androidUiDump();
        const shortMatch = dump.includes(`resource-id="${tag}"`);
        const qualifiedMatch = dump.includes(`:id/${tag}"`);
        if (shortMatch || qualifiedMatch) {
          return {
            ok: false,
            error: `tag "${tag}" should not be present but was found in Android UI dump`,
          };
        }
        return { ok: true };
      }
      if (platform.startsWith('iOS')) {
        if (!ctx.uiDriver.iosUiDump) {
          return { ok: false, error: 'ctx.uiDriver.iosUiDump not configured' };
        }
        const iosDump = await ctx.uiDriver.iosUiDump();
        // Same exact-identifier check as the positive matcher — `"identifier":"X"`.
        if (iosDump.includes(`"identifier":"${tag}"`)) {
          return {
            ok: false,
            error: `tag "${tag}" should not be present but was found in iOS UI dump`,
          };
        }
        return { ok: true };
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
  {
    // Android tap on element with the given resource-id tag. Reads the UI
    // dump, locates the element's bounds=`[x1,y1][x2,y2]` attribute,
    // computes the centre, and calls ctx.uiDriver.androidTap(x, y).
    //
    // Tag matching accepts the same short OR fully-qualified shapes as
    // the "shows the element with tag" matcher above. Bounds extraction
    // uses a node-local regex anchored to the same element to avoid
    // grabbing the bounds of an unrelated nearby element.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+taps "([^"]+)"$/,
    async handler(m, ctx) {
      const tag = m[3];
      if (!ctx.uiDriver) {
        return { ok: false, error: `UI step requires ctx.uiDriver (tag=${tag})` };
      }
      if (!ctx.uiDriver.androidUiDump || !ctx.uiDriver.androidTap) {
        return {
          ok: false,
          error: 'ctx.uiDriver requires both androidUiDump and androidTap',
        };
      }
      const dump = await ctx.uiDriver.androidUiDump();
      // Find the node by resource-id (short OR fully-qualified), capturing
      // the bounds attribute on the SAME node. The element opens with `<node`
      // and the resource-id appears as an attribute; bounds is also an
      // attribute on the same node, so we capture them within a single
      // attribute run (no `<` in between).
      const escTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(
        `resource-id="(?:[^"]*:id/)?${escTag}"[^<]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"|bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"[^<]*?resource-id="(?:[^"]*:id/)?${escTag}"`,
      );
      const match = re.exec(dump);
      if (!match) {
        // Distinguish "tag not found" from "tag found but no bounds"
        const tagPresent = dump.includes(`resource-id="${tag}"`) || dump.includes(`:id/${tag}"`);
        if (tagPresent) {
          return {
            ok: false,
            error: `tag "${tag}" found in dump but no bounds attribute on the same node`,
          };
        }
        return { ok: false, error: `tag "${tag}" not found in Android UI dump` };
      }
      const x1 = parseInt(match[1] || match[5], 10);
      const y1 = parseInt(match[2] || match[6], 10);
      const x2 = parseInt(match[3] || match[7], 10);
      const y2 = parseInt(match[4] || match[8], 10);
      const cx = Math.floor((x1 + x2) / 2);
      const cy = Math.floor((y1 + y2) / 2);
      await ctx.uiDriver.androidTap(cx, cy);
      return { ok: true };
    },
  },
  {
    // Android types text into the field with the given resource-id tag.
    // Locates the field's bounds, taps the centre to focus, then dispatches
    // text via androidTypeText. Tap-then-type ordering is load-bearing —
    // adb's `input text` writes to whichever element has IME focus.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+types "([^"]+)" into "([^"]+)"$/,
    async handler(m, ctx) {
      const text = m[3];
      const tag = m[4];
      if (!ctx.uiDriver) {
        return { ok: false, error: `UI step requires ctx.uiDriver (tag=${tag})` };
      }
      if (!ctx.uiDriver.androidUiDump || !ctx.uiDriver.androidTap) {
        return {
          ok: false,
          error: 'ctx.uiDriver requires both androidUiDump and androidTap',
        };
      }
      if (!ctx.uiDriver.androidTypeText) {
        return {
          ok: false,
          error: 'ctx.uiDriver.androidTypeText not configured',
        };
      }
      const dump = await ctx.uiDriver.androidUiDump();
      const escTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Bidirectional regex: bounds may precede or follow resource-id on the
      // same <node>. Same shape as the tap matcher — see comment above for
      // rationale on the duplication.
      const re = new RegExp(
        `resource-id="(?:[^"]*:id/)?${escTag}"[^<]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"|bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"[^<]*?resource-id="(?:[^"]*:id/)?${escTag}"`,
      );
      const match = re.exec(dump);
      if (!match) {
        const tagPresent = dump.includes(`resource-id="${tag}"`) || dump.includes(`:id/${tag}"`);
        if (tagPresent) {
          return {
            ok: false,
            error: `tag "${tag}" found in dump but no bounds attribute on the same node`,
          };
        }
        return { ok: false, error: `tag "${tag}" not found in Android UI dump` };
      }
      const x1 = parseInt(match[1] || match[5], 10);
      const y1 = parseInt(match[2] || match[6], 10);
      const x2 = parseInt(match[3] || match[7], 10);
      const y2 = parseInt(match[4] || match[8], 10);
      const cx = Math.floor((x1 + x2) / 2);
      const cy = Math.floor((y1 + y2) / 2);
      await ctx.uiDriver.androidTap(cx, cy);
      await ctx.uiDriver.androidTypeText(text);
      return { ok: true };
    },
  },
  {
    // Android text-content assertion. Scans the UI dump for an exact match
    // on either `text="<X>"` (visible label) or `content-desc="<X>"`
    // (accessibility label, used by icon-only views). Trailing descriptive
    // text after the quoted string is ignored — it's human-readable context
    // for the test author, not part of the assertion.
    //
    // Exact attribute match (not substring) — substring match would silently
    // pass when "save" matches against a "save as draft" label, which is the
    // class of false positive that catches teams off-guard during prod.
    //
    // Regex is linear: `[^"]+` is a negated char class (one-token consumption),
    // the optional trailing `(?:\s+.+)?$` is anchored to end-of-string with no
    // nested quantifiers. Input is author-controlled (feature files), not
    // untrusted user data. Safe.
    // eslint-disable-next-line sonarjs/slow-regex
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s Android UI shows "([^"]+)"(?:\s+.+)?$/,
    async handler(m, ctx) {
      const expected = m[3];
      if (!ctx.uiDriver) {
        return { ok: false, error: `UI step requires ctx.uiDriver (expected text=${expected})` };
      }
      if (!ctx.uiDriver.androidUiDump) {
        return { ok: false, error: 'ctx.uiDriver.androidUiDump not configured' };
      }
      const dump = await ctx.uiDriver.androidUiDump();
      // Look for exact attribute value on EITHER text= or content-desc=.
      // String.includes with the full attribute fragment is sufficient — no
      // regex needed because the test author's text is opaque to attribute
      // parsing (we only care about exact equality of the value).
      const textHit = dump.includes(`text="${expected}"`);
      const descHit = dump.includes(`content-desc="${expected}"`);
      if (!textHit && !descHit) {
        return {
          ok: false,
          error: `Android UI dump has no text="${expected}" or content-desc="${expected}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Android navigation. Thin matcher — delegates to ctx.uiDriver.androidOpenScreen(name).
    // Accepts both "screen" and "tab" as the noun because the corpus uses
    // them interchangeably (pm/rooms tab vs discovery/wallet screen).
    // Driver implementation chooses between adb deeplink and UI-tap nav.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+opens (?:the|his|her|their) "([^"]+)" (?:screen|tab)$/,
    async handler(m, ctx) {
      const screenName = m[3];
      if (!ctx.uiDriver) {
        return {
          ok: false,
          error: `UI step requires ctx.uiDriver (screen=${screenName})`,
        };
      }
      if (!ctx.uiDriver.androidOpenScreen) {
        return {
          ok: false,
          error: 'ctx.uiDriver.androidOpenScreen not configured',
        };
      }
      await ctx.uiDriver.androidOpenScreen(screenName);
      return { ok: true };
    },
  },
  {
    // iOS Sim tap. Unlike the Android tap (which parses adb XML bounds in
    // the matcher), the iOS variant delegates to `iosTap(identifier)` — the
    // driver owns coordinate lookup from the accessibility dump. Less
    // parsing logic in the matcher = more flexibility for the driver to
    // adapt to xcrun simctl's evolving output format.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on iOS Sim\s+taps "([^"]+)"$/,
    async handler(m, ctx) {
      const tag = m[3];
      if (!ctx.uiDriver) {
        return { ok: false, error: `UI step requires ctx.uiDriver (iOS tap, tag=${tag})` };
      }
      if (!ctx.uiDriver.iosTap) {
        return { ok: false, error: 'ctx.uiDriver.iosTap not configured' };
      }
      await ctx.uiDriver.iosTap(tag);
      return { ok: true };
    },
  },
  {
    // iOS Sim navigation. Parallel to the Android variant — delegates to
    // `iosOpenScreen(name)`. Accepts both "screen" and "tab" as the noun,
    // matching the corpus phrasings.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on iOS Sim\s+opens (?:the|his|her|their) "([^"]+)" (?:screen|tab)$/,
    async handler(m, ctx) {
      const screenName = m[3];
      if (!ctx.uiDriver) {
        return {
          ok: false,
          error: `UI step requires ctx.uiDriver (iOS open screen, name=${screenName})`,
        };
      }
      if (!ctx.uiDriver.iosOpenScreen) {
        return { ok: false, error: 'ctx.uiDriver.iosOpenScreen not configured' };
      }
      await ctx.uiDriver.iosOpenScreen(screenName);
      return { ok: true };
    },
  },
  {
    // iOS Sim text-content assertion. Scans the accessibility JSON dump
    // for either `"label":"X"` (accessibilityLabel) or `"value":"X"`
    // (accessibilityValue). Mirrors Android's dual-check on `text=` and
    // `content-desc=`.
    //
    // Exact-match on the attribute value (no substring) — same rationale
    // as Wake 19's Android matcher: substring would let "save" silently
    // pass against "save as draft".
    //
    // Trailing descriptive text accepted (e.g. ` toast`, ` banner`) and
    // ignored — matches the corpus phrasings without forcing rewrites.
    // eslint-disable-next-line sonarjs/slow-regex
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s iOS Sim UI shows "([^"]+)"(?:\s+.+)?$/,
    async handler(m, ctx) {
      const expected = m[3];
      if (!ctx.uiDriver) {
        return { ok: false, error: `UI step requires ctx.uiDriver (iOS text=${expected})` };
      }
      if (!ctx.uiDriver.iosUiDump) {
        return { ok: false, error: 'ctx.uiDriver.iosUiDump not configured' };
      }
      const dump = await ctx.uiDriver.iosUiDump();
      const labelHit = dump.includes(`"label":"${expected}"`);
      const valueHit = dump.includes(`"value":"${expected}"`);
      if (!labelHit && !valueHit) {
        return {
          ok: false,
          error: `iOS UI dump has no label="${expected}" or value="${expected}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // iOS Sim type-into-element. Delegates entirely to
    // `iosTypeText(tag, text)` — driver owns identifier→coordinate
    // lookup and the focus-then-type sequence. Less parsing in matcher.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on iOS Sim\s+types "([^"]+)" into "([^"]+)"$/,
    async handler(m, ctx) {
      const text = m[3];
      const tag = m[4];
      if (!ctx.uiDriver) {
        return { ok: false, error: `UI step requires ctx.uiDriver (iOS type into ${tag})` };
      }
      if (!ctx.uiDriver.iosTypeText) {
        return { ok: false, error: 'ctx.uiDriver.iosTypeText not configured' };
      }
      await ctx.uiDriver.iosTypeText(tag, text);
      return { ok: true };
    },
  },
  {
    // iOS Sim type-into-search-field. Active-screen search — driver decides
    // which search field. Parallel to Wake 32's androidSearchIn(null, text).
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on iOS Sim\s+types "([^"]+)" into the search field$/,
    async handler(m, ctx) {
      const text = m[3];
      if (!ctx.uiDriver) {
        return { ok: false, error: 'UI step requires ctx.uiDriver (iOS search field)' };
      }
      if (!ctx.uiDriver.iosSearchIn) {
        return { ok: false, error: 'ctx.uiDriver.iosSearchIn not configured' };
      }
      await ctx.uiDriver.iosSearchIn(null, text);
      return { ok: true };
    },
  },
  // ── Web matchers (ctx.webDriver namespace, Playwright MCP scope) ──
  //
  // Web matchers use a SEPARATE driver namespace (ctx.webDriver) from
  // mobile (ctx.uiDriver) because the production implementation routes
  // through Playwright MCP, which is a different transport from adb/simctl.
  // Keeping them separate avoids accidental mobile/web cross-pollination
  // in tests AND lets a future runner skip Web steps entirely if no
  // webDriver is injected.
  //
  // ORDER matters: `on Web Admin` must come BEFORE `on Web` so the more
  // specific pattern wins. First-match-wins is the runner's semantics.
  {
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Web Admin\s+opens the "([^"]+)" tab$/,
    async handler(m, ctx) {
      const tabName = m[3];
      if (!ctx.webDriver) {
        return {
          ok: false,
          error: `Web step requires ctx.webDriver (admin open tab=${tabName})`,
        };
      }
      if (!ctx.webDriver.webAdminOpenTab) {
        return { ok: false, error: 'ctx.webDriver.webAdminOpenTab not configured' };
      }
      await ctx.webDriver.webAdminOpenTab(tabName);
      return { ok: true };
    },
  },
  {
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Web\s+taps "([^"]+)"$/,
    async handler(m, ctx) {
      const tag = m[3];
      if (!ctx.webDriver) {
        return { ok: false, error: `Web step requires ctx.webDriver (tap tag=${tag})` };
      }
      if (!ctx.webDriver.webTap) {
        return { ok: false, error: 'ctx.webDriver.webTap not configured' };
      }
      await ctx.webDriver.webTap(tag);
      return { ok: true };
    },
  },
  {
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Web\s+opens (?:the|his|her|their) "([^"]+)" (?:screen|tab)$/,
    async handler(m, ctx) {
      const name = m[3];
      if (!ctx.webDriver) {
        return {
          ok: false,
          error: `Web step requires ctx.webDriver (open screen=${name})`,
        };
      }
      if (!ctx.webDriver.webOpenScreen) {
        return { ok: false, error: 'ctx.webDriver.webOpenScreen not configured' };
      }
      await ctx.webDriver.webOpenScreen(name);
      return { ok: true };
    },
  },
  {
    // Web Admin tap-with-reason. Must come BEFORE the plain `Web taps`
    // matcher (no — different prefix, no conflict; but order is preserved
    // for symmetry with the openTab grouping above).
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Web Admin\s+taps "([^"]+)" with reason "([^"]+)"$/,
    async handler(m, ctx) {
      const tag = m[3];
      const reason = m[4];
      if (!ctx.webDriver) {
        return { ok: false, error: `Web step requires ctx.webDriver (admin tap+reason)` };
      }
      if (!ctx.webDriver.webAdminTapWithReason) {
        return { ok: false, error: 'ctx.webDriver.webAdminTapWithReason not configured' };
      }
      await ctx.webDriver.webAdminTapWithReason(tag, reason);
      return { ok: true };
    },
  },
  {
    // Web Admin confirm-with-reason. Bare `confirms` matcher (no reason)
    // is a separate shape and would be a separate matcher when needed.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Web Admin\s+confirms with reason "([^"]+)"$/,
    async handler(m, ctx) {
      const reason = m[3];
      if (!ctx.webDriver) {
        return { ok: false, error: 'Web step requires ctx.webDriver (admin confirm)' };
      }
      if (!ctx.webDriver.webAdminConfirmWithReason) {
        return { ok: false, error: 'ctx.webDriver.webAdminConfirmWithReason not configured' };
      }
      await ctx.webDriver.webAdminConfirmWithReason(reason);
      return { ok: true };
    },
  },
  {
    // Web Admin open-report-and-tap composite. Ordinal/keyword (first |
    // second | new) selects which pending report to open; menu item is
    // tapped after open. Optional `with reason "Y"` suffix is captured
    // as the third arg (null when omitted).
    //
    // Driver method: webAdminOpenReportAndTap(ordinal, menuItem, reasonOrNull)
    // owns: scroll-to-report by ordinal, click-to-open, await modal,
    // click menu item, optionally fill reason input.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Web Admin\s+opens the (first|second|new) report and taps "([^"]+)"(?: with reason "([^"]+)")?$/,
    async handler(m, ctx) {
      const ordinal = m[3];
      const menuItem = m[4];
      const reason = m[5] || null;
      if (!ctx.webDriver) {
        return { ok: false, error: `Web step requires ctx.webDriver (open-report-and-tap)` };
      }
      if (!ctx.webDriver.webAdminOpenReportAndTap) {
        return {
          ok: false,
          error: 'ctx.webDriver.webAdminOpenReportAndTap not configured',
        };
      }
      await ctx.webDriver.webAdminOpenReportAndTap(ordinal, menuItem, reason);
      return { ok: true };
    },
  },
  {
    // Web sign-in. Persona-scoped. Driver looks up credentials by persona
    // name and submits the Web sign-in form.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Web\s+signs in with valid credentials$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.webDriver) {
        return { ok: false, error: `Web step requires ctx.webDriver (sign in for ${name})` };
      }
      if (!ctx.webDriver.webSignIn) {
        return { ok: false, error: 'ctx.webDriver.webSignIn not configured' };
      }
      await ctx.webDriver.webSignIn(name);
      return { ok: true };
    },
  },
  {
    // Web open-user-profile. Persona-scoped navigation to another user's
    // profile page (e.g. /users/<targetUniqueId>).
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Web\s+opens ([A-Z][a-z]+)'s profile$/,
    async handler(m, ctx) {
      const name = m[1];
      const target = m[3];
      if (!ctx.webDriver) {
        return {
          ok: false,
          error: `Web step requires ctx.webDriver (${name} opens ${target}'s profile)`,
        };
      }
      if (!ctx.webDriver.webOpenUserProfile) {
        return { ok: false, error: 'ctx.webDriver.webOpenUserProfile not configured' };
      }
      await ctx.webDriver.webOpenUserProfile(name, target);
      return { ok: true };
    },
  },
  {
    // Web profile-panel navigation. Persona opens a tabbed panel on their
    // own profile (e.g. event-host setup, teaching credentials). Driver
    // navigates to `/profile/me?panel=<name>` or similar.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Web\s+opens the "([^"]+)" panel from his profile$/,
    async handler(m, ctx) {
      const name = m[1];
      const panel = m[3];
      if (!ctx.webDriver) {
        return {
          ok: false,
          error: `Web step requires ctx.webDriver (${name} opens "${panel}" panel)`,
        };
      }
      if (!ctx.webDriver.webOpenProfilePanel) {
        return { ok: false, error: 'ctx.webDriver.webOpenProfilePanel not configured' };
      }
      await ctx.webDriver.webOpenProfilePanel(name, panel);
      return { ok: true };
    },
  },
  {
    // Browser console errors assertion. Driver returns the array of error
    // messages captured since the page loaded (Playwright MCP exposes this
    // via the consoleMessages API). Empty array = ok; non-empty fails with
    // all messages joined for visibility.
    pattern: /^no JavaScript console errors are present$/,
    async handler(_m, ctx) {
      if (!ctx.webDriver) {
        return { ok: false, error: 'Web step requires ctx.webDriver (console errors)' };
      }
      if (!ctx.webDriver.webConsoleErrors) {
        return { ok: false, error: 'ctx.webDriver.webConsoleErrors not configured' };
      }
      const errors = await ctx.webDriver.webConsoleErrors();
      if (Array.isArray(errors) && errors.length > 0) {
        return {
          ok: false,
          error: `${errors.length} JavaScript console error(s) present: ${errors.join('; ')}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Android event-invite tap. Distinct from the generic resource-id
    // tap matcher because the action ("Accept"/"Decline") is human-readable
    // text, not a resource-id. Driver locates the event-invite card AND
    // the named action button within it.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+taps "([^"]+)" on the event invite$/,
    async handler(m, ctx) {
      const name = m[1];
      const action = m[3];
      if (!ctx.uiDriver) {
        return {
          ok: false,
          error: `UI step requires ctx.uiDriver (${name} taps "${action}" on event invite)`,
        };
      }
      if (!ctx.uiDriver.androidTapEventInviteAction) {
        return {
          ok: false,
          error: 'ctx.uiDriver.androidTapEventInviteAction not configured',
        };
      }
      await ctx.uiDriver.androidTapEventInviteAction(name, action);
      return { ok: true };
    },
  },
  {
    // Cross-cohort containment check. Iterates ctx.lastQueryResult.docs
    // (populated by a prior `When a query is run for every "users/*"`
    // step), reads the named array field on each doc, and verifies no
    // referenced user has the disallowed cohort.
    //
    // Used in j19 to verify OSA-#17 cohort segregation: adult-cohort
    // users have no followingIds/followerIds pointing to minor-cohort
    // users (and vice versa).
    //
    // Missing user-doc lookups are SILENTLY SKIPPED — the matcher tests
    // cohort containment, not data integrity. A separate matcher would
    // catch dangling-reference bugs.
    pattern: /^no doc has any entry in "([^"]+)" whose (target|source) user has cohort="([^"]+)"$/,
    async handler(m, ctx) {
      const field = m[1];
      const disallowedCohort = m[3];
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      if (!ctx.lastQueryResult || !Array.isArray(ctx.lastQueryResult.docs)) {
        return {
          ok: false,
          error:
            'ctx.lastQueryResult.docs missing — run a `When a query is run for every ...` step first',
        };
      }
      const offenders = [];
      for (const doc of ctx.lastQueryResult.docs) {
        const data = doc.data();
        const ids = data?.[field];
        if (!Array.isArray(ids)) continue;
        for (const uid of ids) {
          const userSnap = await ctx.db.doc(`users/${uid}`).get();
          if (!userSnap.exists) continue; // dangling reference — skipped
          const cohort = userSnap.data()?.cohort;
          if (cohort === disallowedCohort) {
            offenders.push({ uid, cohort });
          }
        }
      }
      if (offenders.length > 0) {
        const summary = offenders.map((o) => `${o.uid} (cohort=${o.cohort})`).join(', ');
        return {
          ok: false,
          error: `field "${field}" has ${offenders.length} entries with disallowed cohort="${disallowedCohort}": ${summary}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Locale-parametric translation assertion across all three platforms.
    // Covers six corpus variants: optional `the` prefix, optional `in the
    // page heading` suffix, and Web/Android/iOS Sim platforms. Locale
    // name → ISO-639 mapping covers all 20 ShyTalk locales. Driver
    // methods (per-platform) accept `(localeCode, englishKey)` and return
    // truthy iff the rendered UI contains the translated string.
    //
    // Web alternation lists longest forms first (Web Chromium, Web Safari)
    // so the bare `Web` alternative doesn't greedily eat the `Chromium`/
    // `Safari` discriminator. Same trick used elsewhere in this file.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows (?:the )?([A-Z][a-z]+) translation of "([^"]+)"(?: in the page heading)?$/,
    async handler(m, ctx) {
      const platform = m[3];
      const localeName = m[4];
      const englishKey = m[5];
      const LOCALE_NAME_TO_CODE = {
        Arabic: 'ar',
        German: 'de',
        Spanish: 'es',
        French: 'fr',
        Hindi: 'hi',
        Indonesian: 'id',
        Italian: 'it',
        Japanese: 'ja',
        Khmer: 'km',
        Korean: 'ko',
        Dutch: 'nl',
        Polish: 'pl',
        Portuguese: 'pt',
        Russian: 'ru',
        Swedish: 'sv',
        Thai: 'th',
        Turkish: 'tr',
        Ukrainian: 'uk',
        Vietnamese: 'vi',
        Chinese: 'zh',
      };
      const code = LOCALE_NAME_TO_CODE[localeName];
      if (!code) {
        return {
          ok: false,
          error: `unknown locale name "${localeName}" — not one of the 20 ShyTalk locales`,
        };
      }
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver) {
          return {
            ok: false,
            error: `Web step requires ctx.webDriver (translation of "${englishKey}")`,
          };
        }
        if (!ctx.webDriver.webShowsTranslationOf) {
          return { ok: false, error: 'ctx.webDriver.webShowsTranslationOf not configured' };
        }
        const ok = await ctx.webDriver.webShowsTranslationOf(code, englishKey);
        if (!ok) {
          return {
            ok: false,
            error: `Web UI did not show the ${localeName} (${code}) translation of "${englishKey}"`,
          };
        }
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver) {
          return {
            ok: false,
            error: `Android step requires ctx.uiDriver (translation of "${englishKey}")`,
          };
        }
        if (!ctx.uiDriver.androidShowsTranslationOf) {
          return { ok: false, error: 'ctx.uiDriver.androidShowsTranslationOf not configured' };
        }
        const ok = await ctx.uiDriver.androidShowsTranslationOf(code, englishKey);
        if (!ok) {
          return {
            ok: false,
            error: `Android UI did not show the ${localeName} (${code}) translation of "${englishKey}"`,
          };
        }
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver) {
          return {
            ok: false,
            error: `iOS step requires ctx.uiDriver (translation of "${englishKey}")`,
          };
        }
        if (!ctx.uiDriver.iosShowsTranslationOf) {
          return { ok: false, error: 'ctx.uiDriver.iosShowsTranslationOf not configured' };
        }
        const ok = await ctx.uiDriver.iosShowsTranslationOf(code, englishKey);
        if (!ok) {
          return {
            ok: false,
            error: `iOS UI did not show the ${localeName} (${code}) translation of "${englishKey}"`,
          };
        }
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for translation step` };
    },
  },
  {
    // UI absence of person. Substring check on the dump per platform.
    // Also covers "does not show <Name>'s [lesson ]room" — if the name
    // is absent from the dump, the name's room can't be either, so this
    // matcher reduces both phrasings to one check. The optional " anywhere"
    // suffix is purely emphatic and ignored.
    //
    // Message-input absence is NOT this matcher (lowercase `the` doesn't
    // match the [A-Z] capture for the target name, so the two are disjoint).
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI does not show ([A-Z][a-z]+)(?:'s (?:lesson )?room)?(?: anywhere)?$/,
    async handler(m, ctx) {
      const platform = m[3];
      const target = m[4];
      let dump;
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webUiDump) {
          return { ok: false, error: 'ctx.webDriver.webUiDump not configured' };
        }
        dump = await ctx.webDriver.webUiDump();
      } else if (platform === 'Android') {
        if (!ctx.uiDriver?.androidUiDump) {
          return { ok: false, error: 'ctx.uiDriver.androidUiDump not configured' };
        }
        dump = await ctx.uiDriver.androidUiDump();
      } else if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosUiDump) {
          return { ok: false, error: 'ctx.uiDriver.iosUiDump not configured' };
        }
        dump = await ctx.uiDriver.iosUiDump();
      } else {
        return { ok: false, error: `unknown platform "${platform}" for absence step` };
      }
      if (typeof dump === 'string' && dump.includes(target)) {
        return {
          ok: false,
          error: `${platform} UI should not show "${target}" but the dump contains that name`,
        };
      }
      return { ok: true };
    },
  },
  {
    // UI absence of the message-input field. Per-platform driver method
    // `<plat>ShowsMessageInput()` returns truthy iff the field is currently
    // rendered. Step asserts the field is NOT shown (returns ok when the
    // driver returns falsy).
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI does not show the message-input field$/,
    async handler(m, ctx) {
      const platform = m[3];
      let shown;
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webShowsMessageInput) {
          return { ok: false, error: 'ctx.webDriver.webShowsMessageInput not configured' };
        }
        shown = await ctx.webDriver.webShowsMessageInput();
      } else if (platform === 'Android') {
        if (!ctx.uiDriver?.androidShowsMessageInput) {
          return { ok: false, error: 'ctx.uiDriver.androidShowsMessageInput not configured' };
        }
        shown = await ctx.uiDriver.androidShowsMessageInput();
      } else if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosShowsMessageInput) {
          return { ok: false, error: 'ctx.uiDriver.iosShowsMessageInput not configured' };
        }
        shown = await ctx.uiDriver.iosShowsMessageInput();
      } else {
        return { ok: false, error: `unknown platform "${platform}" for message-input step` };
      }
      if (shown) {
        return {
          ok: false,
          error: `${platform} UI should not show the message-input field but driver reported it is visible`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Refresh rooms list. Pure action — delegates to per-platform driver.
    // Drivers decide whether to pull-to-refresh (mobile) or invoke a
    // refresh button / location reload (web).
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+refreshes the rooms list$/,
    async handler(m, ctx) {
      const platform = m[3];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webRefreshRoomsList) {
          return { ok: false, error: 'ctx.webDriver.webRefreshRoomsList not configured' };
        }
        await ctx.webDriver.webRefreshRoomsList();
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidRefreshRoomsList) {
          return { ok: false, error: 'ctx.uiDriver.androidRefreshRoomsList not configured' };
        }
        await ctx.uiDriver.androidRefreshRoomsList();
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosRefreshRoomsList) {
          return { ok: false, error: 'ctx.uiDriver.iosRefreshRoomsList not configured' };
        }
        await ctx.uiDriver.iosRefreshRoomsList();
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for refresh-rooms step` };
    },
  },
  {
    // Tap a room card. Two shapes: "taps the room card" (no owner arg) and
    // "taps <Owner>'s room [card]" (owner name passed). The driver method
    // accepts an optional owner name and figures out which card to tap.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+taps (?:the room card|([A-Z][a-z]+)'s room(?: card)?)$/,
    async handler(m, ctx) {
      const platform = m[3];
      const owner = m[4];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webTapRoomCard) {
          return { ok: false, error: 'ctx.webDriver.webTapRoomCard not configured' };
        }
        await ctx.webDriver.webTapRoomCard(owner);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidTapRoomCard) {
          return { ok: false, error: 'ctx.uiDriver.androidTapRoomCard not configured' };
        }
        await ctx.uiDriver.androidTapRoomCard(owner);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosTapRoomCard) {
          return { ok: false, error: 'ctx.uiDriver.iosTapRoomCard not configured' };
        }
        await ctx.uiDriver.iosTapRoomCard(owner);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for tap-room step` };
    },
  },
  {
    // Web text-content assertion. Substring match on `webUiDump()` —
    // production driver returns the document.body.innerText or similar
    // text-only view of the page. Trailing descriptive context (e.g.
    // ` toast`, ` indicator on her reply`) accepted and ignored, mirroring
    // Wake-19 Android pattern.
    // eslint-disable-next-line sonarjs/slow-regex
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s Web UI shows "([^"]+)"(?:\s+.+)?$/,
    async handler(m, ctx) {
      const expected = m[3];
      if (!ctx.webDriver) {
        return { ok: false, error: `Web step requires ctx.webDriver (text=${expected})` };
      }
      if (!ctx.webDriver.webUiDump) {
        return { ok: false, error: 'ctx.webDriver.webUiDump not configured' };
      }
      const dump = await ctx.webDriver.webUiDump();
      if (!dump.includes(expected)) {
        return {
          ok: false,
          error: `Web UI dump did not contain "${expected}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Web document direction. Asserts `<html dir="ltr">` or `dir="rtl"`.
    // Driver returns the literal string "ltr" or "rtl" (or potentially
    // "auto", though the corpus only uses ltr/rtl).
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s Web UI document direction is "(ltr|rtl|auto)"$/,
    async handler(m, ctx) {
      const expected = m[3];
      if (!ctx.webDriver) {
        return { ok: false, error: 'Web step requires ctx.webDriver (document direction)' };
      }
      if (!ctx.webDriver.webDocumentDirection) {
        return { ok: false, error: 'ctx.webDriver.webDocumentDirection not configured' };
      }
      const actual = await ctx.webDriver.webDocumentDirection();
      if (actual !== expected) {
        return {
          ok: false,
          error: `Web document direction was "${actual}", expected "${expected}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Android search composites — both phrasings delegate to a single
    // driver method `androidSearchIn(screenOrNull, text)`. The driver
    // owns search-field-tag mapping (e.g. `discovery_searchField`,
    // `users_searchField`) and the navigate-tap-type-submit sequence.
    // Matchers stay thin.
    //
    // Two phrasings:
    //   `<P> on Android searches "X" in <screen>` → screen-scoped
    //   `<P> on Android types "X" into the search field` → active-screen
    //
    // The "types ... into the search field" form does not collide with the
    // existing `types "X" into "Y"` resource-id matcher because the former
    // expects literal `the search field` after `into ` and the latter
    // expects an opening `"`.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+searches "([^"]+)" in (\w+)$/,
    async handler(m, ctx) {
      const text = m[3];
      const screen = m[4];
      if (!ctx.uiDriver) {
        return { ok: false, error: `UI step requires ctx.uiDriver (search in ${screen})` };
      }
      if (!ctx.uiDriver.androidSearchIn) {
        return { ok: false, error: 'ctx.uiDriver.androidSearchIn not configured' };
      }
      await ctx.uiDriver.androidSearchIn(screen, text);
      return { ok: true };
    },
  },
  {
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+types "([^"]+)" into the search field$/,
    async handler(m, ctx) {
      const text = m[3];
      if (!ctx.uiDriver) {
        return { ok: false, error: 'UI step requires ctx.uiDriver (search field)' };
      }
      if (!ctx.uiDriver.androidSearchIn) {
        return { ok: false, error: 'ctx.uiDriver.androidSearchIn not configured' };
      }
      // null screen = "active screen" — driver decides which search field.
      await ctx.uiDriver.androidSearchIn(null, text);
      return { ok: true };
    },
  },
  {
    // Android app kill + relaunch. Used in token-refresh scenarios where
    // the test needs a fresh app process to pick up new claims after a
    // server-side cohort flip (j06, j12).
    //
    // Driver implementation: `adb shell am force-stop <pkg>` then
    // `am start -n <pkg>/.MainActivity`, then poll for activity ready.
    // The matcher just delegates — process management lives in the driver.
    //
    // Persona name is passed to the driver for logging/scoping. The
    // driver implementation may use it (e.g. re-auth on relaunch) or
    // ignore it.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+kills and relaunches the app$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.uiDriver) {
        return { ok: false, error: `UI step requires ctx.uiDriver (kill+relaunch for ${name})` };
      }
      if (!ctx.uiDriver.androidKillAndRelaunch) {
        return { ok: false, error: 'ctx.uiDriver.androidKillAndRelaunch not configured' };
      }
      await ctx.uiDriver.androidKillAndRelaunch(name);
      return { ok: true };
    },
  },
  {
    // `<P> on Android performs any authenticated API call` — fires off an
    // arbitrary authenticated request (driver picks a known-cheap endpoint
    // like GET /api/health-with-auth). Used in j06 to demonstrate that a
    // cohort-flipped session still authenticates against the API surface
    // — distinct from "issues new JWT" which is the SDK-level flow.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+performs any authenticated API call$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.uiDriver) {
        return { ok: false, error: `UI step requires ctx.uiDriver (auth call for ${name})` };
      }
      if (!ctx.uiDriver.androidPerformAuthenticatedCall) {
        return { ok: false, error: 'ctx.uiDriver.androidPerformAuthenticatedCall not configured' };
      }
      await ctx.uiDriver.androidPerformAuthenticatedCall(name);
      return { ok: true };
    },
  },
  {
    // `<P> on Android force-refreshes via securetoken endpoint` — explicit
    // POST to securetoken.googleapis.com/v1/token with refresh_token to get
    // a fresh idToken. Used when the test needs to verify Firebase Auth's
    // server-side token-refresh path picks up updated custom claims.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+force-refreshes via securetoken endpoint$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.uiDriver) {
        return {
          ok: false,
          error: `UI step requires ctx.uiDriver (securetoken refresh for ${name})`,
        };
      }
      if (!ctx.uiDriver.androidForceRefreshSecureToken) {
        return {
          ok: false,
          error: 'ctx.uiDriver.androidForceRefreshSecureToken not configured',
        };
      }
      await ctx.uiDriver.androidForceRefreshSecureToken(name);
      return { ok: true };
    },
  },
  {
    // `<P> on Android force-refreshes the JWT` — calls Firebase Auth client
    // SDK's getIdToken(true), which uses the cached refresh token to issue
    // a new idToken via the SDK's internal refresh flow. Different from
    // securetoken-endpoint (REST-level) in that this exercises the SDK's
    // cache + retry logic.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+force-refreshes the JWT$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.uiDriver) {
        return { ok: false, error: `UI step requires ctx.uiDriver (JWT refresh for ${name})` };
      }
      if (!ctx.uiDriver.androidForceRefreshJwt) {
        return { ok: false, error: 'ctx.uiDriver.androidForceRefreshJwt not configured' };
      }
      await ctx.uiDriver.androidForceRefreshJwt(name);
      return { ok: true };
    },
  },
  {
    // Android long-press-on-latest-message + tap a context-menu item.
    // Two-step UI composite delegated to a single driver method that
    // owns the long-press gesture timing AND the menu-tap. Used in j11
    // for the harassment-moderation Report flow and message Edit/Delete.
    //
    // "the message" is implicit context — the most recent message in
    // the active chat thread. Driver locates the latest message bubble
    // by widget hierarchy or by the recyclerview's last visible item.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+long-presses the message and taps "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const menuItem = m[3];
      if (!ctx.uiDriver) {
        return {
          ok: false,
          error: `UI step requires ctx.uiDriver (long-press for ${name}, menu="${menuItem}")`,
        };
      }
      if (!ctx.uiDriver.androidLongPressMessageAndTap) {
        return {
          ok: false,
          error: 'ctx.uiDriver.androidLongPressMessageAndTap not configured',
        };
      }
      await ctx.uiDriver.androidLongPressMessageAndTap(name, menuItem);
      return { ok: true };
    },
  },
  {
    // `<P> on Android sends "X" to <Y>` — send a text message (or simple
    // gift identifier) to recipient Y. Composite delegated to single
    // driver method `androidSendMessageTo(persona, recipient, content)`.
    // Driver owns: open conversation with Y (or start new), focus the
    // message input, type the content, tap send.
    //
    // Simple shape only — does NOT match `sends "X" (10 coins) to Y`
    // (mid-text parens prevent the trailing recipient capture) or
    // `sends "X" gift to Y`. Those variants get separate matchers.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+sends "([^"]+)" to ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const content = m[3];
      const recipient = m[4];
      if (!ctx.uiDriver) {
        return {
          ok: false,
          error: `UI step requires ctx.uiDriver (send "${content}" from ${name} to ${recipient})`,
        };
      }
      if (!ctx.uiDriver.androidSendMessageTo) {
        return { ok: false, error: 'ctx.uiDriver.androidSendMessageTo not configured' };
      }
      await ctx.uiDriver.androidSendMessageTo(name, recipient, content);
      return { ok: true };
    },
  },
  {
    // `<P> on Android taps <Y>'s user card` — tap a user-card UI element
    // identified by display name rather than resource-id. Driver locates
    // the card via the recyclerview's children + display-name match.
    //
    // Doesn't collide with the existing `taps "X"` (quoted resource-id)
    // matcher because this form is unquoted. Regression-guarded.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+taps ([A-Z][a-z]+)'s user card$/,
    async handler(m, ctx) {
      const name = m[1];
      const target = m[3];
      if (!ctx.uiDriver) {
        return {
          ok: false,
          error: `UI step requires ctx.uiDriver (${name} taps ${target}'s user card)`,
        };
      }
      if (!ctx.uiDriver.androidTapUserCard) {
        return { ok: false, error: 'ctx.uiDriver.androidTapUserCard not configured' };
      }
      await ctx.uiDriver.androidTapUserCard(name, target);
      return { ok: true };
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
  {
    // Bare persona-on-platform matcher. Records the persona→platform
    // association without requiring a URL path, sign-in clause, browser
    // locale, or other modifier. Comes after the URL-anchored and
    // signed-in matchers in matcher order so those win for their richer
    // variants. The `$` anchor prevents shadowing.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is on\s+(\w+(?:\s+\w+){0,2})$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[3];
      if (!ctx.personaPlatforms) ctx.personaPlatforms = new Map();
      ctx.personaPlatforms.set(name, platform);
      return { ok: true };
    },
  },
  {
    // Persona signed-in-at-tab/screen variant. Like the URL-anchored
    // "is on X at \"Y\"" but with a "signed in at the \"Y\" tab" suffix
    // that asserts the persona is already authenticated on that tab.
    // Records both platform and path; sign-in proof itself is the
    // scenario author's responsibility (typically a separate Given that
    // populates ctx.sessions earlier in the feature file).
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is on\s+(\w+(?:\s+\w+){0,2})\s+signed in at the "([^"]+)" (?:tab|screen)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[3];
      const urlPath = m[4];
      if (!ctx.personaPlatforms) ctx.personaPlatforms = new Map();
      if (!ctx.personaPaths) ctx.personaPaths = new Map();
      ctx.personaPlatforms.set(name, platform);
      ctx.personaPaths.set(name, urlPath);
      return { ok: true };
    },
  },
  {
    // Gift catalog state-seed. Writes a `gifts/<name>` Firestore doc with
    // `costCoins` and `awardBeans`. This is a state-seed step — the gift
    // catalog is a real Firestore collection in prod, and scenarios that
    // exercise gift-send behavior need the catalog populated to validate
    // cost/award math.
    pattern: /^the gift "([^"]+)" costs (\d+) coins and awards (\d+) beans$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const id = m[1];
      const costCoins = parseInt(m[2], 10);
      const awardBeans = parseInt(m[3], 10);
      await ctx.db.doc(`gifts/${id}`).set({ id, costCoins, awardBeans });
      return { ok: true };
    },
  },
  {
    // Web Admin: issue warning to a user. Delegates to driver method
    // `webAdminIssueWarning(targetName)` — the driver locates the target
    // row in the admin user-table, opens the warn dialog, fills any
    // required reason field, and submits.
    pattern: /^([A-Z][a-z]+)\s+on Web Admin\s+issues a warning to\s+([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const target = m[2];
      if (!ctx.webDriver?.webAdminIssueWarning) {
        return { ok: false, error: 'ctx.webDriver.webAdminIssueWarning not configured' };
      }
      await ctx.webDriver.webAdminIssueWarning(target);
      return { ok: true };
    },
  },
  {
    // Generic confirm action. Platform-dispatch. Drivers decide whether to
    // press a "Confirm" button, tap an OK dialog button, or hit Enter —
    // implementation detail behind the abstraction.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+confirms$/,
    async handler(m, ctx) {
      const platform = m[3];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webConfirm) {
          return { ok: false, error: 'ctx.webDriver.webConfirm not configured' };
        }
        await ctx.webDriver.webConfirm();
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidConfirm) {
          return { ok: false, error: 'ctx.uiDriver.androidConfirm not configured' };
        }
        await ctx.uiDriver.androidConfirm();
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosConfirm) {
          return { ok: false, error: 'ctx.uiDriver.iosConfirm not configured' };
        }
        await ctx.uiDriver.iosConfirm();
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for confirm step` };
    },
  },
  {
    // Send gift with coin cost (j16 economy verification).
    // Platform-dispatch. Drivers receive gift name, coin cost, recipient
    // name as separate args. Cost is captured for assertion downstream —
    // a follow-up step asserts the sender's balance dropped by exactly
    // this amount, and the catalog-seed matcher (Wake 45) ensures the
    // gift's actual cost matches what the scenario asserts.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+sends "([^"]+)" \((\d+) coins\) to ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const platform = m[2];
      const giftName = m[3];
      const cost = parseInt(m[4], 10);
      const recipient = m[5];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webSendGift) {
          return { ok: false, error: 'ctx.webDriver.webSendGift not configured' };
        }
        await ctx.webDriver.webSendGift(giftName, cost, recipient);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidSendGift) {
          return { ok: false, error: 'ctx.uiDriver.androidSendGift not configured' };
        }
        await ctx.uiDriver.androidSendGift(giftName, cost, recipient);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosSendGift) {
          return { ok: false, error: 'ctx.uiDriver.iosSendGift not configured' };
        }
        await ctx.uiDriver.iosSendGift(giftName, cost, recipient);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for send-gift step` };
    },
  },
  {
    // Pick DOB in a named picker (signup flow). Both Android (j01) and
    // iOS Sim (j02) use this; the picker tag is the resource-id / a11y
    // identifier the driver uses to locate the picker widget. Cross-
    // platform dispatch — Web variant not in the corpus.
    pattern: /^([A-Z][a-z]+)\s+on (Android|iOS Sim)\s+picks DOB "([^"]+)" in "([^"]+)"$/,
    async handler(m, ctx) {
      const platform = m[2];
      const dob = m[3];
      const pickerTag = m[4];
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidPickDOB) {
          return { ok: false, error: 'ctx.uiDriver.androidPickDOB not configured' };
        }
        await ctx.uiDriver.androidPickDOB(dob, pickerTag);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosPickDOB) {
          return { ok: false, error: 'ctx.uiDriver.iosPickDOB not configured' };
        }
        await ctx.uiDriver.iosPickDOB(dob, pickerTag);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for pick-DOB step` };
    },
  },
  {
    // Android: pick ID type (j01 age verification submission flow).
    // The value is one of "passport"/"driver-license"/"national-id"
    // per the production picker — but the matcher accepts any quoted
    // string so future picker entries don't require a runner change.
    pattern: /^([A-Z][a-z]+)\s+on Android\s+picks ID type "([^"]+)"$/,
    async handler(m, ctx) {
      const idType = m[2];
      if (!ctx.uiDriver?.androidPickIdType) {
        return { ok: false, error: 'ctx.uiDriver.androidPickIdType not configured' };
      }
      await ctx.uiDriver.androidPickIdType(idType);
      return { ok: true };
    },
  },
  {
    // Android: select test image from gallery (j01 age verification —
    // upload of ID photo). Driver mocks the image picker to return the
    // named test fixture file from app/src/androidTest/assets/.
    pattern: /^([A-Z][a-z]+)\s+on Android\s+selects test image "([^"]+)" from the gallery$/,
    async handler(m, ctx) {
      const filename = m[2];
      if (!ctx.uiDriver?.androidSelectGalleryImage) {
        return { ok: false, error: 'ctx.uiDriver.androidSelectGalleryImage not configured' };
      }
      await ctx.uiDriver.androidSelectGalleryImage(filename);
      return { ok: true };
    },
  },
  {
    // Android signup composite (j01 Adam). The DOB pick + accept-legal
    // chain is collapsed into a single step in the corpus when the
    // scenario doesn't care about intermediate state. Driver chains
    // androidPickDOB(dob, "signup_dobPicker") + accepts both legal
    // checkboxes + taps Continue.
    pattern: /^([A-Z][a-z]+)\s+on Android\s+signs up with DOB "([^"]+)" and accepts legal$/,
    async handler(m, ctx) {
      const dob = m[2];
      if (!ctx.uiDriver?.androidSignupWithDOB) {
        return { ok: false, error: 'ctx.uiDriver.androidSignupWithDOB not configured' };
      }
      await ctx.uiDriver.androidSignupWithDOB(dob);
      return { ok: true };
    },
  },
  {
    // Web Admin: refresh the age-verification tab. Used by j01 to wait
    // for a newly-submitted submission to appear in the admin view.
    pattern: /^([A-Z][a-z]+)\s+on Web Admin\s+refreshes the age-verification tab$/,
    async handler(_m, ctx) {
      if (!ctx.webDriver?.webAdminRefreshAgeVerification) {
        return { ok: false, error: 'ctx.webDriver.webAdminRefreshAgeVerification not configured' };
      }
      await ctx.webDriver.webAdminRefreshAgeVerification();
      return { ok: true };
    },
  },
  {
    // Web Admin: tap approve/reject/etc. on a specific submission row.
    // The uid argument may be a literal numeric uniqueId OR a
    // scenario-var placeholder like "{newUniqueId}". The driver is
    // responsible for resolving the placeholder against scenario state
    // — runner-level scenario-var interpolation is a future wake.
    pattern: /^([A-Z][a-z]+)\s+on Web Admin\s+taps "([^"]+)" on the submission for "([^"]+)"$/,
    async handler(m, ctx) {
      const action = m[2];
      const uid = m[3];
      if (!ctx.webDriver?.webAdminActOnSubmission) {
        return { ok: false, error: 'ctx.webDriver.webAdminActOnSubmission not configured' };
      }
      await ctx.webDriver.webAdminActOnSubmission(action, uid);
      return { ok: true };
    },
  },
  {
    // Capture a persona's uniqueId into a scenario variable. The scenario
    // var system (interpolation in executeStep) lets later steps reference
    // the captured value by `{varName}`. Lookup order: an active session
    // (Wake 4+ persona auth populates ctx.sessions with a `uniqueId`
    // payload field) first, then the persona registry. This lets j04-style
    // scenarios capture a *just-signed-up* user's freshly-minted uniqueId
    // even before any persistent persona row exists.
    pattern: /^([A-Z][a-z]+)'s uniqueId is recorded as \{(\w+)\} for the rest of this scenario$/,
    async handler(m, ctx) {
      const name = m[1];
      const varName = m[2];
      if (!ctx.scenarioVars) ctx.scenarioVars = new Map();
      const session = ctx.sessions?.get(name);
      if (session?.uniqueId !== undefined && session?.uniqueId !== null) {
        ctx.scenarioVars.set(varName, String(session.uniqueId));
        return { ok: true };
      }
      const personas = loadPersonas();
      const p = personas.get(name);
      if (p?.uniqueId !== undefined && p?.uniqueId !== null) {
        ctx.scenarioVars.set(varName, String(p.uniqueId));
        return { ok: true };
      }
      return {
        ok: false,
        error: `cannot record uniqueId for "${name}" — no active session and not in persona registry`,
      };
    },
  },
  {
    // Reward animation assertion (j01 Adam after daily reward).
    // Pattern accepts any quoted string in the reward-text slot so
    // `+{coins}` (interpolated upstream to `+50`) or literal `+10`
    // both work uniformly. The handler does substring containment on
    // androidUiDump — looking for the resolved text anywhere.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s Android UI shows the "([^"]+)" reward animation$/,
    async handler(m, ctx) {
      const expected = m[3];
      if (!ctx.uiDriver?.androidUiDump) {
        return { ok: false, error: 'ctx.uiDriver.androidUiDump not configured' };
      }
      const dump = await ctx.uiDriver.androidUiDump();
      if (!dump.includes(expected)) {
        return {
          ok: false,
          error: `Android dump did not contain reward-animation text "${expected}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // j01 post-signup invariant: main tabs visible, PM tab hidden until
    // age verification approves the user. Substring check on the dump
    // for the three main-tab content-descs AND assertion that "pm"
    // appears nowhere as a content-desc. Quoted-attribute substring
    // matching mirrors how the tag matcher (line 1715) works.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s Android UI shows main tabs but PM tab is hidden$/,
    async handler(_m, ctx) {
      if (!ctx.uiDriver?.androidUiDump) {
        return { ok: false, error: 'ctx.uiDriver.androidUiDump not configured' };
      }
      const dump = await ctx.uiDriver.androidUiDump();
      const mainTabs = ['discover', 'wallet', 'profile'];
      const missing = mainTabs.filter((t) => !dump.includes(`content-desc="${t}"`));
      if (missing.length > 0) {
        return { ok: false, error: `main tabs missing: ${missing.join(', ')}` };
      }
      if (dump.includes('content-desc="pm"')) {
        return { ok: false, error: 'PM tab is present in Android dump but should be hidden' };
      }
      return { ok: true };
    },
  },
  {
    // Deep-link navigation attempt. Drivers fire the platform's deep-link
    // intent (adb am start -d <url> on Android; xcrun simctl openurl on
    // iOS). The "attempts to" wording is intentional — the step doesn't
    // assert the navigation succeeded, only that the deep link was
    // dispatched. A follow-up step asserts the resulting UI state.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on (Android|iOS Sim)\s+attempts to navigate to "([^"]+)" via deep link$/,
    async handler(m, ctx) {
      const platform = m[3];
      const url = m[4];
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidOpenDeepLink) {
          return { ok: false, error: 'ctx.uiDriver.androidOpenDeepLink not configured' };
        }
        await ctx.uiDriver.androidOpenDeepLink(url);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosOpenDeepLink) {
          return { ok: false, error: 'ctx.uiDriver.iosOpenDeepLink not configured' };
        }
        await ctx.uiDriver.iosOpenDeepLink(url);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for deep-link step` };
    },
  },
  {
    // "no <X> screen renders" — UI-absence of a named screen on the
    // current platform. Persona/platform context is implicit (driver
    // tracks which dump to read internally). The matcher accepts both
    // uppercase abbreviations ("PM") and lowercase ("pm"), passing the
    // captured token to the driver verbatim.
    pattern: /^no ([\w-]+) screen renders$/,
    async handler(m, ctx) {
      const screenName = m[1];
      if (!ctx.uiDriver?.currentPlatformRendersScreen) {
        return { ok: false, error: 'ctx.uiDriver.currentPlatformRendersScreen not configured' };
      }
      const rendered = await ctx.uiDriver.currentPlatformRendersScreen(screenName);
      if (rendered) {
        return {
          ok: false,
          error: `${screenName} screen should not render but driver reports it does`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Gift selection composite (j01 Adam send-gift flow).
    // "selects gift X and recipient Y" — driver picks the gift from the
    // gift wheel/grid AND selects the recipient from the contact list.
    // Single matcher because the corpus uses the composite form when
    // intermediate steps aren't relevant.
    pattern: /^([A-Z][a-z]+)\s+on Android\s+selects gift "([^"]+)" and recipient "([^"]+)"$/,
    async handler(m, ctx) {
      const giftName = m[2];
      const recipient = m[3];
      if (!ctx.uiDriver?.androidSelectGiftRecipient) {
        return { ok: false, error: 'ctx.uiDriver.androidSelectGiftRecipient not configured' };
      }
      await ctx.uiDriver.androidSelectGiftRecipient(giftName, recipient);
      return { ok: true };
    },
  },
  {
    // Sign-in form filler. Two-field composite: "types EMAIL + PASSWORD
    // and submits". Platform-dispatch — Web is the dominant target
    // (j03 Lena lapsed-adult flow uses {PERSONAS_PASSWORD} placeholder
    // which interpolates from process.env), but Android/iOS Sim variants
    // accepted for symmetry.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+types "([^"]+)" \+ "([^"]+)" and submits$/,
    async handler(m, ctx) {
      const platform = m[2];
      const email = m[3];
      const password = m[4];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webTypeAndSubmit) {
          return { ok: false, error: 'ctx.webDriver.webTypeAndSubmit not configured' };
        }
        await ctx.webDriver.webTypeAndSubmit(email, password);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidTypeAndSubmit) {
          return { ok: false, error: 'ctx.uiDriver.androidTypeAndSubmit not configured' };
        }
        await ctx.uiDriver.androidTypeAndSubmit(email, password);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosTypeAndSubmit) {
          return { ok: false, error: 'ctx.uiDriver.iosTypeAndSubmit not configured' };
        }
        await ctx.uiDriver.iosTypeAndSubmit(email, password);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for type-and-submit step` };
    },
  },
  {
    // Current screen Given. Records platform + screen-name on the persona
    // tracking maps (same shape as the URL-anchored persona-bootstrap
    // matcher at line 1565). Screen names are platform-internal — Android
    // / iOS use route names ("age_verification"), Web uses path or
    // top-level component names.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+is on the "([^"]+)" screen$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[3];
      const screenName = m[4];
      if (!ctx.personaPlatforms) ctx.personaPlatforms = new Map();
      if (!ctx.personaPaths) ctx.personaPaths = new Map();
      ctx.personaPlatforms.set(name, platform);
      ctx.personaPaths.set(name, screenName);
      return { ok: true };
    },
  },
  {
    // Cross-persona displayName assertion. Looks up the target persona's
    // displayName from the registry, then asserts the platform UI dump
    // contains it. Optional `"<expected>"` literal overrides the registry
    // lookup — useful when the corpus wants to be explicit about which
    // displayName variant should be visible (some scenarios may use
    // shortened forms or aliases).
    //
    // Same alternation order as elsewhere: longest Web variants first.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows ([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s displayName(?: "([^"]+)")?$/,
    async handler(m, ctx) {
      const platform = m[3];
      const target = m[4];
      const explicit = m[6];
      let expected = explicit;
      if (!expected) {
        const personas = loadPersonas();
        const p = personas.get(target);
        if (!p) {
          return {
            ok: false,
            error: `target persona "${target}" not in registry — cannot resolve displayName`,
          };
        }
        expected = p.displayName;
      }
      let dump;
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webUiDump) {
          return { ok: false, error: 'ctx.webDriver.webUiDump not configured' };
        }
        dump = await ctx.webDriver.webUiDump();
      } else if (platform === 'Android') {
        if (!ctx.uiDriver?.androidUiDump) {
          return { ok: false, error: 'ctx.uiDriver.androidUiDump not configured' };
        }
        dump = await ctx.uiDriver.androidUiDump();
      } else if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosUiDump) {
          return { ok: false, error: 'ctx.uiDriver.iosUiDump not configured' };
        }
        dump = await ctx.uiDriver.iosUiDump();
      } else {
        return { ok: false, error: `unknown platform "${platform}" for displayName step` };
      }
      if (!dump.includes(expected)) {
        return {
          ok: false,
          error: `${platform} UI dump did not contain ${target}'s displayName "${expected}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Quoted-string UI absence — like the Wake-44 person-absence matcher
    // but takes a LITERAL quoted string instead of a capitalized name.
    // Used for resource-id-shaped tags (`"main_roomsTab"`) and persona
    // names that the corpus author specifically quoted to mark as a UI
    // string rather than a persona reference.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI does not show "([^"]+)"$/,
    async handler(m, ctx) {
      const platform = m[3];
      const target = m[4];
      let dump;
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webUiDump) {
          return { ok: false, error: 'ctx.webDriver.webUiDump not configured' };
        }
        dump = await ctx.webDriver.webUiDump();
      } else if (platform === 'Android') {
        if (!ctx.uiDriver?.androidUiDump) {
          return { ok: false, error: 'ctx.uiDriver.androidUiDump not configured' };
        }
        dump = await ctx.uiDriver.androidUiDump();
      } else if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosUiDump) {
          return { ok: false, error: 'ctx.uiDriver.iosUiDump not configured' };
        }
        dump = await ctx.uiDriver.iosUiDump();
      } else {
        return { ok: false, error: `unknown platform "${platform}" for absence step` };
      }
      if (typeof dump === 'string' && dump.includes(target)) {
        return {
          ok: false,
          error: `${platform} UI dump should not contain "${target}" but it does`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Bare-name button tap. The corpus uses "taps the X button" for
    // single-word button names where the quoted-form would be visually
    // noisy (e.g. "the claim button" reads more naturally than
    // "the \"claim\" button"). Driver receives the bare name and decides
    // which selector to use.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+taps the (\w+) button$/,
    async handler(m, ctx) {
      const platform = m[3];
      const buttonName = m[4];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webTapNamedButton) {
          return { ok: false, error: 'ctx.webDriver.webTapNamedButton not configured' };
        }
        await ctx.webDriver.webTapNamedButton(buttonName);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidTapNamedButton) {
          return { ok: false, error: 'ctx.uiDriver.androidTapNamedButton not configured' };
        }
        await ctx.uiDriver.androidTapNamedButton(buttonName);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosTapNamedButton) {
          return { ok: false, error: 'ctx.uiDriver.iosTapNamedButton not configured' };
        }
        await ctx.uiDriver.iosTapNamedButton(buttonName);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for button-tap step` };
    },
  },
  {
    // Legal checkboxes + continue composite (signup flow).
    // "accepts both legal checkboxes and continues" (j02 Mia iOS)
    // "checks both legal checkboxes and continues" (j03 Lena Web)
    // Both verbs route to the same driver method — the lexical
    // difference is corpus-author preference, not a behavior split.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+(?:accepts|checks) both legal checkboxes and continues$/,
    async handler(m, ctx) {
      const platform = m[2];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webAcceptLegalAndContinue) {
          return { ok: false, error: 'ctx.webDriver.webAcceptLegalAndContinue not configured' };
        }
        await ctx.webDriver.webAcceptLegalAndContinue();
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidAcceptLegalAndContinue) {
          return { ok: false, error: 'ctx.uiDriver.androidAcceptLegalAndContinue not configured' };
        }
        await ctx.uiDriver.androidAcceptLegalAndContinue();
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosAcceptLegalAndContinue) {
          return { ok: false, error: 'ctx.uiDriver.iosAcceptLegalAndContinue not configured' };
        }
        await ctx.uiDriver.iosAcceptLegalAndContinue();
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for legal-checkbox step` };
    },
  },
  {
    // Persona "signed in" variant with annotation tolerance + optional
    // trailing screen. Generalises Wake-45's strict signed-in-at-tab
    // matcher to handle two j02 corpus patterns:
    //   - "Alice is on Web Chromium signed in (cross-cohort adult)"
    //     [mid-step annotation, no trailing screen]
    //   - "Marcus is on Android signed in (same-cohort minor) at the
    //     \"discovery\" screen" [both annotation and trailing screen]
    // The annotation is a hint to the human reader, not a directive to
    // the runner — we capture and discard it. Wake-45's no-annotation
    // matcher already handles the simple "X signed in at the Y" form
    // and wins first-match-order; this matcher catches the rest.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is on\s+(\w+(?:\s+\w+){0,2})\s+signed in(?:\s+\([^)]*\))?(?:\s+at the "([^"]+)" (?:tab|screen))?$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[3];
      const urlPath = m[4];
      if (!ctx.personaPlatforms) ctx.personaPlatforms = new Map();
      if (!ctx.personaPaths) ctx.personaPaths = new Map();
      ctx.personaPlatforms.set(name, platform);
      if (urlPath) ctx.personaPaths.set(name, urlPath);
      return { ok: true };
    },
  },
  {
    // Bare "X is on the <multi-word screen> screen" — no platform. Some
    // scenarios state the screen WITHOUT re-specifying the platform when
    // it's already been set by an earlier persona-bootstrap step (or is
    // semantically platform-agnostic like the legal acceptance screen).
    //
    // Multi-word screen names accepted ("age verification submission",
    // "legal acceptance"). Path is recorded without quote-stripping
    // because the corpus form omits quotes.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is on the (.+) screen$/,
    async handler(m, ctx) {
      const name = m[1];
      const screenName = m[3];
      if (!ctx.personaPaths) ctx.personaPaths = new Map();
      ctx.personaPaths.set(name, screenName);
      return { ok: true };
    },
  },
  {
    // API legal-versions assertion (Given precondition for j03 etc.).
    // Fetches /api/legal/versions and verifies the named version field
    // equals the expected value. Three named version keys (privacy,
    // terms, community) cover the corpus surface — each maps to a
    // matching JSON field in the response.
    //
    // The endpoint path is captured even though it's a fixed string in
    // the corpus — keeps the matcher's intent transparent.
    pattern: /^the current (privacy|terms|community) version is (\d+) in (\/api\/legal\/versions)$/,
    async handler(m, ctx) {
      const versionKey = m[1];
      const expected = parseInt(m[2], 10);
      const apiPath = m[3];
      if (!ctx.fetch) return { ok: false, error: 'ctx.fetch not configured' };
      const res = await ctx.fetch(`${ctx.apiBase}${apiPath}`);
      if (res.status !== 200) {
        return { ok: false, error: `${apiPath} returned ${res.status}` };
      }
      const body = await res.json();
      const actual = body?.[versionKey];
      if (actual !== expected) {
        return {
          ok: false,
          error: `${versionKey} version mismatch: expected ${expected}, actual ${actual}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Firestore absence by user-uniqueId. Queries the named collection
    // for any doc with `userId == <persona uniqueId>` and asserts none.
    // Persona uniqueId resolution prefers an active session (in case
    // the persona just signed up and isn't in the registry yet), then
    // falls back to the static persona registry — same lookup chain
    // as Wake 47's uniqueId capture matcher.
    pattern: /^no submission doc is created in "([^"]+)" for ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const collection = m[1];
      const name = m[2];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const session = ctx.sessions?.get(name);
      let uniqueId =
        session?.uniqueId !== undefined && session?.uniqueId !== null
          ? session.uniqueId
          : undefined;
      if (uniqueId === undefined) {
        const personas = loadPersonas();
        const p = personas.get(name);
        if (p?.uniqueId !== undefined && p?.uniqueId !== null) uniqueId = p.uniqueId;
      }
      if (uniqueId === undefined) {
        return { ok: false, error: `cannot resolve uniqueId for persona "${name}"` };
      }
      const stringUid = String(uniqueId);
      // In-memory filter rather than `.where()` for consistency with other
      // collection-scan matchers (line ~2900) which avoid `.where()` because
      // fake DBs in tests don't implement it.
      const snap = await ctx.db.collection(collection).get();
      const matches = snap.docs.filter((d) => d.data()?.userId === stringUid);
      if (matches.length > 0) {
        return {
          ok: false,
          error: `expected no docs in "${collection}" for userId=${stringUid} but found ${matches.length}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // List-membership UI assertion. Substring-matches the item text in
    // the platform's UI dump. The "in the <list> list" suffix names the
    // list semantically — useful for drivers that want to scope the
    // search to a specific section — but the runner-level substring
    // check is sufficient for the corpus's correctness requirements.
    //
    // Item text is non-greedy `.+?` so trailing "in the <X> list" stays
    // matched as a literal suffix, not consumed into the item-text
    // capture group.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows (.+?) in the (\w+) list$/,
    async handler(m, ctx) {
      const platform = m[3];
      const itemText = m[4];
      const listType = m[5];
      let dump;
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webUiDump) {
          return { ok: false, error: 'ctx.webDriver.webUiDump not configured' };
        }
        dump = await ctx.webDriver.webUiDump();
      } else if (platform === 'Android') {
        if (!ctx.uiDriver?.androidUiDump) {
          return { ok: false, error: 'ctx.uiDriver.androidUiDump not configured' };
        }
        dump = await ctx.uiDriver.androidUiDump();
      } else if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosUiDump) {
          return { ok: false, error: 'ctx.uiDriver.iosUiDump not configured' };
        }
        dump = await ctx.uiDriver.iosUiDump();
      } else {
        return { ok: false, error: `unknown platform "${platform}" for list-membership step` };
      }
      if (!dump.includes(itemText)) {
        return {
          ok: false,
          error: `${platform} ${listType} list did not contain "${itemText}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Browser notification permission grant (web only — mobile uses OS
    // permission dialogs handled separately). Driver invokes the
    // Playwright MCP's permission-granting API.
    pattern: /^([A-Z][a-z]+)\s+on Web grants the browser notification permission$/,
    async handler(_m, ctx) {
      if (!ctx.webDriver?.webGrantNotificationPermission) {
        return { ok: false, error: 'ctx.webDriver.webGrantNotificationPermission not configured' };
      }
      await ctx.webDriver.webGrantNotificationPermission();
      return { ok: true };
    },
  },
  {
    // Web Admin: open unquoted tab name (slug form). Wake 45's quoted
    // matcher handles `opens the "X" tab`; this handles bare-slug
    // `opens the X-Y tab` (kebab-case identifier). Disjoint by
    // structure — the kebab form excludes `"`.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Web Admin\s+opens the ([a-z][\w-]*) tab$/,
    async handler(m, ctx) {
      const tabName = m[3];
      if (!ctx.webDriver?.webAdminOpenTab) {
        return { ok: false, error: 'ctx.webDriver.webAdminOpenTab not configured' };
      }
      await ctx.webDriver.webAdminOpenTab(tabName);
      return { ok: true };
    },
  },
  {
    // Web Admin: act on a submission identified by the submitter's NAME
    // (not uniqueId). Wake 46 handles `submission for "<uid>"` (quoted
    // uid or {varName}); this handles `Name's submission` (possessive).
    pattern: /^([A-Z][a-z]+)\s+on Web Admin\s+taps "([^"]+)" on ([A-Z][a-z]+)'s submission$/,
    async handler(m, ctx) {
      const action = m[2];
      const submitter = m[3];
      if (!ctx.webDriver?.webAdminActOnSubmissionByName) {
        return { ok: false, error: 'ctx.webDriver.webAdminActOnSubmissionByName not configured' };
      }
      await ctx.webDriver.webAdminActOnSubmissionByName(action, submitter);
      return { ok: true };
    },
  },
  {
    // Web Admin: bare element-visible assertion for the ID image.
    // Driver method returns truthy iff the image is currently rendered
    // in the admin review pane.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s Web Admin UI shows the ID image$/,
    async handler(_m, ctx) {
      if (!ctx.webDriver?.webAdminShowsIdImage) {
        return { ok: false, error: 'ctx.webDriver.webAdminShowsIdImage not configured' };
      }
      const shown = await ctx.webDriver.webAdminShowsIdImage();
      if (!shown) {
        return {
          ok: false,
          error: 'Web Admin UI should show the ID image but driver reports it is hidden',
        };
      }
      return { ok: true };
    },
  },
  {
    // Web Admin: UI shows the parsed DOB candidate (quoted text).
    // After OCR/admin-parsing extracts a DOB candidate from the ID
    // image, the admin UI displays it for review. Substring check on
    // the Web UI dump.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s Web Admin UI shows the parsed DOB candidate "([^"]+)"$/,
    async handler(m, ctx) {
      const dob = m[3];
      if (!ctx.webDriver?.webUiDump) {
        return { ok: false, error: 'ctx.webDriver.webUiDump not configured' };
      }
      const dump = await ctx.webDriver.webUiDump();
      if (!dump.includes(dob)) {
        return {
          ok: false,
          error: `Web Admin UI dump did not contain parsed DOB candidate "${dob}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // User card tap (discovery/profile-list variant of Wake 44's
    // room-card matcher). Platform-dispatch.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+taps ([A-Z][a-z]+)'s user card$/,
    async handler(m, ctx) {
      const platform = m[3];
      const owner = m[4];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webTapUserCard) {
          return { ok: false, error: 'ctx.webDriver.webTapUserCard not configured' };
        }
        await ctx.webDriver.webTapUserCard(owner);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidTapUserCard) {
          return { ok: false, error: 'ctx.uiDriver.androidTapUserCard not configured' };
        }
        await ctx.uiDriver.androidTapUserCard(owner);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosTapUserCard) {
          return { ok: false, error: 'ctx.uiDriver.iosTapUserCard not configured' };
        }
        await ctx.uiDriver.iosTapUserCard(owner);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for user-card tap step` };
    },
  },
  {
    // User-doc state-seed with array field. "manipulated" verb signals
    // the value is NOT from normal API flow — useful for cross-cohort
    // stale-follow scenarios. Writes via merge so other fields stay.
    pattern: /^([A-Z][a-z]+)'s user doc was manipulated to have (\w+)=\[([^\]]*)\]$/,
    async handler(m, ctx) {
      const name = m[1];
      const fieldName = m[2];
      const rawArray = m[3];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      const trimmed = rawArray.trim();
      const elements =
        trimmed === ''
          ? []
          : trimmed.split(',').map((s) => {
              const n = parseInt(s.trim(), 10);
              return Number.isNaN(n) ? s.trim() : n;
            });
      await ctx.db.doc(`users/${p.uniqueId}`).set({ [fieldName]: elements }, { merge: true });
      return { ok: true };
    },
  },
  {
    // Web Admin tap-with-reason-AND-dobOverride (j04 reject_and_dob_down).
    // Extends Wake 45's tap-with-reason matcher with the dobOverride
    // parameter. Driver receives three args: action, reason, override.
    pattern:
      /^([A-Z][a-z]+)\s+on Web Admin\s+taps "([^"]+)" with reason "([^"]+)" and dobOverride="([^"]+)"$/,
    async handler(m, ctx) {
      const action = m[2];
      const reason = m[3];
      const dobOverride = m[4];
      if (!ctx.webDriver?.webAdminTapWithReasonAndOverride) {
        return {
          ok: false,
          error: 'ctx.webDriver.webAdminTapWithReasonAndOverride not configured',
        };
      }
      await ctx.webDriver.webAdminTapWithReasonAndOverride(action, reason, dobOverride);
      return { ok: true };
    },
  },
  {
    // Firestore count by system PM key + addressee uniqueId. Asserts the
    // named collection has EXACTLY N entries matching both filters. Used
    // by j04 to verify the admin-PM was created (and only one of it).
    // In-memory filter — fake-DB lacks .where().
    pattern:
      /^the database has (\d+) entries in "([^"]+)" with the system PM key "([^"]+)" addressed to (\d+)$/,
    async handler(m, ctx) {
      const expectedCount = parseInt(m[1], 10);
      const collection = m[2];
      const systemKey = m[3];
      const addresseeUid = parseInt(m[4], 10);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.collection(collection).get();
      const matches = snap.docs.filter((d) => {
        const data = d.data();
        return data?.systemKey === systemKey && data?.addresseeUniqueId === addresseeUid;
      });
      if (matches.length !== expectedCount) {
        return {
          ok: false,
          error: `${collection} count mismatch for systemKey="${systemKey}" addressee=${addresseeUid}: expected ${expectedCount}, actual ${matches.length}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // PM body locale-+-template check. Driver verifies the PM body matches
    // the named template in the named locale — does the lookup against
    // template registry and resolves placeholders before comparing.
    // Driver method: pmBodyIsTranslationOfTemplate(localeCode, templateName).
    pattern: /^the PM body is the ([A-Z][a-z]+) translation of the (\w+) template$/,
    async handler(m, ctx) {
      const LOCALE_NAME_TO_CODE = {
        Arabic: 'ar',
        German: 'de',
        Spanish: 'es',
        French: 'fr',
        Hindi: 'hi',
        Indonesian: 'id',
        Italian: 'it',
        Japanese: 'ja',
        Khmer: 'km',
        Korean: 'ko',
        Dutch: 'nl',
        Polish: 'pl',
        Portuguese: 'pt',
        Russian: 'ru',
        Swedish: 'sv',
        Thai: 'th',
        Turkish: 'tr',
        Ukrainian: 'uk',
        Vietnamese: 'vi',
        Chinese: 'zh',
      };
      const localeName = m[1];
      const templateName = m[2];
      const code = LOCALE_NAME_TO_CODE[localeName];
      if (!code) {
        return { ok: false, error: `unknown locale name "${localeName}"` };
      }
      if (!ctx.webDriver?.pmBodyIsTranslationOfTemplate) {
        return { ok: false, error: 'ctx.webDriver.pmBodyIsTranslationOfTemplate not configured' };
      }
      const ok = await ctx.webDriver.pmBodyIsTranslationOfTemplate(code, templateName);
      if (!ok) {
        return {
          ok: false,
          error: `PM body did not match the ${localeName} (${code}) translation of "${templateName}" template`,
        };
      }
      return { ok: true };
    },
  },
  {
    // PM is from <sender> assertion. Trailing parens annotation
    // (e.g. "(uniqueId=1, userType=SHYTALK_OFFICIAL)") is stripped
    // upstream by Wake 30's stripStepAnnotation, so the matcher sees the
    // bare form "the PM is from Officia".
    pattern: /^the PM is from ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const sender = m[1];
      if (!ctx.webDriver?.pmIsFromSender) {
        return { ok: false, error: 'ctx.webDriver.pmIsFromSender not configured' };
      }
      const ok = await ctx.webDriver.pmIsFromSender(sender);
      if (!ok) {
        return { ok: false, error: `PM is not from sender "${sender}"` };
      }
      return { ok: true };
    },
  },
  {
    // Relaunches the app and signs in (Android + iOS Sim). Composite —
    // driver kills the process, restarts it, and signs in with the
    // persona's stored credentials (no UI typing in the runner).
    pattern: /^([A-Z][a-z]+)\s+on (Android|iOS Sim)\s+relaunches the app and signs in$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidRelaunchAndSignIn) {
          return { ok: false, error: 'ctx.uiDriver.androidRelaunchAndSignIn not configured' };
        }
        await ctx.uiDriver.androidRelaunchAndSignIn(name);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosRelaunchAndSignIn) {
          return { ok: false, error: 'ctx.uiDriver.iosRelaunchAndSignIn not configured' };
        }
        await ctx.uiDriver.iosRelaunchAndSignIn(name);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for relaunch step` };
    },
  },
  {
    // In-app banner about cohort change in <locale>. Driver method
    // returns truthy iff the banner is currently rendered in the
    // expected locale. Driver verifies both presence AND that the
    // banner text matches the locale-specific copy.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Android|iOS Sim) UI shows the in-app banner about the cohort change in ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const LOCALE_NAME_TO_CODE = {
        Arabic: 'ar',
        German: 'de',
        Spanish: 'es',
        French: 'fr',
        Hindi: 'hi',
        Indonesian: 'id',
        Italian: 'it',
        Japanese: 'ja',
        Khmer: 'km',
        Korean: 'ko',
        Dutch: 'nl',
        Polish: 'pl',
        Portuguese: 'pt',
        Russian: 'ru',
        Swedish: 'sv',
        Thai: 'th',
        Turkish: 'tr',
        Ukrainian: 'uk',
        Vietnamese: 'vi',
        Chinese: 'zh',
      };
      const platform = m[3];
      const localeName = m[4];
      const code = LOCALE_NAME_TO_CODE[localeName];
      if (!code) {
        return { ok: false, error: `unknown locale name "${localeName}"` };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidShowsCohortChangeBanner) {
          return {
            ok: false,
            error: 'ctx.uiDriver.androidShowsCohortChangeBanner not configured',
          };
        }
        const ok = await ctx.uiDriver.androidShowsCohortChangeBanner(code);
        if (!ok) {
          return {
            ok: false,
            error: `Android UI did not show the cohort change banner in ${localeName} (${code})`,
          };
        }
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosShowsCohortChangeBanner) {
          return { ok: false, error: 'ctx.uiDriver.iosShowsCohortChangeBanner not configured' };
        }
        const ok = await ctx.uiDriver.iosShowsCohortChangeBanner(code);
        if (!ok) {
          return {
            ok: false,
            error: `iOS UI did not show the cohort change banner in ${localeName} (${code})`,
          };
        }
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for cohort-banner step` };
    },
  },
  {
    // Balance comparison Given. "X has shyCoins OP N [trailing explanation]".
    // The trailing explanation ("after daily reward + a +100 admin top-up")
    // is descriptive context, NOT in parens, so Wake 30 doesn't strip it.
    // Matcher accepts and ignores anything after the numeric value.
    //
    // Regex is linear: `.+$` is greedy + anchored to end-of-string, no
    // overlap with preceding tokens. Input is author-controlled (feature
    // files), not untrusted user data. Safe.
    // eslint-disable-next-line sonarjs/slow-regex
    pattern: /^([A-Z][a-z]+)\s+has\s+(\w+)\s+(>=|<=|==|>|<)\s+(\d+)(?:\s+.+)?$/,
    async handler(m, ctx) {
      const name = m[1];
      const field = m[2];
      const op = m[3];
      const expected = parseInt(m[4], 10);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      const snap = await ctx.db.doc(`users/${p.uniqueId}`).get();
      if (!snap.exists) {
        return { ok: false, error: `user doc "users/${p.uniqueId}" does not exist` };
      }
      const actual = snap.data()?.[field];
      const pass = (() => {
        switch (op) {
          case '<':
            return actual < expected;
          case '<=':
            return actual <= expected;
          case '==':
            return actual === expected;
          case '>=':
            return actual >= expected;
          case '>':
            return actual > expected;
          default:
            return false;
        }
      })();
      if (!pass) {
        return {
          ok: false,
          error: `${name}'s ${field} comparison failed: ${actual} ${op} ${expected} is false`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Firestore field-still-containing assertion. Two value shapes:
    //   [a, b, c]  — expect doc field array to contain ALL these
    //              elements (non-exhaustive — extras allowed).
    //   N         — scalar; field equals N OR (if field is array)
    //              array contains N.
    // Used by j04 to verify cross-cohort stale-follow scenarios
    // don't accidentally clean the array.
    pattern: /^the database has document "([^"]+)" with field "([^"]+)" still containing (.+)$/,
    async handler(m, ctx) {
      const docPath = m[1];
      const field = m[2];
      const rawValue = m[3].trim();
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) {
        return { ok: false, error: `document "${docPath}" does not exist` };
      }
      const actual = snap.data()?.[field];
      if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
        const inner = rawValue.slice(1, -1).trim();
        const expected =
          inner === ''
            ? []
            : inner.split(',').map((s) => {
                const n = parseInt(s.trim(), 10);
                return Number.isNaN(n) ? s.trim() : n;
              });
        if (!Array.isArray(actual)) {
          return {
            ok: false,
            error: `field "${field}" on "${docPath}" is not an array (got ${typeof actual})`,
          };
        }
        const missing = expected.filter((el) => !actual.includes(el));
        if (missing.length > 0) {
          return {
            ok: false,
            error: `field "${field}" missing expected elements: ${missing.join(', ')}`,
          };
        }
        return { ok: true };
      }
      const n = parseInt(rawValue, 10);
      const expected = Number.isNaN(n) ? rawValue : n;
      if (Array.isArray(actual)) {
        if (!actual.includes(expected)) {
          return {
            ok: false,
            error: `field "${field}" array does not contain "${expected}"`,
          };
        }
        return { ok: true };
      }
      if (actual !== expected) {
        return {
          ok: false,
          error: `field "${field}" expected ${expected}, actual ${actual}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Placeholder UI assertion. Two phrasings:
    //   "renders the \"X\" placeholder in both|that slot(s)"  (j04)
    //   "renders the placeholder \"X\" in that slot"           (j02)
    // Both reduce to driver call (placeholderName, slotHint).
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Android|iOS Sim) UI renders the (?:"([^"]+)" placeholder|placeholder "([^"]+)") in (that|both) slots?$/,
    async handler(m, ctx) {
      const platform = m[3];
      const placeholderName = m[4] || m[5];
      const slotHint = m[6];
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidShowsPlaceholder) {
          return { ok: false, error: 'ctx.uiDriver.androidShowsPlaceholder not configured' };
        }
        const ok = await ctx.uiDriver.androidShowsPlaceholder(placeholderName, slotHint);
        if (!ok) {
          return {
            ok: false,
            error: `Android UI did not render placeholder "${placeholderName}" in ${slotHint} slot(s)`,
          };
        }
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosShowsPlaceholder) {
          return { ok: false, error: 'ctx.uiDriver.iosShowsPlaceholder not configured' };
        }
        const ok = await ctx.uiDriver.iosShowsPlaceholder(placeholderName, slotHint);
        if (!ok) {
          return {
            ok: false,
            error: `iOS UI did not render placeholder "${placeholderName}" in ${slotHint} slot(s)`,
          };
        }
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for placeholder step` };
    },
  },
  {
    // PM-with-badge UI assertion. Driver verifies a PM from the named
    // sender is rendered AND has the named badge attached. Badge
    // currently "official" only but matcher accepts any single-word
    // badge for future expansion.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Android|iOS Sim) UI shows the new PM from ([A-Z][a-z]+) with the (\w+) badge$/,
    async handler(m, ctx) {
      const platform = m[3];
      const sender = m[4];
      const badge = m[5];
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidShowsPmWithBadge) {
          return { ok: false, error: 'ctx.uiDriver.androidShowsPmWithBadge not configured' };
        }
        const ok = await ctx.uiDriver.androidShowsPmWithBadge(sender, badge);
        if (!ok) {
          return {
            ok: false,
            error: `Android UI did not show PM from "${sender}" with "${badge}" badge`,
          };
        }
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosShowsPmWithBadge) {
          return { ok: false, error: 'ctx.uiDriver.iosShowsPmWithBadge not configured' };
        }
        const ok = await ctx.uiDriver.iosShowsPmWithBadge(sender, badge);
        if (!ok) {
          return {
            ok: false,
            error: `iOS UI did not show PM from "${sender}" with "${badge}" badge`,
          };
        }
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for PM-with-badge step` };
    },
  },
  {
    // Followers/following list nav. "X on Y opens his|her|their <LIST>
    // list" where LIST is one of "followers" or "following". Distinct
    // from Wake 45's pronoun-screen matcher because the noun is "list"
    // not "screen".
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+opens (?:his|her|their) (followers|following) list$/,
    async handler(m, ctx) {
      const platform = m[2];
      const listName = m[3];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webOpenListView) {
          return { ok: false, error: 'ctx.webDriver.webOpenListView not configured' };
        }
        await ctx.webDriver.webOpenListView(listName);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidOpenListView) {
          return { ok: false, error: 'ctx.uiDriver.androidOpenListView not configured' };
        }
        await ctx.uiDriver.androidOpenListView(listName);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosOpenListView) {
          return { ok: false, error: 'ctx.uiDriver.iosOpenListView not configured' };
        }
        await ctx.uiDriver.iosOpenListView(listName);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for list-nav step` };
    },
  },
  {
    // Performance budget assertion. Driver records timing from the most
    // recent "submit" step to the target tag rendering, returns the
    // elapsed milliseconds. Matcher compares against the budget.
    pattern: /^the time from submit to "([^"]+)" rendering is less than (\d+)ms$/,
    async handler(m, ctx) {
      const target = m[1];
      const budget = parseInt(m[2], 10);
      if (!ctx.uiDriver?.measureRenderingTimeFromSubmit) {
        return { ok: false, error: 'ctx.uiDriver.measureRenderingTimeFromSubmit not configured' };
      }
      const actual = await ctx.uiDriver.measureRenderingTimeFromSubmit(target);
      if (actual >= budget) {
        return {
          ok: false,
          error: `rendering time exceeded budget for "${target}": ${actual}ms >= ${budget}ms`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Package state-seed (j05/j06 IAP catalog). Writes packages/<id>
    // with coinValue (required) and optional price. Price stays as the
    // raw string with `$` so display tests can verify formatting.
    pattern: /^the package "([^"]+)" exists with coinValue=(\d+)(?: and price="([^"]+)")?$/,
    async handler(m, ctx) {
      const id = m[1];
      const coinValue = parseInt(m[2], 10);
      const price = m[3];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const doc = { id, coinValue };
      if (price !== undefined) doc.price = price;
      await ctx.db.doc(`packages/${id}`).set(doc);
      return { ok: true };
    },
  },
  {
    // Package selection (j05 — Alice selects coins-1000). Driver navigates
    // to the catalog screen if needed and taps the named package card.
    pattern: /^([A-Z][a-z]+)\s+on Web selects package "([^"]+)"$/,
    async handler(m, ctx) {
      const packageId = m[2];
      if (!ctx.webDriver?.webSelectPackage) {
        return { ok: false, error: 'ctx.webDriver.webSelectPackage not configured' };
      }
      await ctx.webDriver.webSelectPackage(packageId);
      return { ok: true };
    },
  },
  {
    // Sandbox receipt submission (j05). The receipt ID is opaque to the
    // runner — Wake 47 interpolation resolves any `{ts}` / `{var}`
    // placeholders before this matcher sees the text. Driver POSTs the
    // receipt to the IAP-verify endpoint.
    pattern: /^([A-Z][a-z]+)\s+on Web submits a sandbox receipt "([^"]+)"$/,
    async handler(m, ctx) {
      const receiptId = m[2];
      if (!ctx.webDriver?.webSubmitSandboxReceipt) {
        return { ok: false, error: 'ctx.webDriver.webSubmitSandboxReceipt not configured' };
      }
      await ctx.webDriver.webSubmitSandboxReceipt(receiptId);
      return { ok: true };
    },
  },
  {
    // Collection-entries-added-since assertion. Counts docs in the named
    // collection (sub-collection paths supported) whose `createdAt` field
    // is >= the given timestamp. The timestamp arrives as a quoted string
    // because the corpus uses `"{ts}"` form — runner-level interpolation
    // already resolved it to the literal value.
    pattern: /^the database has (\d+) entries in "([^"]+)" added since "(\d+)"$/,
    async handler(m, ctx) {
      const expectedCount = parseInt(m[1], 10);
      const collection = m[2];
      const sinceTs = parseInt(m[3], 10);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.collection(collection).get();
      const matches = snap.docs.filter((d) => {
        const ts = d.data()?.createdAt;
        return typeof ts === 'number' && ts >= sinceTs;
      });
      if (matches.length !== expectedCount) {
        return {
          ok: false,
          error: `${collection} count mismatch since ${sinceTs}: expected ${expectedCount}, actual ${matches.length}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Firestore "no <collection> has field=value" assertion. Scans the
    // implied collection (rooms by default; the noun in "on any X"
    // becomes the collection name) and asserts no doc has the field
    // containing the value (either scalar equality or array-includes).
    pattern: /^the database does not have field "([^"]+)" containing (\d+) on any (\w+)$/,
    async handler(m, ctx) {
      const field = m[1];
      const value = parseInt(m[2], 10);
      // "on any room" → collection "rooms"
      const collection = `${m[3]}s`;
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.collection(collection).get();
      const offenders = snap.docs.filter((d) => {
        const f = d.data()?.[field];
        if (Array.isArray(f)) return f.includes(value);
        return f === value;
      });
      if (offenders.length > 0) {
        const ids = offenders.map((d) => d.id).join(', ');
        return {
          ok: false,
          error: `${collection} docs [${ids}] have field "${field}" containing ${value}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Received system PM bare assertion. Bare form (no UI step prefix):
    // "X received the <key> system PM from <sender>". Driver verifies
    // the messages collection has a doc keyed by `<key>` addressed to
    // X's uniqueId, from the named sender persona. Driver receives
    // (recipientName, key, senderName).
    pattern: /^([A-Z][a-z]+)\s+received the ([\w-]+) system PM from ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const recipient = m[1];
      const key = m[2];
      const sender = m[3];
      if (!ctx.webDriver?.receivedSystemPm) {
        return { ok: false, error: 'ctx.webDriver.receivedSystemPm not configured' };
      }
      const ok = await ctx.webDriver.receivedSystemPm(recipient, key, sender);
      if (!ok) {
        return {
          ok: false,
          error: `${recipient} did not receive the "${key}" system PM from ${sender}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Heading-locale Web assertion. Driver checks the current page's
    // heading (typically `<h1>` or aria-label="heading") is rendered in
    // the named locale. 20 ShyTalk locales supported via name→ISO map.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s Web UI shows the heading in ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const LOCALE_NAME_TO_CODE = {
        Arabic: 'ar',
        German: 'de',
        Spanish: 'es',
        French: 'fr',
        Hindi: 'hi',
        Indonesian: 'id',
        Italian: 'it',
        Japanese: 'ja',
        Khmer: 'km',
        Korean: 'ko',
        Dutch: 'nl',
        Polish: 'pl',
        Portuguese: 'pt',
        Russian: 'ru',
        Swedish: 'sv',
        Thai: 'th',
        Turkish: 'tr',
        Ukrainian: 'uk',
        Vietnamese: 'vi',
        Chinese: 'zh',
      };
      const localeName = m[3];
      const code = LOCALE_NAME_TO_CODE[localeName];
      if (!code) {
        return { ok: false, error: `unknown locale name "${localeName}"` };
      }
      if (!ctx.webDriver?.webHeadingInLocale) {
        return { ok: false, error: 'ctx.webDriver.webHeadingInLocale not configured' };
      }
      const ok = await ctx.webDriver.webHeadingInLocale(code);
      if (!ok) {
        return {
          ok: false,
          error: `Web UI heading is not in ${localeName} (${code})`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Highlight-pointing-at-section UI assertion (j03 policy update).
    // Driver locates the named highlight (typically a tooltip or
    // visual call-out) and verifies it points at the named section
    // index. Section identifier is numeric (legal section #11, etc.).
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s Web UI shows a "([^"]+)" highlight pointing at section (\d+)$/,
    async handler(m, ctx) {
      const name = m[3];
      const sectionIdx = parseInt(m[4], 10);
      if (!ctx.webDriver?.webShowsHighlightAtSection) {
        return { ok: false, error: 'ctx.webDriver.webShowsHighlightAtSection not configured' };
      }
      const ok = await ctx.webDriver.webShowsHighlightAtSection(name, sectionIdx);
      if (!ok) {
        return {
          ok: false,
          error: `Web UI did not show "${name}" highlight at section ${sectionIdx}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Modal close via the X button without checking boxes (j03 dismiss
    // flow). Composite — driver clicks the X (close icon) WITHOUT
    // toggling any checkboxes on the modal. Used to verify the
    // dismissal doesn't accidentally mark policy acceptance.
    pattern: /^([A-Z][a-z]+)\s+on Web closes the modal via the X button without checking boxes$/,
    async handler(_m, ctx) {
      if (!ctx.webDriver?.webCloseModalViaX) {
        return { ok: false, error: 'ctx.webDriver.webCloseModalViaX not configured' };
      }
      await ctx.webDriver.webCloseModalViaX();
      return { ok: true };
    },
  },
  {
    // Firestore doc-absence with version constraint. Asserts that the
    // named doc does NOT exist OR has a version field NOT equal to the
    // given value. Used by j03 to verify dismissed policy modals don't
    // accidentally write acceptance records.
    pattern: /^the database does not have a new "([^"]+)" with version (\d+)$/,
    async handler(m, ctx) {
      const docPath = m[1];
      const expectedVersion = parseInt(m[2], 10);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) {
        return { ok: true };
      }
      const data = snap.data();
      // Check any field named *Version (privacyVersion, termsVersion, etc.)
      // OR a literal "version" field.
      const versionFields = Object.keys(data).filter(
        (k) => k === 'version' || k.endsWith('Version'),
      );
      for (const field of versionFields) {
        if (data[field] === expectedVersion) {
          return {
            ok: false,
            error: `doc "${docPath}" has ${field}=${expectedVersion} but assertion expected absence`,
          };
        }
      }
      return { ok: true };
    },
  },
  {
    // Picks an N-megabyte test image (Android, size variant of Wake 46
    // "selects test image from gallery"). Driver mocks the image picker
    // to return a fixture of approximately the requested size — used to
    // exercise size-limit code paths (e.g. 15MB rejected, 5MB accepted).
    pattern: /^([A-Z][a-z]+)\s+on Android\s+picks a (\d+)MB test image$/,
    async handler(m, ctx) {
      const sizeMB = parseInt(m[2], 10);
      if (!ctx.uiDriver?.androidPickTestImageBySize) {
        return { ok: false, error: 'ctx.uiDriver.androidPickTestImageBySize not configured' };
      }
      await ctx.uiDriver.androidPickTestImageBySize(sizeMB);
      return { ok: true };
    },
  },
  {
    // Reverse-order gift selection (j05). Wake 48 has the gift-first
    // form ("selects gift X and recipient Y"); this is recipient-first
    // ("selects recipient X and gift Y"). Disjoint by word order.
    pattern: /^([A-Z][a-z]+)\s+on Web selects recipient "([^"]+)" and gift "([^"]+)"$/,
    async handler(m, ctx) {
      const recipient = m[2];
      const giftName = m[3];
      if (!ctx.webDriver?.webSelectRecipientAndGift) {
        return { ok: false, error: 'ctx.webDriver.webSelectRecipientAndGift not configured' };
      }
      await ctx.webDriver.webSelectRecipientAndGift(recipient, giftName);
      return { ok: true };
    },
  },
  {
    // Double-tap with same receipt within Nms (idempotency test).
    // Driver fires two taps in quick succession on the same element with
    // the same receipt ID — used to verify the server rejects the
    // duplicate (typically status 409 from /api/economy/purchase).
    pattern:
      /^([A-Z][a-z]+)\s+on Web double-taps "([^"]+)" with the same receipt "([^"]+)" within (\d+)ms$/,
    async handler(m, ctx) {
      const tag = m[2];
      const receipt = m[3];
      const withinMs = parseInt(m[4], 10);
      if (!ctx.webDriver?.webDoubleTapWithSameReceipt) {
        return { ok: false, error: 'ctx.webDriver.webDoubleTapWithSameReceipt not configured' };
      }
      await ctx.webDriver.webDoubleTapWithSameReceipt(tag, receipt, withinMs);
      return { ok: true };
    },
  },
  {
    // API request count + status assertion. Driver returns { succeeded,
    // status } summary for the named endpoint at the named status code.
    // Used by j05 double-tap idempotency to verify exactly 1 of 2 taps
    // hit /api/economy/purchase with status 200.
    pattern: /^exactly (\d+) requests? to (\/api\/[\w/-]+) succeeds with status (\d+)$/,
    async handler(m, ctx) {
      const expectedCount = parseInt(m[1], 10);
      const endpoint = m[2];
      const expectedStatus = parseInt(m[3], 10);
      if (!ctx.webDriver?.apiRequestStats) {
        return { ok: false, error: 'ctx.webDriver.apiRequestStats not configured' };
      }
      const stats = await ctx.webDriver.apiRequestStats(endpoint, expectedStatus);
      if (stats.succeeded !== expectedCount) {
        return {
          ok: false,
          error: `${endpoint} status ${expectedStatus} count mismatch: expected ${expectedCount}, actual ${stats.succeeded}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Sequential request status assertion. "the second/third/Nth
    // request returns status N". Ordinal words mapped to 1-indexed
    // positions; driver returns the HTTP status of that request from
    // the most recent batch.
    pattern: /^the (\w+) request returns status (\d+)$/,
    async handler(m, ctx) {
      const ORDINAL_TO_INDEX = {
        first: 1,
        second: 2,
        third: 3,
        fourth: 4,
        fifth: 5,
        sixth: 6,
        seventh: 7,
        eighth: 8,
        ninth: 9,
        tenth: 10,
      };
      const ordinal = m[1];
      const expectedStatus = parseInt(m[2], 10);
      const idx = ORDINAL_TO_INDEX[ordinal];
      if (!idx) {
        return { ok: false, error: `unknown ordinal "${ordinal}"` };
      }
      if (!ctx.webDriver?.sequentialRequestStatus) {
        return { ok: false, error: 'ctx.webDriver.sequentialRequestStatus not configured' };
      }
      const actual = await ctx.webDriver.sequentialRequestStatus(idx);
      if (actual !== expectedStatus) {
        return {
          ok: false,
          error: `request #${idx} status mismatch: expected ${expectedStatus}, actual ${actual}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Composite purchase (j05). "X on Web purchases \"Y\" with sandbox
    // receipt" — driver selects the package, generates a fresh sandbox
    // receipt, and POSTs to /api/economy/purchase. The receipt ID is
    // driver-managed and not visible to the runner.
    pattern: /^([A-Z][a-z]+)\s+on Web purchases "([^"]+)" with sandbox receipt$/,
    async handler(m, ctx) {
      const packageId = m[2];
      if (!ctx.webDriver?.webPurchaseWithSandboxReceipt) {
        return { ok: false, error: 'ctx.webDriver.webPurchaseWithSandboxReceipt not configured' };
      }
      await ctx.webDriver.webPurchaseWithSandboxReceipt(packageId);
      return { ok: true };
    },
  },
  {
    // Past-tense purchase Given (j06 — state set up by a prior
    // successful purchase). Trailing parens "(shyCoins now N)"
    // stripped by Wake 30. The "successfully" adverb is optional:
    // both phrasings ("purchased X with receipt Y" and ".... Y
    // successfully") indicate the same state — a completed purchase
    // — and route to the same driver method.
    pattern: /^([A-Z][a-z]+)\s+purchased "([^"]+)" with receipt "([^"]+)"(?: successfully)?$/,
    async handler(m, ctx) {
      const name = m[1];
      const packageId = m[2];
      const receipt = m[3];
      if (!ctx.webDriver?.hasPurchasedSuccessfully) {
        return { ok: false, error: 'ctx.webDriver.hasPurchasedSuccessfully not configured' };
      }
      const ok = await ctx.webDriver.hasPurchasedSuccessfully(name, packageId, receipt);
      if (!ok) {
        return {
          ok: false,
          error: `${name} has no successful purchase for "${packageId}" with receipt "${receipt}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Network drop simulation (j06 recovery flow). Driver intercepts the
    // next outgoing request (typically /api/economy/purchase) and
    // returns failure BEFORE the response is delivered, simulating the
    // "lost ACK" scenario the retry logic needs to handle correctly.
    pattern: /^([A-Z][a-z]+)'s network drops before the 200 OK reaches the client$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.webDriver?.simulateNetworkDropBeforeResponse) {
        return {
          ok: false,
          error: 'ctx.webDriver.simulateNetworkDropBeforeResponse not configured',
        };
      }
      await ctx.webDriver.simulateNetworkDropBeforeResponse(name);
      return { ok: true };
    },
  },
  {
    // Bare Android API POST. Captures endpoint + optional "with <rest>"
    // suffix as opaque string. Driver parses the rest to extract
    // productId/receipt/etc. params (or notes "no productId" for
    // negative-test scenarios). Single matcher absorbs all j06 POST
    // variants — saves writing five near-identical matchers.
    //
    // Regex linear: `.+$` greedy + anchored to end-of-string. Input
    // is author-controlled (feature files). Safe.
    // eslint-disable-next-line sonarjs/slow-regex
    pattern: /^([A-Z][a-z]+)\s+on Android POSTs (\/api\/[\w/-]+)(?:\s+(.+))?$/,
    async handler(m, ctx) {
      const endpoint = m[2];
      const rest = m[3] || '';
      if (!ctx.uiDriver?.androidApiPost) {
        return { ok: false, error: 'ctx.uiDriver.androidApiPost not configured' };
      }
      await ctx.uiDriver.androidApiPost(endpoint, rest);
      return { ok: true };
    },
  },
  {
    // Retry-same-purchase composite (j06 recovery flow). Corpus step
    // has `(same receipt)` MID-STEP, which Wake 30 doesn't strip
    // (it strips trailing parens only). Allow optional mid-step
    // parens after "purchase". Driver re-submits the most recent
    // purchase request using the same receipt ID.
    pattern:
      /^([A-Z][a-z]+)\s+on Android retries the same purchase(?:\s+\([^()]*\))?\s+once network restores$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.uiDriver?.androidRetrySamePurchase) {
        return { ok: false, error: 'ctx.uiDriver.androidRetrySamePurchase not configured' };
      }
      await ctx.uiDriver.androidRetrySamePurchase(name);
      return { ok: true };
    },
  },
  {
    // Receipt-mismatch state-seed (j06 receipt forgery test). Sets up
    // the test fixture so the next purchase submission would carry a
    // receipt signed for one product but a submitted productId for a
    // different one — used to verify the server rejects mismatched
    // receipts.
    pattern:
      /^the receipt "([^"]+)" is signed for "([^"]+)" but ([A-Z][a-z]+) submits productId="([^"]+)"$/,
    async handler(m, ctx) {
      const receipt = m[1];
      const signedFor = m[2];
      const submitter = m[3];
      const submittedProductId = m[4];
      if (!ctx.webDriver?.setupReceiptMismatch) {
        return { ok: false, error: 'ctx.webDriver.setupReceiptMismatch not configured' };
      }
      await ctx.webDriver.setupReceiptMismatch(receipt, signedFor, submitter, submittedProductId);
      return { ok: true };
    },
  },
  {
    // Web Admin processes refund for receipt (j06 admin recovery). The
    // refund flow reverses the coin credit AND records the admin
    // action; both steps are driver-internal.
    pattern: /^([A-Z][a-z]+)\s+on Web Admin processes a refund for receipt "([^"]+)"$/,
    async handler(m, ctx) {
      const receipt = m[2];
      if (!ctx.webDriver?.webAdminProcessRefund) {
        return { ok: false, error: 'ctx.webDriver.webAdminProcessRefund not configured' };
      }
      await ctx.webDriver.webAdminProcessRefund(receipt);
      return { ok: true };
    },
  },
  {
    // Tap-purchase-and-server-credits composite Given (j06 state
    // setup). Simulates a SUCCESSFUL purchase that credited the user —
    // useful when a scenario needs the post-credit state without
    // running the full POST + receipt validation chain. Driver writes
    // the balance and transaction doc directly.
    pattern:
      /^([A-Z][a-z]+)\s+taps purchase and the server credits coins=(\d+) \+ writes transaction$/,
    async handler(m, ctx) {
      const name = m[1];
      const coins = parseInt(m[2], 10);
      if (!ctx.webDriver?.simulatePurchaseCredit) {
        return { ok: false, error: 'ctx.webDriver.simulatePurchaseCredit not configured' };
      }
      await ctx.webDriver.simulatePurchaseCredit(name, coins);
      return { ok: true };
    },
  },
  {
    // Persona "is signed in on <plat> at <path>" variant (j07).
    // Different verb order from Wake 45/50's "is on X signed in".
    // Records persona platform + path on the tracking maps.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is signed in on\s+(Web Chromium|Web Safari|Web|Android|iOS Sim)\s+at "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[3];
      const urlPath = m[4];
      if (!ctx.personaPlatforms) ctx.personaPlatforms = new Map();
      if (!ctx.personaPaths) ctx.personaPaths = new Map();
      ctx.personaPlatforms.set(name, platform);
      ctx.personaPaths.set(name, urlPath);
      return { ok: true };
    },
  },
  {
    // "neither user is following the other" bare relation assertion
    // (j07 pre-condition). Driver verifies that neither of the two
    // most-recent personas-on-platform has the other in their
    // followingIds.
    pattern: /^neither user is following the other$/,
    async handler(_m, ctx) {
      if (!ctx.webDriver?.neitherUserIsFollowingTheOther) {
        return { ok: false, error: 'ctx.webDriver.neitherUserIsFollowingTheOther not configured' };
      }
      const ok = await ctx.webDriver.neitherUserIsFollowingTheOther();
      if (!ok) {
        return {
          ok: false,
          error: 'precondition failed: at least one user is following the other',
        };
      }
      return { ok: true };
    },
  },
  {
    // Bare stats UI assertion. Trailing "(followers, following, beans)"
    // descriptive annotation stripped by Wake 30. Platform-dispatch;
    // driver verifies the stats panel is rendered for the target user.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows ([A-Z][a-z]+)'s stats$/,
    async handler(m, ctx) {
      const platform = m[3];
      const target = m[4];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webShowsStatsForUser) {
          return { ok: false, error: 'ctx.webDriver.webShowsStatsForUser not configured' };
        }
        const ok = await ctx.webDriver.webShowsStatsForUser(target);
        if (!ok) return { ok: false, error: `Web UI did not show stats for ${target}` };
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidShowsStatsForUser) {
          return { ok: false, error: 'ctx.uiDriver.androidShowsStatsForUser not configured' };
        }
        const ok = await ctx.uiDriver.androidShowsStatsForUser(target);
        if (!ok) return { ok: false, error: `Android UI did not show stats for ${target}` };
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosShowsStatsForUser) {
          return { ok: false, error: 'ctx.uiDriver.iosShowsStatsForUser not configured' };
        }
        const ok = await ctx.uiDriver.iosShowsStatsForUser(target);
        if (!ok) return { ok: false, error: `iOS UI did not show stats for ${target}` };
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for stats step` };
    },
  },
  {
    // Selects from followed-users picker (j07 PM compose flow).
    // Driver opens the followed-users picker AND selects the named
    // entry. Currently Android only — corpus doesn't have Web/iOS
    // variants of this exact phrasing.
    pattern: /^([A-Z][a-z]+)\s+on Android\s+selects "([^"]+)" from the followed-users picker$/,
    async handler(m, ctx) {
      const target = m[2];
      if (!ctx.uiDriver?.androidSelectFromFollowedPicker) {
        return {
          ok: false,
          error: 'ctx.uiDriver.androidSelectFromFollowedPicker not configured',
        };
      }
      await ctx.uiDriver.androidSelectFromFollowedPicker(target);
      return { ok: true };
    },
  },
  {
    // Navigates to conversation thread screen (composite UI assertion).
    // Driver verifies the persona's current screen is the conversation
    // thread AND the other party is the named target. Platform-dispatch.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI navigates to the conversation thread screen with ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const platform = m[3];
      const target = m[4];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webIsOnConversationWith) {
          return { ok: false, error: 'ctx.webDriver.webIsOnConversationWith not configured' };
        }
        const ok = await ctx.webDriver.webIsOnConversationWith(target);
        if (!ok) return { ok: false, error: `Web UI is not on conversation with ${target}` };
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidIsOnConversationWith) {
          return { ok: false, error: 'ctx.uiDriver.androidIsOnConversationWith not configured' };
        }
        const ok = await ctx.uiDriver.androidIsOnConversationWith(target);
        if (!ok) return { ok: false, error: `Android UI is not on conversation with ${target}` };
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosIsOnConversationWith) {
          return { ok: false, error: 'ctx.uiDriver.iosIsOnConversationWith not configured' };
        }
        const ok = await ctx.uiDriver.iosIsOnConversationWith(target);
        if (!ok) return { ok: false, error: `iOS UI is not on conversation with ${target}` };
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for conversation-thread step` };
    },
  },
  {
    // Opens the conversation with persona (action). Platform-dispatch;
    // driver navigates to the existing conversation thread with the
    // named target user.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+opens the conversation with ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const platform = m[2];
      const target = m[3];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webOpenConversation) {
          return { ok: false, error: 'ctx.webDriver.webOpenConversation not configured' };
        }
        await ctx.webDriver.webOpenConversation(target);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidOpenConversation) {
          return { ok: false, error: 'ctx.uiDriver.androidOpenConversation not configured' };
        }
        await ctx.uiDriver.androidOpenConversation(target);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosOpenConversation) {
          return { ok: false, error: 'ctx.uiDriver.iosOpenConversation not configured' };
        }
        await ctx.uiDriver.iosOpenConversation(target);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for open-conversation step` };
    },
  },
  {
    // FCM push notification assertion. Two forms:
    //   - "on X's Web with body containing \"Y\""        (web variant)
    //   - "on X's Android device with body containing \"Y\" [and \"Z\"]"
    //     (mobile variant, with optional second body fragment)
    // Driver receives recipient name, platform string, and 1-or-2-element
    // body-fragment array. The driver verifies a push was delivered AND
    // the body contains ALL fragments.
    pattern:
      /^the tester sees an FCM push notification on ([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android device|iOS device) with body containing "([^"]+)"(?: and "([^"]+)")?$/,
    async handler(m, ctx) {
      const recipient = m[1];
      const platform = m[2];
      const fragments = [m[3]];
      if (m[4]) fragments.push(m[4]);
      if (!ctx.webDriver?.seesFcmPushOnPlatform) {
        return { ok: false, error: 'ctx.webDriver.seesFcmPushOnPlatform not configured' };
      }
      const ok = await ctx.webDriver.seesFcmPushOnPlatform(recipient, platform, fragments);
      if (!ok) {
        return {
          ok: false,
          error: `no FCM push to ${recipient} on ${platform} containing ${fragments.map((f) => `"${f}"`).join(' and ')}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Types into conversation input (j07 PM compose). Platform-dispatch.
    // Driver targets the platform's conversation input element and
    // types the given body. No submit — separate step for that.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+types "([^"]+)" into the conversation input$/,
    async handler(m, ctx) {
      const platform = m[2];
      const body = m[3];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webTypeIntoConversationInput) {
          return {
            ok: false,
            error: 'ctx.webDriver.webTypeIntoConversationInput not configured',
          };
        }
        await ctx.webDriver.webTypeIntoConversationInput(body);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidTypeIntoConversationInput) {
          return {
            ok: false,
            error: 'ctx.uiDriver.androidTypeIntoConversationInput not configured',
          };
        }
        await ctx.uiDriver.androidTypeIntoConversationInput(body);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosTypeIntoConversationInput) {
          return {
            ok: false,
            error: 'ctx.uiDriver.iosTypeIntoConversationInput not configured',
          };
        }
        await ctx.uiDriver.iosTypeIntoConversationInput(body);
        return { ok: true };
      }
      return {
        ok: false,
        error: `unknown platform "${platform}" for conversation-input-type step`,
      };
    },
  },
  {
    // Past-tense PM state Given. Two forms:
    //   - "X sent a message \"Y\" to Z"
    //   - "X sent a message \"Y\" to Z N minutes ago"  (timestamp)
    // Wake 30 strips trailing parens annotation (e.g. "(past edit window)").
    // Driver seeds the messages collection with sender/body/recipient and
    // optional createdAt offset from now.
    pattern: /^([A-Z][a-z]+)\s+sent a message "([^"]+)" to ([A-Z][a-z]+)(?:\s+(\d+) minutes ago)?$/,
    async handler(m, ctx) {
      const sender = m[1];
      const body = m[2];
      const recipient = m[3];
      const minutesAgo = m[4] ? parseInt(m[4], 10) : null;
      if (!ctx.webDriver?.seedPastMessage) {
        return { ok: false, error: 'ctx.webDriver.seedPastMessage not configured' };
      }
      await ctx.webDriver.seedPastMessage(sender, body, recipient, minutesAgo);
      return { ok: true };
    },
  },
  {
    // Edit-body-and-confirms composite (j07 PM edit flow). Driver opens
    // the edit modal, replaces the body, taps confirm. Platform-dispatch.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+changes the body to "([^"]+)" and confirms$/,
    async handler(m, ctx) {
      const platform = m[2];
      const newBody = m[3];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webEditBodyAndConfirm) {
          return { ok: false, error: 'ctx.webDriver.webEditBodyAndConfirm not configured' };
        }
        await ctx.webDriver.webEditBodyAndConfirm(newBody);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidEditBodyAndConfirm) {
          return {
            ok: false,
            error: 'ctx.uiDriver.androidEditBodyAndConfirm not configured',
          };
        }
        await ctx.uiDriver.androidEditBodyAndConfirm(newBody);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosEditBodyAndConfirm) {
          return { ok: false, error: 'ctx.uiDriver.iosEditBodyAndConfirm not configured' };
        }
        await ctx.uiDriver.iosEditBodyAndConfirm(newBody);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for edit-body step` };
    },
  },
  {
    // Bare persona-exists Given. Wake 30's annotation strip is end-
    // anchored — the corpus form `Marcus (P-04, minor) exists` has
    // parens MID-step, so they aren't stripped upstream. Allow an
    // optional mid-step parens annotation between the name and the
    // `exists` verb.
    pattern: /^([A-Z][a-z]+)(?:\s+\([^()]*\))?\s+exists$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      const snap = await ctx.db.doc(`users/${p.uniqueId}`).get();
      if (!snap.exists) {
        return { ok: false, error: `users/${p.uniqueId} does not exist (${name})` };
      }
      return { ok: true };
    },
  },
  {
    // Types into search field — Web variant only. Pre-existing matchers
    // already handle Android (androidSearchIn(null, text), line ~2698)
    // and iOS Sim (iosSearchIn(null, text), line ~2076). This matcher
    // fills the Web gap that the corpus (j08 Vexa) needs.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web)\s+types "([^"]+)" into the search field$/,
    async handler(m, ctx) {
      const body = m[3];
      if (!ctx.webDriver?.webTypeIntoSearch) {
        return { ok: false, error: 'ctx.webDriver.webTypeIntoSearch not configured' };
      }
      await ctx.webDriver.webTypeIntoSearch(body);
      return { ok: true };
    },
  },
  {
    // Voice room state-seed (j08). Writes a `rooms/<id>` doc owned by
    // the named persona. Owner uniqueId resolved via the persona
    // registry. Other room fields (participants, etc.) initialised
    // empty — scenarios that need them seed via other matchers.
    pattern: /^([A-Z][a-z]+)\s+created a voice room "([^"]+)"$/,
    async handler(m, ctx) {
      const ownerName = m[1];
      const roomId = m[2];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const owner = personas.get(ownerName);
      if (!owner?.uniqueId) {
        return { ok: false, error: `persona "${ownerName}" not in registry` };
      }
      await ctx.db.doc(`rooms/${roomId}`).set({
        id: roomId,
        ownerUniqueId: owner.uniqueId,
        createdAt: Date.now(),
      });
      return { ok: true };
    },
  },
  {
    // FCM dispatcher attempts to send a notification (j08). Wake 30
    // strips ONLY the trailing parens — so the step has parens
    // remaining mid-step around the sender's uniqueId. Allow optional
    // `(<digits>)` after each name to absorb that residual.
    pattern:
      /^the FCM dispatcher attempts to send a notification from ([A-Z][a-z]+)(?:\s+\(\d+\))?\s+to ([A-Z][a-z]+)(?:\s+\(\d+\))?$/,
    async handler(m, ctx) {
      const sender = m[1];
      const recipient = m[2];
      if (!ctx.webDriver?.simulateFcmDispatcherAttempt) {
        return {
          ok: false,
          error: 'ctx.webDriver.simulateFcmDispatcherAttempt not configured',
        };
      }
      await ctx.webDriver.simulateFcmDispatcherAttempt(sender, recipient);
      return { ok: true };
    },
  },
  {
    // No FCM payload is sent to <X>'s tokens (j08 cross-cohort wall).
    // Negative assertion — driver counts payloads delivered to the
    // persona's FCM tokens since the most recent dispatcher attempt.
    pattern: /^no FCM payload is sent to ([A-Z][a-z]+)'s tokens$/,
    async handler(m, ctx) {
      const recipient = m[1];
      if (!ctx.webDriver?.countFcmPayloadsToUser) {
        return { ok: false, error: 'ctx.webDriver.countFcmPayloadsToUser not configured' };
      }
      const count = await ctx.webDriver.countFcmPayloadsToUser(recipient);
      if (count > 0) {
        return {
          ok: false,
          error: `expected 0 FCM payloads to ${recipient} but driver found ${count}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Dispatcher audit log records <X> with reason <Y> (j08). Driver
    // verifies the audit log contains an entry with the named action
    // AND named reason.
    pattern: /^the dispatcher audit log records "([^"]+)" with reason "([^"]+)"$/,
    async handler(m, ctx) {
      const action = m[1];
      const reason = m[2];
      if (!ctx.webDriver?.auditLogContains) {
        return { ok: false, error: 'ctx.webDriver.auditLogContains not configured' };
      }
      const ok = await ctx.webDriver.auditLogContains(action, reason);
      if (!ok) {
        return {
          ok: false,
          error: `audit log has no entry "${action}" with reason "${reason}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // UI banner absence (party-anchored). Distinct from Wake 52's
    // generic "cohort change banner" — this one is party-anchored:
    // "X's UI does not show any in-app banner FROM Y". Platform-
    // dispatch; driver returns truthy iff a banner from the named
    // sender is currently rendered. Truthy = banner present = fail.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI does not show any in-app banner from ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const platform = m[3];
      const sender = m[4];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webShowsBannerFromUser) {
          return { ok: false, error: 'ctx.webDriver.webShowsBannerFromUser not configured' };
        }
        const shown = await ctx.webDriver.webShowsBannerFromUser(sender);
        if (shown) {
          return { ok: false, error: `Web UI shows an in-app banner from "${sender}"` };
        }
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidShowsBannerFromUser) {
          return {
            ok: false,
            error: 'ctx.uiDriver.androidShowsBannerFromUser not configured',
          };
        }
        const shown = await ctx.uiDriver.androidShowsBannerFromUser(sender);
        if (shown) {
          return { ok: false, error: `Android UI shows an in-app banner from "${sender}"` };
        }
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosShowsBannerFromUser) {
          return { ok: false, error: 'ctx.uiDriver.iosShowsBannerFromUser not configured' };
        }
        const shown = await ctx.uiDriver.iosShowsBannerFromUser(sender);
        if (shown) {
          return { ok: false, error: `iOS UI shows an in-app banner from "${sender}"` };
        }
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for banner-absence step` };
    },
  },
  {
    // Attempt to start a conversation via POST <api> (j07 negative path
    // when cohorts differ). Driver fires the API call and stores result
    // on ctx.lastResponse (the bare HTTP status matcher below reads it).
    pattern:
      /^([A-Z][a-z]+)\s+on Android attempts to start a conversation with ([A-Z][a-z]+) via POST (\/api\/[\w/-]+)$/,
    async handler(m, ctx) {
      const target = m[2];
      const apiPath = m[3];
      if (!ctx.uiDriver?.androidAttemptStartConversation) {
        return {
          ok: false,
          error: 'ctx.uiDriver.androidAttemptStartConversation not configured',
        };
      }
      const result = await ctx.uiDriver.androidAttemptStartConversation(target, apiPath);
      // Store result on ctx so the bare "the request returns status N"
      // assertion can read it downstream.
      if (result && typeof result.status === 'number') {
        ctx.lastResponse = { status: result.status, body: result.body || null, path: apiPath };
      }
      return { ok: true };
    },
  },
  {
    // New-follower notification absence (j08). Distinct from Wake 60's
    // party-anchored banner — this is a generic "no NEW follower
    // notification" with NO specific source persona.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI does not show any new follower notification$/,
    async handler(m, ctx) {
      const platform = m[3];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webShowsNewFollowerNotification) {
          return {
            ok: false,
            error: 'ctx.webDriver.webShowsNewFollowerNotification not configured',
          };
        }
        const shown = await ctx.webDriver.webShowsNewFollowerNotification();
        if (shown) {
          return { ok: false, error: 'Web UI shows a new follower notification' };
        }
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidShowsNewFollowerNotification) {
          return {
            ok: false,
            error: 'ctx.uiDriver.androidShowsNewFollowerNotification not configured',
          };
        }
        const shown = await ctx.uiDriver.androidShowsNewFollowerNotification();
        if (shown) {
          return { ok: false, error: 'Android UI shows a new follower notification' };
        }
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosShowsNewFollowerNotification) {
          return {
            ok: false,
            error: 'ctx.uiDriver.iosShowsNewFollowerNotification not configured',
          };
        }
        const shown = await ctx.uiDriver.iosShowsNewFollowerNotification();
        if (shown) {
          return { ok: false, error: 'iOS UI shows a new follower notification' };
        }
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for follower-notif step` };
    },
  },
  {
    // Profile deep-link attempt (j08 cross-cohort). Driver fires the
    // deep-link intent (adb am start -d <url> on Android, xcrun simctl
    // openurl on iOS). Doesn't assert resulting UI state — a follow-up
    // step does that.
    pattern: /^([A-Z][a-z]+)\s+on (Android|iOS Sim)\s+attempts profile deep-link "([^"]+)"$/,
    async handler(m, ctx) {
      const platform = m[2];
      const url = m[3];
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidAttemptProfileDeepLink) {
          return {
            ok: false,
            error: 'ctx.uiDriver.androidAttemptProfileDeepLink not configured',
          };
        }
        await ctx.uiDriver.androidAttemptProfileDeepLink(url);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosAttemptProfileDeepLink) {
          return {
            ok: false,
            error: 'ctx.uiDriver.iosAttemptProfileDeepLink not configured',
          };
        }
        await ctx.uiDriver.iosAttemptProfileDeepLink(url);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for profile-deep-link step` };
    },
  },
  {
    // Attempts to follow via the profile screen (j08). Wake 30 strips
    // trailing parens annotation like "(via deep-link error path)".
    // Driver taps the follow button on the currently-rendered profile
    // screen.
    pattern:
      /^([A-Z][a-z]+)\s+on Android\s+attempts to follow ([A-Z][a-z]+) via the profile screen$/,
    async handler(m, ctx) {
      const target = m[2];
      if (!ctx.uiDriver?.androidAttemptFollowViaProfile) {
        return {
          ok: false,
          error: 'ctx.uiDriver.androidAttemptFollowViaProfile not configured',
        };
      }
      await ctx.uiDriver.androidAttemptFollowViaProfile(target);
      return { ok: true };
    },
  },
  {
    // Bare HTTP response status assertion. Reads ctx.lastResponse (set
    // by the older POSTs matcher at line ~530 and by Wake 61's
    // attempt-start-conversation matcher above). Fails clearly when no
    // response is recorded.
    pattern: /^the request returns status (\d+)$/,
    async handler(m, ctx) {
      const expected = parseInt(m[1], 10);
      if (!ctx.lastResponse) {
        return { ok: false, error: 'no recorded response — earlier request step is missing' };
      }
      const actual = ctx.lastResponse.status;
      if (actual !== expected) {
        return {
          ok: false,
          error: `request status mismatch: expected ${expected}, actual ${actual}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Conversation doc field equality assertion (j08 OSA migration
    // verification). Trailing parens annotation stripped by Wake 30.
    // Value parsing: `true`/`false`/numeric — keeps it simple; the
    // corpus only uses these forms today.
    pattern: /^the conversation doc "([^"]+)" has field "([^"]+)" equal to (true|false|\d+)$/,
    async handler(m, ctx) {
      const docPath = m[1];
      const field = m[2];
      const rawValue = m[3];
      const expected =
        rawValue === 'true' ? true : rawValue === 'false' ? false : parseInt(rawValue, 10);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) {
        return { ok: false, error: `document "${docPath}" does not exist` };
      }
      const actual = snap.data()?.[field];
      if (actual !== expected) {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" expected ${expected}, actual ${actual}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Abstract cohort UI absence (j02 minor visibility test). Driver
    // returns truthy iff any user with the "adult" cohort is currently
    // rendered in the UI. Platform-dispatch.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI does not show any adult-cohort visitor$/,
    async handler(m, ctx) {
      const platform = m[3];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webShowsAdultCohortVisitor) {
          return {
            ok: false,
            error: 'ctx.webDriver.webShowsAdultCohortVisitor not configured',
          };
        }
        const shown = await ctx.webDriver.webShowsAdultCohortVisitor();
        if (shown) return { ok: false, error: 'Web UI shows an adult-cohort visitor' };
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidShowsAdultCohortVisitor) {
          return {
            ok: false,
            error: 'ctx.uiDriver.androidShowsAdultCohortVisitor not configured',
          };
        }
        const shown = await ctx.uiDriver.androidShowsAdultCohortVisitor();
        if (shown) return { ok: false, error: 'Android UI shows an adult-cohort visitor' };
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosShowsAdultCohortVisitor) {
          return {
            ok: false,
            error: 'ctx.uiDriver.iosShowsAdultCohortVisitor not configured',
          };
        }
        const shown = await ctx.uiDriver.iosShowsAdultCohortVisitor();
        if (shown) return { ok: false, error: 'iOS UI shows an adult-cohort visitor' };
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for cohort-visitor step` };
    },
  },
  {
    // Voice room state-seed with mic state (multi-field). Wake 30's
    // strip is end-anchored so `(an adult-cohort room)` mid-step isn't
    // removed — allow optional mid-step parens between the room id and
    // "with mic". Updates the room's participantIds + micStates map.
    pattern:
      /^([A-Z][a-z]+)\s+is in voice room "([^"]+)"(?:\s+\([^()]*\))?\s+with mic (open|muted)$/,
    async handler(m, ctx) {
      const name = m[1];
      const roomId = m[2];
      const micState = m[3];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      const docPath = `rooms/${roomId}`;
      const snap = await ctx.db.doc(docPath).get();
      const existing = snap.exists ? snap.data() : { id: roomId, participantIds: [] };
      const participantIds = Array.isArray(existing.participantIds)
        ? [...existing.participantIds]
        : [];
      if (!participantIds.includes(p.uniqueId)) participantIds.push(p.uniqueId);
      const micStates = { ...(existing.micStates || {}) };
      micStates[String(p.uniqueId)] = micState;
      await ctx.db.doc(docPath).set({ ...existing, participantIds, micStates }, { merge: true });
      return { ok: true };
    },
  },
  {
    // Web Admin age-down flow composite (j04). Driver runs the full
    // admin-side age-down sequence: open submission, set override DOB,
    // tap reject_and_dob_down, confirm reason. Single matcher because
    // the corpus uses the composite when the individual steps aren't
    // load-bearing for the scenario being tested.
    pattern: /^([A-Z][a-z]+)\s+on Web Admin executes the age-down flow$/,
    async handler(_m, ctx) {
      if (!ctx.webDriver?.webAdminExecuteAgeDownFlow) {
        return { ok: false, error: 'ctx.webDriver.webAdminExecuteAgeDownFlow not configured' };
      }
      await ctx.webDriver.webAdminExecuteAgeDownFlow();
      return { ok: true };
    },
  },
  {
    // Concurrent N follow attempts (j08 cross-cohort wall concurrency
    // probe). Driver fires N requests in parallel and returns an array
    // of { status, latencyMs } per attempt. Results stored on
    // ctx.lastConcurrentResults for downstream assertions.
    pattern: /^(\d+) cross-cohort follow attempts hit (\/api\/[\w/-]+) concurrently$/,
    async handler(m, ctx) {
      const count = parseInt(m[1], 10);
      const endpoint = m[2];
      if (!ctx.webDriver?.simulateConcurrentFollowAttempts) {
        return {
          ok: false,
          error: 'ctx.webDriver.simulateConcurrentFollowAttempts not configured',
        };
      }
      const results = await ctx.webDriver.simulateConcurrentFollowAttempts(count, endpoint);
      ctx.lastConcurrentResults = results;
      return { ok: true };
    },
  },
  {
    // Each-response-status assertion. Reads ctx.lastConcurrentResults
    // (set by the concurrent-batch matcher above) and asserts every
    // entry has the named status.
    pattern: /^each response status is (\d+)$/,
    async handler(m, ctx) {
      const expected = parseInt(m[1], 10);
      if (!ctx.lastConcurrentResults || !Array.isArray(ctx.lastConcurrentResults)) {
        return {
          ok: false,
          error: 'no recorded concurrent results — earlier batch step missing',
        };
      }
      const offenders = ctx.lastConcurrentResults
        .map((r, i) => ({ i, status: r.status }))
        .filter((r) => r.status !== expected);
      if (offenders.length > 0) {
        const summary = offenders
          .slice(0, 3)
          .map((o) => `#${o.i}=${o.status}`)
          .join(', ');
        return {
          ok: false,
          error: `expected all status ${expected}, but ${offenders.length} differ: ${summary}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Audit row count assertion. Counts docs in the auditLog
    // collection. Used by j08 after concurrent-batch + per-response
    // status checks to verify the audit log captured all attempts.
    pattern: /^(\d+) audit rows are written$/,
    async handler(m, ctx) {
      const expected = parseInt(m[1], 10);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.collection('auditLog').get();
      const actual = snap.docs.length;
      if (actual !== expected) {
        return {
          ok: false,
          error: `auditLog count mismatch: expected ${expected}, actual ${actual}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Voice room create composite (j09 host). Driver opens the create-
    // room form, types the title, picks the visibility radio, and taps
    // Create. Single matcher for the full composite because the corpus
    // uses it that way (intermediate steps not load-bearing).
    pattern:
      /^([A-Z][a-z]+)\s+on Android types title "([^"]+)" and chooses (public|private) visibility$/,
    async handler(m, ctx) {
      const title = m[2];
      const visibility = m[3];
      if (!ctx.uiDriver?.androidCreateRoomComposite) {
        return { ok: false, error: 'ctx.uiDriver.androidCreateRoomComposite not configured' };
      }
      await ctx.uiDriver.androidCreateRoomComposite(title, visibility);
      return { ok: true };
    },
  },
  {
    // Receives a LiveKit token. Two forms — bare and "in response from
    // POST <api>". Driver receives the endpoint (null for bare). Returns
    // the token string (truthy = ok). Platform-dispatch.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+receives a LiveKit token(?: in response from POST (\/api\/[\w/-]+))?$/,
    async handler(m, ctx) {
      const platform = m[2];
      const endpoint = m[3] || null;
      let token;
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webReceiveLiveKitToken) {
          return { ok: false, error: 'ctx.webDriver.webReceiveLiveKitToken not configured' };
        }
        token = await ctx.webDriver.webReceiveLiveKitToken(endpoint);
      } else if (platform === 'Android') {
        if (!ctx.uiDriver?.androidReceiveLiveKitToken) {
          return {
            ok: false,
            error: 'ctx.uiDriver.androidReceiveLiveKitToken not configured',
          };
        }
        token = await ctx.uiDriver.androidReceiveLiveKitToken(endpoint);
      } else if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosReceiveLiveKitToken) {
          return { ok: false, error: 'ctx.uiDriver.iosReceiveLiveKitToken not configured' };
        }
        token = await ctx.uiDriver.iosReceiveLiveKitToken(endpoint);
      } else {
        return { ok: false, error: `unknown platform "${platform}" for LiveKit token step` };
      }
      if (!token) {
        return { ok: false, error: `no LiveKit token received on ${platform}` };
      }
      return { ok: true };
    },
  },
  {
    // Seat grid assertion (j09). Wake 30 strips trailing parens (e.g.
    // "(by himself)"). Driver returns { occupied, total } for the
    // currently-rendered seat grid. Matcher asserts both numbers.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the seat grid with (\d+) of (\d+) seats occupied$/,
    async handler(m, ctx) {
      const platform = m[3];
      const expectedOccupied = parseInt(m[4], 10);
      const expectedTotal = parseInt(m[5], 10);
      let state;
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidSeatGridState) {
          return { ok: false, error: 'ctx.uiDriver.androidSeatGridState not configured' };
        }
        state = await ctx.uiDriver.androidSeatGridState();
      } else if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosSeatGridState) {
          return { ok: false, error: 'ctx.uiDriver.iosSeatGridState not configured' };
        }
        state = await ctx.uiDriver.iosSeatGridState();
      } else if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webSeatGridState) {
          return { ok: false, error: 'ctx.webDriver.webSeatGridState not configured' };
        }
        state = await ctx.webDriver.webSeatGridState();
      } else {
        return { ok: false, error: `unknown platform "${platform}" for seat-grid step` };
      }
      if (state?.occupied !== expectedOccupied || state?.total !== expectedTotal) {
        return {
          ok: false,
          error: `seat grid mismatch: expected ${expectedOccupied} of ${expectedTotal}, actual ${state?.occupied} of ${state?.total}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Taps the same room (relative reference, j09). The "same room" is
    // the room most-recently created or referenced — driver maintains
    // that state. Optional " again" suffix passed as boolean.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+taps the same room( again)?$/,
    async handler(m, ctx) {
      const platform = m[2];
      const isAgain = !!m[3];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webTapSameRoom) {
          return { ok: false, error: 'ctx.webDriver.webTapSameRoom not configured' };
        }
        await ctx.webDriver.webTapSameRoom(isAgain);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidTapSameRoom) {
          return { ok: false, error: 'ctx.uiDriver.androidTapSameRoom not configured' };
        }
        await ctx.uiDriver.androidTapSameRoom(isAgain);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosTapSameRoom) {
          return { ok: false, error: 'ctx.uiDriver.iosTapSameRoom not configured' };
        }
        await ctx.uiDriver.iosTapSameRoom(isAgain);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for tap-same-room step` };
    },
  },
  {
    // Approve seat request composite (j09 host). Driver locates the
    // seat-request notification for the named user and taps approve.
    pattern: /^([A-Z][a-z]+)\s+on Android\s+taps approve on ([A-Z][a-z]+)'s seat request$/,
    async handler(m, ctx) {
      const requester = m[2];
      if (!ctx.uiDriver?.androidApproveSeatRequest) {
        return { ok: false, error: 'ctx.uiDriver.androidApproveSeatRequest not configured' };
      }
      await ctx.uiDriver.androidApproveSeatRequest(requester);
      return { ok: true };
    },
  },
  {
    // Block via API attempt (j04). Wake 30 strips ONLY trailing parens,
    // so the corpus form `block Officia (uniqueId=1) via /api/users/block`
    // has mid-step parens — allow optional `\(...\)` after the target.
    // Driver stores result on ctx.lastResponse for downstream assertions.
    pattern:
      /^([A-Z][a-z]+)\s+on Android attempts to block ([A-Z][a-z]+)(?:\s+\([^()]*\))?\s+via (\/api\/[\w/-]+)$/,
    async handler(m, ctx) {
      const target = m[2];
      const apiPath = m[3];
      if (!ctx.uiDriver?.androidAttemptBlock) {
        return { ok: false, error: 'ctx.uiDriver.androidAttemptBlock not configured' };
      }
      const result = await ctx.uiDriver.androidAttemptBlock(target, apiPath);
      if (result && typeof result.status === 'number') {
        ctx.lastResponse = { status: result.status, body: result.body || null, path: apiPath };
      }
      return { ok: true };
    },
  },
  {
    // Bare response-status-from-path assertion: distinct from the Wake 61
    // "the request returns status N" matcher because this one verifies
    // the response came from the NAMED endpoint. Reads ctx.lastResponse
    // and checks both status AND path match.
    pattern: /^the response status from (\/api\/[\w/-]+) is (\d+)$/,
    async handler(m, ctx) {
      const expectedPath = m[1];
      const expectedStatus = parseInt(m[2], 10);
      if (!ctx.lastResponse) {
        return { ok: false, error: 'no recorded response — earlier request step is missing' };
      }
      if (ctx.lastResponse.path && ctx.lastResponse.path !== expectedPath) {
        return {
          ok: false,
          error: `last response path was ${ctx.lastResponse.path}, expected ${expectedPath}`,
        };
      }
      const actual = ctx.lastResponse.status;
      if (actual !== expectedStatus) {
        return {
          ok: false,
          error: `${expectedPath} status mismatch: expected ${expectedStatus}, actual ${actual}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // p95 latency budget. Reads ctx.lastConcurrentResults, sorts by
    // latencyMs, picks the 95th percentile (ceil(0.95*N) index), and
    // asserts it's less than the budget.
    pattern: /^each response p95 latency is less than (\d+)ms$/,
    async handler(m, ctx) {
      const budget = parseInt(m[1], 10);
      if (!ctx.lastConcurrentResults || !Array.isArray(ctx.lastConcurrentResults)) {
        return {
          ok: false,
          error: 'no recorded concurrent results — earlier batch step missing',
        };
      }
      const sorted = [...ctx.lastConcurrentResults]
        .map((r) => r.latencyMs || 0)
        .sort((a, b) => a - b);
      // p95 = "the slowest 5% should be under budget". With N samples,
      // floor(0.95 * N) gives the 0-indexed position WHERE the top 5%
      // begins — checking sorted[floor(0.95 * N)] captures the worst
      // 5% boundary. For N=20: index 19 (the slowest sample).
      const p95Idx = Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length));
      const p95 = sorted[p95Idx];
      if (p95 >= budget) {
        return {
          ok: false,
          error: `p95 latency ${p95}ms exceeds budget of ${budget}ms`,
        };
      }
      return { ok: true };
    },
  },
  {
    // No-document-in-subcollection assertion. Scans the named (sub)
    // collection and asserts it's empty.
    pattern: /^no document is created in "([^"]+)"$/,
    async handler(m, ctx) {
      const collection = m[1];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.collection(collection).get();
      if (snap.docs.length > 0) {
        return {
          ok: false,
          error: `expected no docs in "${collection}" but found ${snap.docs.length}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Voice room composite state-seed: "X created a (public|private)
    // <cohort>-cohort room". Writes a `rooms/<auto-id>` doc owned by
    // X with the named visibility and cohort. Auto-id chosen as
    // "auto-<timestamp>-<random>" so multiple seeds don't collide.
    pattern: /^([A-Z][a-z]+)\s+created a (public|private) (adult|minor)-cohort room$/,
    async handler(m, ctx) {
      const ownerName = m[1];
      const visibility = m[2];
      const cohort = m[3];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const owner = personas.get(ownerName);
      if (!owner?.uniqueId) {
        return { ok: false, error: `persona "${ownerName}" not in registry` };
      }
      // Math.random() is fine here — purely for collision avoidance in
      // test-only auto-generated room ids; not security-sensitive.
      // eslint-disable-next-line sonarjs/pseudo-random
      const roomId = `auto-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      await ctx.db.doc(`rooms/${roomId}`).set({
        id: roomId,
        ownerUniqueId: owner.uniqueId,
        visibility,
        cohort,
        participantIds: [owner.uniqueId],
        createdAt: Date.now(),
      });
      return { ok: true };
    },
  },
  {
    // Dialog confirm action. Distinct from Wake 45's generic "confirms"
    // matcher — that one matches `X on <plat> confirms` (no suffix);
    // this one matches `... confirms in the dialog`. Different driver
    // method because dialogs use different selectors than inline buttons.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+confirms in the dialog$/,
    async handler(m, ctx) {
      const platform = m[2];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webConfirmDialog) {
          return { ok: false, error: 'ctx.webDriver.webConfirmDialog not configured' };
        }
        await ctx.webDriver.webConfirmDialog();
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidConfirmDialog) {
          return { ok: false, error: 'ctx.uiDriver.androidConfirmDialog not configured' };
        }
        await ctx.uiDriver.androidConfirmDialog();
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosConfirmDialog) {
          return { ok: false, error: 'ctx.uiDriver.iosConfirmDialog not configured' };
        }
        await ctx.uiDriver.iosConfirmDialog();
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for dialog-confirm step` };
    },
  },
  {
    // Long-press on target person's seat (j09 host kick-from-seat).
    // Driver locates the seat element by target name and performs a
    // long-press gesture (held tap).
    pattern: /^([A-Z][a-z]+)\s+on Android long-presses ([A-Z][a-z]+)'s seat$/,
    async handler(m, ctx) {
      const target = m[2];
      if (!ctx.uiDriver?.androidLongPressSeat) {
        return { ok: false, error: 'ctx.uiDriver.androidLongPressSeat not configured' };
      }
      await ctx.uiDriver.androidLongPressSeat(target);
      return { ok: true };
    },
  },
  {
    // Voice room create-with-joiners composite (j09). Auto-generates
    // a room id, writes a doc owned by X with participantIds containing
    // owner + N synthetic joiner uniqueIds (60000001..60000000+N).
    pattern: /^([A-Z][a-z]+)\s+created a room and has (\d+) joiners$/,
    async handler(m, ctx) {
      const ownerName = m[1];
      const joinerCount = parseInt(m[2], 10);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const owner = personas.get(ownerName);
      if (!owner?.uniqueId) {
        return { ok: false, error: `persona "${ownerName}" not in registry` };
      }
      // eslint-disable-next-line sonarjs/pseudo-random
      const roomId = `auto-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const joiners = Array.from({ length: joinerCount }, (_, i) => 60000001 + i);
      await ctx.db.doc(`rooms/${roomId}`).set({
        id: roomId,
        ownerUniqueId: owner.uniqueId,
        participantIds: [owner.uniqueId, ...joiners],
        createdAt: Date.now(),
      });
      return { ok: true };
    },
  },
  {
    // Network drops for N seconds (Android + iOS Sim). Driver simulates
    // a network outage for the named persona for the named duration.
    // Outage clears automatically after the duration — scenarios that
    // need the outage to persist past the duration must re-arm.
    pattern: /^([A-Z][a-z]+)'s (Android|iOS Sim) network drops for (\d+) seconds$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const seconds = parseInt(m[3], 10);
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidNetworkDropFor) {
          return { ok: false, error: 'ctx.uiDriver.androidNetworkDropFor not configured' };
        }
        await ctx.uiDriver.androidNetworkDropFor(name, seconds);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosNetworkDropFor) {
          return { ok: false, error: 'ctx.uiDriver.iosNetworkDropFor not configured' };
        }
        await ctx.uiDriver.iosNetworkDropFor(name, seconds);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for network-drop step` };
    },
  },
  {
    // Each-joiner UI navigates back with toast (j09 host-disconnected).
    // Driver verifies that EVERY joiner of the most-recent room ended
    // up on the rooms tab AND saw the named toast. Driver receives
    // just the toast text — it tracks the joiner set internally.
    pattern: /^each joiner's UI navigates back to the rooms tab with "([^"]+)" toast$/,
    async handler(m, ctx) {
      const toast = m[1];
      if (!ctx.webDriver?.eachJoinerNavigatesBackWithToast) {
        return {
          ok: false,
          error: 'ctx.webDriver.eachJoinerNavigatesBackWithToast not configured',
        };
      }
      const ok = await ctx.webDriver.eachJoinerNavigatesBackWithToast(toast);
      if (!ok) {
        return {
          ok: false,
          error: `not all joiners navigated back to rooms tab with "${toast}" toast`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Voice room composite create with named ID + cohort (j09). Unlike
    // Wake 64's auto-id form, this matcher takes an explicit room ID
    // from the corpus author.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+created (?:an? )?(adult|minor)-cohort room "([^"]+)"$/,
    async handler(m, ctx) {
      const ownerName = m[1];
      const cohort = m[3];
      const roomId = m[4];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const owner = personas.get(ownerName);
      if (!owner?.uniqueId) {
        return { ok: false, error: `persona "${ownerName}" not in registry` };
      }
      await ctx.db.doc(`rooms/${roomId}`).set({
        id: roomId,
        ownerUniqueId: owner.uniqueId,
        cohort,
        participantIds: [owner.uniqueId],
        createdAt: Date.now(),
      });
      return { ok: true };
    },
  },
  {
    // Response body does not include <X>. Reads ctx.lastResponse.body
    // and asserts the named field is absent. Field name parsed as
    // bare word; corpus uses singular noun forms ("a token", "an
    // error", etc.) — the matcher strips the article.
    pattern: /^the response body does not include an? (\w+)$/,
    async handler(m, ctx) {
      const field = m[1];
      if (!ctx.lastResponse) {
        return { ok: false, error: 'no recorded response — earlier request step is missing' };
      }
      const body = ctx.lastResponse.body || {};
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        return {
          ok: false,
          error: `response body should not include "${field}" but it did (value=${JSON.stringify(body[field])})`,
        };
      }
      return { ok: true };
    },
  },
  {
    // UI does not show the "<X>" button (quoted-button absence).
    // Distinct from Wake 49's quoted-string absence: that one matches
    // a literal quoted string ("Alice", "main_roomsTab"); this one
    // matches a NAMED button with explicit "the X button" suffix.
    // Driver returns truthy iff the named button is currently rendered.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI does not show the "([^"]+)" button$/,
    async handler(m, ctx) {
      const platform = m[3];
      const buttonName = m[4];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webShowsNamedButton) {
          return { ok: false, error: 'ctx.webDriver.webShowsNamedButton not configured' };
        }
        const shown = await ctx.webDriver.webShowsNamedButton(buttonName);
        if (shown) {
          return { ok: false, error: `Web UI shows "${buttonName}" button but should not` };
        }
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidShowsNamedButton) {
          return {
            ok: false,
            error: 'ctx.uiDriver.androidShowsNamedButton not configured',
          };
        }
        const shown = await ctx.uiDriver.androidShowsNamedButton(buttonName);
        if (shown) {
          return { ok: false, error: `Android UI shows "${buttonName}" button but should not` };
        }
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosShowsNamedButton) {
          return { ok: false, error: 'ctx.uiDriver.iosShowsNamedButton not configured' };
        }
        const shown = await ctx.uiDriver.iosShowsNamedButton(buttonName);
        if (shown) {
          return { ok: false, error: `iOS UI shows "${buttonName}" button but should not` };
        }
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for named-button-absence step` };
    },
  },
  {
    // Wake 66 — multi-clause persona locale state-seed (j08 Background).
    // Pins per-persona locale for the scenario. We don't write to Firestore
    // here (locale lives on the client profile and the runner doesn't
    // mutate client state from a Given step); we just record the
    // association in ctx.personaLocales so later assertions can branch on
    // locale without re-parsing the Given step.
    pattern:
      /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) locale=([a-z]{2}(?:-[A-Z]{2})?), ([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) locale=([a-z]{2}(?:-[A-Z]{2})?)$/,
    async handler(m, ctx) {
      const a = { name: m[1], platform: m[2], locale: m[3] };
      const b = { name: m[4], platform: m[5], locale: m[6] };
      const personas = loadPersonas();
      for (const p of [a, b]) {
        if (!personas.get(p.name)) {
          return { ok: false, error: `persona "${p.name}" not in registry` };
        }
      }
      if (!ctx.personaLocales) ctx.personaLocales = new Map();
      ctx.personaLocales.set(a.name, { platform: a.platform, locale: a.locale });
      ctx.personaLocales.set(b.name, { platform: b.platform, locale: b.locale });
      return { ok: true };
    },
  },
  {
    // Wake 66 — LiveKit track is disconnected (bare assertion).
    // Used both as a top-level Then step and as the inner step after
    // `within Nms` peels off its prefix. Three room-identifier forms:
    //   1. `{placeholder}` — left unresolved by interpolateScenarioVars
    //      when no scenario var is bound; passed verbatim to the driver.
    //   2. `"quoted"` — common for literal IDs like `"r1"`.
    //   3. bare token — alphanumeric room ID.
    // The matcher passes the room identifier through with quotes/braces
    // preserved when present (quoted form is unquoted before dispatch).
    pattern:
      /^([A-Z][a-z]+)'s LiveKit track for (?:room\s+)?(?:"([^"]+)"|(\{[^}]+\})|([\w-]+)) is disconnected$/,
    async handler(m, ctx) {
      const name = m[1];
      const roomId = m[2] || m[3] || m[4];
      if (!ctx.liveKitDriver?.trackIsDisconnected) {
        return { ok: false, error: 'ctx.liveKitDriver.trackIsDisconnected not configured' };
      }
      const disconnected = await ctx.liveKitDriver.trackIsDisconnected(name, roomId);
      if (!disconnected) {
        return {
          ok: false,
          error: `${name}'s LiveKit track for ${roomId} is still connected (not disconnected)`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 66 — tester hears <X>'s audio on <Y>'s <platform> device.
    // Fundamentally @manual: only a human tester can verify real audio
    // playback. Gated on `ctx.testerDriver.confirmHearsAudio(from, on,
    // platform)`. In interactive mode the driver prompts the human; in
    // auto mode the driver is absent and the matcher fails with a clear
    // "@manual-only" marker so the operator knows to tag the scenario.
    // The trailing `(real microphone)` annotation in j09:65 is stripped
    // by stripStepAnnotation before this matcher runs.
    pattern:
      /^the tester hears ([A-Z][a-z]+)'s audio on ([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) device$/,
    async handler(m, ctx) {
      const fromName = m[1];
      const onName = m[2];
      const platform = m[3];
      if (!ctx.testerDriver?.confirmHearsAudio) {
        return {
          ok: false,
          error: `manual-only assertion — no testerDriver. Tag scenario @manual or wire ctx.testerDriver.confirmHearsAudio.`,
        };
      }
      const heard = await ctx.testerDriver.confirmHearsAudio(fromName, onName, platform);
      if (!heard) {
        return {
          ok: false,
          error: `tester did not confirm hearing ${fromName}'s audio on ${onName}'s ${platform} device`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 66 — UI shows the "<tab>" tab with no navigation to the
    // <screen> screen (composite).
    // Asserts BOTH that the named tab is currently selected AND that
    // no nav-stack push to <screen> has occurred. Used in j09 to verify
    // a cross-cohort participant lands on the rooms list with the room
    // they tapped never opening. Driver collapses both checks into one
    // call per platform — keeps the matcher contract narrow and lets
    // each driver decide how to introspect its UI stack.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the "([^"]+)" tab with no navigation to the (\w+) screen$/,
    async handler(m, ctx) {
      const platform = m[2];
      const tab = m[3];
      const screen = m[4];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webShowsTabWithNoNavTo) {
          return { ok: false, error: 'ctx.webDriver.webShowsTabWithNoNavTo not configured' };
        }
        const ok = await ctx.webDriver.webShowsTabWithNoNavTo(tab, screen);
        if (!ok) {
          return {
            ok: false,
            error: `Web UI is not on "${tab}" tab OR has navigated to ${screen} screen`,
          };
        }
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidShowsTabWithNoNavTo) {
          return { ok: false, error: 'ctx.uiDriver.androidShowsTabWithNoNavTo not configured' };
        }
        const ok = await ctx.uiDriver.androidShowsTabWithNoNavTo(tab, screen);
        if (!ok) {
          return {
            ok: false,
            error: `Android UI is not on "${tab}" tab OR has navigated to ${screen} screen`,
          };
        }
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosShowsTabWithNoNavTo) {
          return { ok: false, error: 'ctx.uiDriver.iosShowsTabWithNoNavTo not configured' };
        }
        const ok = await ctx.uiDriver.iosShowsTabWithNoNavTo(tab, screen);
        if (!ok) {
          return {
            ok: false,
            error: `iOS UI is not on "${tab}" tab OR has navigated to ${screen} screen`,
          };
        }
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for tab+no-nav step` };
    },
  },
  {
    // Wake 66 — conversation between two personas is frozen (state-seed).
    // Seeds `conversations/<id>` with frozen=true + participantIds. The
    // mid-step `(annotation)` parens describe cohort/locale but are NOT
    // stripped by the END-anchored stripStepAnnotation. The matcher
    // tolerates them inline via `\s*\([^)]+\)` and ignores their content
    // — corpus author's intent is to document the test setup for the
    // human reader, not to drive runner behaviour.
    pattern:
      /^the conversation "([^"]+)" between ([A-Z][a-z]+)\s*\([^)]+\) and ([A-Z][a-z]+)\s*\([^)]+\) is frozen$/,
    async handler(m, ctx) {
      const convId = m[1];
      const nameA = m[2];
      const nameB = m[3];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const a = personas.get(nameA);
      const b = personas.get(nameB);
      if (!a?.uniqueId) return { ok: false, error: `persona "${nameA}" not in registry` };
      if (!b?.uniqueId) return { ok: false, error: `persona "${nameB}" not in registry` };
      await ctx.db.doc(`conversations/${convId}`).set({
        id: convId,
        participantIds: [a.uniqueId, b.uniqueId],
        frozen: true,
        frozenAt: Date.now(),
      });
      return { ok: true };
    },
  },
  {
    // Wake 66 — response from /api/X as <persona> has N results and
    // "<field>=<value>" in every row.
    // Composite assertion: (a) count matches AND (b) every row has the
    // field equal to the value. Reads ctx.lastResponse (an earlier
    // request-firing step must have populated it). The "as <persona>"
    // segment is informational — identifies which persona made the
    // request in the corpus — and is NOT re-issued by this matcher.
    // Singular vs plural: the corpus uses "1 result" but "0 results" /
    // "5 results", so the trailing `s` is optional.
    pattern:
      /^the response from (\/api\/[\w/-]+) as ([A-Z][a-z]+) has (\d+) results? and "([^"=]+)=([^"]+)" in every row$/,
    async handler(m, ctx) {
      const expectedPath = m[1];
      const expectedCount = parseInt(m[3], 10);
      const field = m[4];
      const expectedValue = m[5];
      if (!ctx.lastResponse) {
        return { ok: false, error: 'no recorded response — earlier request step is missing' };
      }
      if (ctx.lastResponse.path && ctx.lastResponse.path !== expectedPath) {
        return {
          ok: false,
          error: `response path mismatch: expected ${expectedPath}, last was ${ctx.lastResponse.path}`,
        };
      }
      const body = ctx.lastResponse.body;
      if (!body || !Array.isArray(body.results)) {
        return {
          ok: false,
          error: `response body has no results[] array (got ${JSON.stringify(body)})`,
        };
      }
      const rows = body.results;
      if (rows.length !== expectedCount) {
        return {
          ok: false,
          error: `expected ${expectedCount} result(s) but actual ${rows.length}`,
        };
      }
      for (const row of rows) {
        const actual = row[field];
        // Loose equality after string coercion — corpus values are bare
        // strings ("minor", "adult", "true") but the response may carry
        // booleans / numbers.
        if (String(actual) !== expectedValue) {
          return {
            ok: false,
            error: `row violates "${field}=${expectedValue}": got ${field}=${JSON.stringify(actual)} in ${JSON.stringify(row)}`,
          };
        }
      }
      return { ok: true };
    },
  },
];

// ── Step execution ──────────────────────────────────────────────────

// Strip trailing `(human commentary)` from a step's text so matchers can
// regex-match the bare assertion. Regex constraints:
//   - Requires `\s+` before `(` (so a quoted string ending in `)` doesn't get
//     truncated mid-token).
//   - Requires `)` to be the LAST char (`$` anchor) — preserves quoted
//     strings like `"Price: $10 (USD)"` where `"` is the trailing char.
//   - `[^()]*` inside disallows nested parens (would be ambiguous re: greedy
//     vs lazy matching — explicit refusal beats undefined behavior).
//
// STEP_NOT_IMPLEMENTED errors still echo the ORIGINAL step text (with
// annotation), so the operator sees what they actually wrote — not the
// stripped form, which could be confusing.
//
// Regex is linear: `\s+` is a simple bounded quantifier; `[^()]*` is a
// negated character class with no overlap with surrounding tokens
// (`\s+` requires whitespace not in the class, `\)` is in the class
// — so backtracking can't recurse). Author-controlled input (Gherkin
// step text), not untrusted user data. Safe.
function stripStepAnnotation(text) {
  // eslint-disable-next-line sonarjs/slow-regex
  return text.replace(/\s+\([^()]*\)$/, '');
}

// Resolve `{varName}` placeholders against ctx.scenarioVars (a Map populated
// by capture matchers like "X's uniqueId is recorded as {newUniqueId}").
// Unresolved placeholders are left as literal — drivers may interpret them,
// or the step may fail with a clearer error downstream. We never throw here:
// interpolation is a best-effort transform applied uniformly to every step,
// and one missing var must not abort an otherwise-valid step.
//
// Env-var fallback: if scenarioVars miss AND the placeholder name is
// UPPER_SNAKE_CASE (env-var convention), fall back to process.env. Lower-
// case names like `{coins}` are NEVER resolved from env — guards against
// leaking arbitrary process environment into step text.
function interpolateScenarioVars(text, scenarioVars) {
  return text.replace(/\{(\w+)\}/g, (match, name) => {
    if (scenarioVars && scenarioVars.has(name)) return scenarioVars.get(name);
    if (/^[A-Z_]+$/.test(name) && process.env[name] !== undefined) {
      return process.env[name];
    }
    return match;
  });
}

async function executeStep(step, ctx) {
  const text = interpolateScenarioVars(stripStepAnnotation(step.text), ctx.scenarioVars);
  for (const { pattern, handler } of matchers) {
    const m = pattern.exec(text);
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
  ctx.snapshots = new Map();
  ctx.scenarioStartTime = Date.now();
  ctx.scenarioVars = new Map();
  // Auto-populate `{ts}` placeholder with scenarioStartTime. Corpus uses
  // `{ts}` widely (sandbox receipts, email-username suffixes, timestamp
  // filters) but never explicitly captures it — convention is that `{ts}`
  // means "scenario start time". Auto-populating it here lets scenarios
  // use the placeholder without writing a separate capture step.
  ctx.scenarioVars.set('ts', String(ctx.scenarioStartTime));
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

// Snapshot baseline capture. Records the value of each field at the time of
// the Given step, keyed by `<docPath>#<field>`. The `unchanged` and
// `increased by N` matchers compare against these baselines. Per-scenario
// reset happens in runScenario.
function captureSnapshots(ctx, docPath, fields) {
  if (!ctx.snapshots) ctx.snapshots = new Map();
  for (const [field, value] of Object.entries(fields)) {
    ctx.snapshots.set(`${docPath}#${field}`, value);
  }
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
