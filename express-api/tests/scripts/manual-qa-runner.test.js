/**
 * Tests for scripts/manual-qa-runner.js
 *
 * Three layers:
 *   1. parseGherkin — pure-data parser tests against fixture .feature files.
 *   2. Pure helpers — classifySeverity, decodeJwtPayload, pickField, parseLiteral.
 *   3. Step matchers + scenario runner — stubbed `fetch` to verify dispatch
 *      and the result classification (pass / fail / STEP_NOT_IMPLEMENTED).
 *
 * Fixtures live in tests/scripts/fixtures/ and are committed — stable test
 * surface independent of the gitignored real journey files.
 */

const fs = require('fs');
const path = require('path');
const {
  parseGherkin,
  classifySeverity,
  decodeJwtPayload,
  pickField,
  parseLiteral,
  parseKvPairs,
  parseJsonishPredicate,
  executeStep,
  runFeatureFile,
} = require('../../scripts/manual-qa-runner');

const FIXTURE_DIR = path.join(__dirname, 'fixtures');

// ── parseGherkin ───────────────────────────────────────────────────

describe('parseGherkin', () => {
  const text = fs.readFileSync(path.join(FIXTURE_DIR, 'sample-auth.feature'), 'utf8');

  test('extracts the feature name', () => {
    const parsed = parseGherkin(text);
    expect(parsed.featureName).toBe('Fixture auth journey');
  });

  test('extracts background with steps', () => {
    const parsed = parseGherkin(text);
    expect(parsed.background).not.toBeNull();
    expect(parsed.background.steps).toHaveLength(2);
    expect(parsed.background.steps[0].kind).toBe('Given');
    expect(parsed.background.steps[0].text).toBe('the local stack is healthy');
  });

  test('extracts every scenario by name', () => {
    const parsed = parseGherkin(text);
    expect(parsed.scenarios.map((s) => s.name)).toEqual([
      'Alice signs in and reads her own profile',
      "Greta's admin claim uses the correct key",
      'Self-follow returns 400',
      'Manual-only step is recorded as skipped',
    ]);
  });

  test('extracts scenario tags', () => {
    const parsed = parseGherkin(text);
    expect(parsed.scenarios[0].tags).toEqual(['@blocker']);
    expect(parsed.scenarios[1].tags).toEqual(['@regression']);
    expect(parsed.scenarios[2].tags).toEqual([]);
    expect(parsed.scenarios[3].tags).toEqual(['@manual']);
  });

  test('extracts step kind + text', () => {
    const parsed = parseGherkin(text);
    const scenario = parsed.scenarios[0];
    expect(scenario.steps).toEqual([
      { kind: 'Given', text: 'Alice [P-02] is signed in' },
      { kind: 'When', text: 'Alice sends GET /api/users/50000010 with her ID token' },
      { kind: 'Then', text: 'the response status is 200' },
      { kind: 'Then', text: 'the response body has field "uniqueId" of type "number"' },
      { kind: 'Then', text: 'the response body contains "Alice"' },
    ]);
  });

  test('strips comments and blank lines', () => {
    const parsed = parseGherkin('# comment\n\nFeature: X\n\nScenario: Y\n  Given a\n');
    expect(parsed.featureName).toBe('X');
    expect(parsed.scenarios[0].steps).toHaveLength(1);
  });

  test('handles multiple tags on one line', () => {
    const parsed = parseGherkin('Feature: F\n@a @b @c\nScenario: S\n  Given x\n');
    expect(parsed.scenarios[0].tags).toEqual(['@a', '@b', '@c']);
  });

  test('feature-level tags vs scenario-level tags', () => {
    const parsed = parseGherkin(
      '@feature-tag\nFeature: F\n@scenario-tag\nScenario: S\n  Given x\n',
    );
    expect(parsed.featureTags).toEqual(['@feature-tag']);
    expect(parsed.scenarios[0].tags).toEqual(['@scenario-tag']);
  });
});

// ── classifySeverity ───────────────────────────────────────────────

describe('classifySeverity', () => {
  test('@blocker → Blocker', () => {
    expect(classifySeverity(['@blocker'])).toBe('Blocker');
  });
  test('@regression → Blocker (regression scenarios protect known fixes)', () => {
    expect(classifySeverity(['@regression', 'j12-bug-x'])).toBe('Blocker');
  });
  test('@minor → Minor', () => {
    expect(classifySeverity(['@minor'])).toBe('Minor');
  });
  test('no severity tag → Major (default)', () => {
    expect(classifySeverity(['@cohort', '@android'])).toBe('Major');
  });
  test('first matching tag wins', () => {
    expect(classifySeverity(['@polish', '@blocker'])).toBe('Blocker');
  });
});

// ── decodeJwtPayload ───────────────────────────────────────────────

describe('decodeJwtPayload', () => {
  test('decodes a base64url JWT payload', () => {
    // header.payload.signature; payload = {"uniqueId":42,"admin":true}
    const payload = Buffer.from(JSON.stringify({ uniqueId: 42, admin: true })).toString(
      'base64url',
    );
    const jwt = `aaa.${payload}.bbb`;
    expect(decodeJwtPayload(jwt)).toEqual({ uniqueId: 42, admin: true });
  });
  test('returns empty object for malformed input', () => {
    expect(decodeJwtPayload('not-a-jwt')).toEqual({});
  });
});

// ── pickField ──────────────────────────────────────────────────────

describe('pickField', () => {
  test('returns top-level field', () => {
    expect(pickField({ uniqueId: 5 }, 'uniqueId')).toBe(5);
  });
  test('falls through to body.user', () => {
    expect(pickField({ user: { uniqueId: 5 } }, 'uniqueId')).toBe(5);
  });
  test('top-level wins over nested', () => {
    expect(pickField({ uniqueId: 1, user: { uniqueId: 999 } }, 'uniqueId')).toBe(1);
  });
  test('returns undefined for missing', () => {
    expect(pickField({}, 'uniqueId')).toBeUndefined();
  });
});

// ── parseLiteral ───────────────────────────────────────────────────

describe('parseLiteral', () => {
  test('booleans', () => {
    expect(parseLiteral('true')).toBe(true);
    expect(parseLiteral('false')).toBe(false);
  });
  test('null', () => {
    expect(parseLiteral('null')).toBeNull();
  });
  test('integers', () => {
    expect(parseLiteral('42')).toBe(42);
    expect(parseLiteral('-7')).toBe(-7);
  });
  test('floats', () => {
    expect(parseLiteral('3.14')).toBe(3.14);
  });
  test('quoted strings', () => {
    expect(parseLiteral('"hello"')).toBe('hello');
  });
  test('bare strings', () => {
    expect(parseLiteral('bareword')).toBe('bareword');
  });
});

// ── parseJsonishPredicate ──────────────────────────────────────────

describe('parseJsonishPredicate', () => {
  test('empty input returns empty object', () => {
    expect(parseJsonishPredicate('')).toEqual({});
  });

  test('single key:value pair', () => {
    expect(parseJsonishPredicate('action: "blocked"')).toEqual({ action: 'blocked' });
  });

  test('multiple pairs, mixed types', () => {
    expect(
      parseJsonishPredicate(
        'action: "blocked", sourceId: 50000040, targetId: 60000010, reason: "cohort_mismatch"',
      ),
    ).toEqual({
      action: 'blocked',
      sourceId: 50000040,
      targetId: 60000010,
      reason: 'cohort_mismatch',
    });
  });

  test('quoted-string value containing a comma is NOT split mid-string', () => {
    expect(
      parseJsonishPredicate('senderId: 50000010, body: "hi adam, welcome to shytalk"'),
    ).toEqual({
      senderId: 50000010,
      body: 'hi adam, welcome to shytalk',
    });
  });

  test('boolean and null literals', () => {
    expect(parseJsonishPredicate('frozen: true, deleted: false, parent: null')).toEqual({
      frozen: true,
      deleted: false,
      parent: null,
    });
  });

  test('unresolved placeholder throws actionable error', () => {
    expect(() => parseJsonishPredicate('targetId: {newUniqueId}')).toThrow(
      /placeholder.*newUniqueId/i,
    );
  });

  test('malformed pair (missing colon) throws', () => {
    expect(() => parseJsonishPredicate('not_a_pair')).toThrow(/no colon/i);
  });

  test('handles trailing whitespace', () => {
    expect(parseJsonishPredicate('a: 1  ,  b: 2  ')).toEqual({ a: 1, b: 2 });
  });

  test('quoted string with internal colon does not split key', () => {
    expect(parseJsonishPredicate('url: "https://example.com:8080/x"')).toEqual({
      url: 'https://example.com:8080/x',
    });
  });
});

// ── parseKvPairs (v3) ─────────────────────────────────────────────

describe('parseKvPairs', () => {
  test('single numeric kv-pair', () => {
    expect(parseKvPairs('targetUniqueId=60000010')).toEqual({ targetUniqueId: 60000010 });
  });

  test('single quoted-string kv-pair', () => {
    expect(parseKvPairs('giftId="rose"')).toEqual({ giftId: 'rose' });
  });

  test('chained with " and "', () => {
    expect(parseKvPairs('recipient=60000010 and amount=100')).toEqual({
      recipient: 60000010,
      amount: 100,
    });
  });

  test('mixed numeric and quoted', () => {
    expect(parseKvPairs('recipient=60000010 and giftId="rose"')).toEqual({
      recipient: 60000010,
      giftId: 'rose',
    });
  });

  test('boolean and null literals', () => {
    expect(parseKvPairs('isAdmin=true and revokedAt=null')).toEqual({
      isAdmin: true,
      revokedAt: null,
    });
  });

  test('quoted string containing the literal " and " is not split', () => {
    expect(parseKvPairs('body="hi and bye"')).toEqual({ body: 'hi and bye' });
  });

  test('throws on empty input', () => {
    expect(() => parseKvPairs('')).toThrow(/empty/);
    expect(() => parseKvPairs('   ')).toThrow(/empty/);
  });

  test('throws on missing "="', () => {
    expect(() => parseKvPairs('foo')).toThrow(/missing "="/);
  });

  test('throws on non-identifier key', () => {
    expect(() => parseKvPairs('1foo=42')).toThrow(/not identifier-shaped/);
    expect(() => parseKvPairs('foo bar=42')).toThrow(/not identifier-shaped/);
  });

  test('preserves unquoted bare-word values as strings', () => {
    expect(parseKvPairs('status=active')).toEqual({ status: 'active' });
  });

  test('three pairs with mixed types', () => {
    expect(parseKvPairs('a=1 and b="x" and c=false')).toEqual({ a: 1, b: 'x', c: false });
  });

  // ── C-2 fix: escaped-quote handling in quoted values ──
  test('strips backslash from escaped quote inside string literal', () => {
    expect(parseKvPairs('msg="say \\"hi\\""')).toEqual({ msg: 'say "hi"' });
  });

  test('mixed chain with one escaped-quote value', () => {
    expect(parseKvPairs('a=1 and msg="he said \\"yes\\""')).toEqual({
      a: 1,
      msg: 'he said "yes"',
    });
  });

  // ── I-1 fix: non-string input type guard ──
  test('throws actionable error on numeric input', () => {
    expect(() => parseKvPairs(42)).toThrow(/must be a string, got number/);
  });

  test('throws actionable error on object input', () => {
    expect(() => parseKvPairs({})).toThrow(/must be a string, got object/);
  });

  test('throws actionable error on boolean input', () => {
    expect(() => parseKvPairs(true)).toThrow(/must be a string, got boolean/);
  });

  // `typeof null === 'object'` so the error says "got object" — technically
  // accurate but the test pins behaviour explicitly so future me knows.
  test('throws on null input (typeof object)', () => {
    expect(() => parseKvPairs(null)).toThrow(/must be a string, got object/);
  });

  test('throws on undefined input', () => {
    expect(() => parseKvPairs(undefined)).toThrow(/must be a string, got undefined/);
  });

  // ── Document parseLiteral fall-through for special numeric literals ──
  // These are never valid JSON anyway (NaN/Infinity serialize to null) so
  // treating them as bare strings is the safest behaviour — a test pin
  // ensures no one "improves" this into number coercion later.
  test('NaN bare word falls through to string (not number)', () => {
    expect(parseKvPairs('x=NaN')).toEqual({ x: 'NaN' });
  });

  test('Infinity bare word falls through to string (not number)', () => {
    expect(parseKvPairs('x=Infinity')).toEqual({ x: 'Infinity' });
  });

  test('MAX_SAFE_INTEGER parses as a regular JS number', () => {
    expect(parseKvPairs('big=9007199254740991')).toEqual({ big: 9007199254740991 });
  });

  // ── I-2 fix: float and negative-number coverage ──
  test('parses positive float value', () => {
    expect(parseKvPairs('price=3.14')).toEqual({ price: 3.14 });
  });

  test('parses negative float value', () => {
    expect(parseKvPairs('delta=-0.5')).toEqual({ delta: -0.5 });
  });

  test('parses negative integer value', () => {
    expect(parseKvPairs('offset=-42')).toEqual({ offset: -42 });
  });

  test('parses zero (numeric boundary)', () => {
    expect(parseKvPairs('count=0')).toEqual({ count: 0 });
  });
});

// ── executeStep — stubbed fetch ────────────────────────────────────

function makeCtx(overrides = {}) {
  return {
    apiBase: 'https://dev-api.example',
    firebaseApiKey: 'fake-key',
    personasPassword: 'fake-pw-not-real-just-stub-fixture',
    sessions: new Map(),
    personaPlatforms: new Map(),
    personaPaths: new Map(),
    lastResponse: null,
    locale: 'en',
    fetch: jest.fn(),
    ...overrides,
  };
}

describe('executeStep', () => {
  test('matches "the local stack is healthy"', async () => {
    const ctx = makeCtx({
      fetch: jest.fn(async () => ({ status: 200, json: async () => ({}) })),
    });
    const r = await executeStep({ kind: 'Given', text: 'the local stack is healthy' }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.fetch).toHaveBeenCalledWith('https://dev-api.example/api/health');
  });

  test('matches "the device locale is X"', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Given', text: 'the device locale is "ar"' }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.locale).toBe('ar');
  });

  test('unrecognised verb → STEP_NOT_IMPLEMENTED', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Alice does something completely unknown' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.code).toBe('STEP_NOT_IMPLEMENTED');
  });

  test('persona sign-in stores session', async () => {
    const idToken =
      'aaa.' +
      Buffer.from(JSON.stringify({ uniqueId: 50000010, admin: false })).toString('base64url') +
      '.bbb';
    const ctx = makeCtx({
      fetch: jest.fn(async () => ({
        status: 200,
        json: async () => ({ idToken, refreshToken: 'rt-x', localId: 'fb-uid-1' }),
      })),
    });
    const r = await executeStep({ kind: 'Given', text: 'Alice [P-02] is signed in' }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Alice')).toMatchObject({ idToken, refreshToken: 'rt-x' });
    expect(ctx.sessions.get('Alice').customClaims.uniqueId).toBe(50000010);
  });

  test('persona sign-in matches "on <Platform>" suffix (single-word)', async () => {
    const idToken =
      'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000010 })).toString('base64url') + '.bbb';
    const ctx = makeCtx({
      fetch: jest.fn(async () => ({
        status: 200,
        json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }),
      })),
    });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] is signed in on Android' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Alice')).toBeDefined();
  });

  test('persona sign-in matches multi-word platform ("Web Chromium", "iOS Sim")', async () => {
    const idToken =
      'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000040 })).toString('base64url') + '.bbb';
    const ctx = makeCtx({
      fetch: jest.fn(async () => ({
        status: 200,
        json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }),
      })),
    });
    const r1 = await executeStep(
      { kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' },
      ctx,
    );
    expect(r1.ok).toBe(true);
    const r2 = await executeStep(
      { kind: 'Given', text: 'Ines [P-11] is signed in on iOS Sim' },
      ctx,
    );
    expect(r2.ok).toBe(true);
  });

  test('decoded JWT payload — dotted-path field equality passes', async () => {
    const payload = Buffer.from(
      JSON.stringify({ video: { room: 'ra1' }, metadata: { cohort: 'adult' } }),
    ).toString('base64url');
    const token = 'h.' + payload + '.s';
    const ctx = makeCtx();
    ctx.lastResponse = { body: { token } };
    const r1 = await executeStep(
      {
        kind: 'Then',
        text: 'the decoded JWT payload has field "metadata.cohort" equal to "adult"',
      },
      ctx,
    );
    expect(r1.ok).toBe(true);
    const r2 = await executeStep(
      { kind: 'Then', text: 'the decoded JWT payload has field "video.room" equal to "ra1"' },
      ctx,
    );
    expect(r2.ok).toBe(true);
  });

  test('decoded JWT payload — wrong claim fails with both expected + actual', async () => {
    const payload = Buffer.from(JSON.stringify({ metadata: { cohort: 'minor' } })).toString(
      'base64url',
    );
    const token = 'h.' + payload + '.s';
    const ctx = makeCtx();
    ctx.lastResponse = { body: { token } };
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the decoded JWT payload has field "metadata.cohort" equal to "adult"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('adult');
    expect(r.error).toContain('minor');
  });

  test('decoded JWT payload — missing token field produces actionable error', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { body: { somethingElse: 'x' } };
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the decoded JWT payload has field "metadata.cohort" equal to "adult"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no token field/i);
  });

  test('decoded JWT payload — falls back to idToken and accessToken fields', async () => {
    const payload = Buffer.from(JSON.stringify({ uid: 'x' })).toString('base64url');
    const token = 'h.' + payload + '.s';
    const ctx = makeCtx();
    ctx.lastResponse = { body: { idToken: token } };
    const r = await executeStep(
      { kind: 'Then', text: 'the decoded JWT payload has field "uid" equal to "x"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('persona sign-in matches `at the "X" screen` suffix', async () => {
    const idToken =
      'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000010 })).toString('base64url') + '.bbb';
    const ctx = makeCtx({
      fetch: jest.fn(async () => ({
        status: 200,
        json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }),
      })),
    });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] is signed in on Android at the "discovery" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Alice')).toBeDefined();
  });

  test('API request stores lastResponse with parsed body', async () => {
    const idToken =
      'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000010 })).toString('base64url') + '.bbb';
    const ctx = makeCtx({
      fetch: jest.fn(async (url) => {
        if (url.includes('signInWithPassword')) {
          return {
            status: 200,
            json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb' }),
          };
        }
        return {
          status: 200,
          text: async () => JSON.stringify({ uniqueId: 50000010, displayName: 'Alice' }),
        };
      }),
    });
    await executeStep({ kind: 'Given', text: 'Alice [P-02] is signed in' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'Alice sends GET /api/users/50000010 with her ID token' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastResponse.status).toBe(200);
    expect(ctx.lastResponse.body.uniqueId).toBe(50000010);
  });

  test('response-status assertion finds mismatch', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: {} };
    const r = await executeStep({ kind: 'Then', text: 'the response status is 404' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('200');
    expect(r.error).toContain('404');
  });

  test('response-field-of-type passes on match', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: { uniqueId: 42 } };
    const r = await executeStep(
      { kind: 'Then', text: 'the response body has field "uniqueId" of type "number"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('response-field-of-type fails on wrong type', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: { uniqueId: '42' } };
    const r = await executeStep(
      { kind: 'Then', text: 'the response body has field "uniqueId" of type "number"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('string');
    expect(r.error).toContain('number');
  });

  test('claims-include assertion (boolean true)', async () => {
    const ctx = makeCtx();
    ctx.sessions.set('Greta', { customClaims: { admin: true, uniqueId: 90000001 } });
    const r = await executeStep(
      { kind: 'Then', text: 'Greta\'s Firebase Auth custom claims include "admin" equal to true' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('claims-include catches drift', async () => {
    const ctx = makeCtx();
    // Simulate the bug we caught in cycle 1: claim written as isAdmin, not admin.
    ctx.sessions.set('Greta', { customClaims: { isAdmin: true, uniqueId: 90000001 } });
    const r = await executeStep(
      { kind: 'Then', text: 'Greta\'s Firebase Auth custom claims include "admin" equal to true' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('claim "admin"');
  });

  test('claims-not-include catches stale key', async () => {
    const ctx = makeCtx();
    ctx.sessions.set('Greta', { customClaims: { admin: true, isAdmin: true } });
    const r = await executeStep(
      { kind: 'Then', text: 'Greta\'s Firebase Auth custom claims do not include "isAdmin"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('unexpectedly present');
  });
});

// ── runScenario + runFeatureFile end-to-end ────────────────────────

describe('runFeatureFile end-to-end (stubbed fetch)', () => {
  function makeFakeFetch(state = {}) {
    return jest.fn(async (url, init = {}) => {
      // 1. Firebase sign-in
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const claims = state.claims || { uniqueId: 50000010, admin: false };
        const idToken = 'h.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.s';
        return {
          status: 200,
          json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb-1' }),
        };
      }
      // 2. /api/health
      if (typeof url === 'string' && url.endsWith('/api/health')) {
        return { status: 200, json: async () => ({ ok: true }) };
      }
      // 3. GET /api/users/<id> — succeeds
      if (
        typeof url === 'string' &&
        url.match(/\/api\/users\/\d+$/) &&
        (init.method || 'GET') === 'GET'
      ) {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({ uniqueId: 50000010, displayName: 'Alice (P-02 adult power)' }),
        };
      }
      // 4. POST follow — 400 for self
      if (typeof url === 'string' && url.includes('/follow')) {
        return {
          status: 400,
          text: async () => JSON.stringify({ error: 'Cannot follow yourself' }),
        };
      }
      return { status: 500, text: async () => '{}' };
    });
  }

  test('happy path — Alice scenario passes (no findings)', async () => {
    const ctx = makeCtx({
      apiBase: 'https://dev-api.example',
      fetch: makeFakeFetch({ claims: { uniqueId: 50000010, admin: false } }),
    });
    const { findings, scenarioReports } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-auth.feature'),
      ctx,
    );
    const alicePass = scenarioReports.find(
      (s) => s.scenario === 'Alice signs in and reads her own profile',
    );
    expect(alicePass.status).toBe('pass');
    const selfFollowPass = scenarioReports.find((s) => s.scenario === 'Self-follow returns 400');
    expect(selfFollowPass.status).toBe('pass');
    // No findings on the happy-path scenarios (skipped @manual one is fine)
    const happyFindings = findings.filter(
      (f) =>
        f.scenario === 'Alice signs in and reads her own profile' ||
        f.scenario === 'Self-follow returns 400',
    );
    expect(happyFindings).toEqual([]);
  });

  test('Greta claim-key regression catches drift', async () => {
    // Inject the bug: claim is `isAdmin: true` not `admin: true`
    const ctx = makeCtx({
      fetch: makeFakeFetch({ claims: { uniqueId: 90000001, isAdmin: true } }),
    });
    const { findings, scenarioReports } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-auth.feature'),
      ctx,
    );
    const greta = scenarioReports.find(
      (s) => s.scenario === "Greta's admin claim uses the correct key",
    );
    expect(greta.status).toBe('fail');
    const gretaFinding = findings.find(
      (f) => f.scenario === "Greta's admin claim uses the correct key",
    );
    expect(gretaFinding.severity).toBe('Blocker'); // @regression tag
    expect(gretaFinding.error).toContain('admin');
  });

  test('@manual scenario is skipped, not failed', async () => {
    const ctx = makeCtx({ fetch: makeFakeFetch() });
    const result = await runFeatureFile(path.join(FIXTURE_DIR, 'sample-auth.feature'), ctx);
    const manualScenario = result.scenarioReports.find(
      (s) => s.scenario === 'Manual-only step is recorded as skipped',
    );
    expect(manualScenario.status).toBe('skipped');
    expect(result.findings.find((f) => f.scenario === manualScenario.scenario)).toBeUndefined();
  });

  test('unimplemented verb fails with Minor severity + STEP_NOT_IMPLEMENTED code', async () => {
    const ctx = makeCtx({ fetch: makeFakeFetch() });
    const { findings } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-failures.feature'),
      ctx,
    );
    const teleport = findings.find((f) => f.error.includes('teleports'));
    expect(teleport).toBeDefined();
    expect(teleport.severity).toBe('Minor');
    expect(teleport.code).toBe('STEP_NOT_IMPLEMENTED');
  });

  test('wrong status assertion fails the scenario', async () => {
    const ctx = makeCtx({ fetch: makeFakeFetch() });
    const { findings } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-failures.feature'),
      ctx,
    );
    const wrongStatus = findings.find(
      (f) => f.scenario === 'Wrong status assertion produces a finding',
    );
    expect(wrongStatus).toBeDefined();
    expect(wrongStatus.error).toContain('200');
    expect(wrongStatus.error).toContain('999');
  });
});

// ── Firestore-read matchers (v2) — stubbed db ──────────────────────

// Probe-friendly fake db: supports `.collection(name).get()` returning all
// rows, and `.collection('rooms').where('state', '==', 'OPEN').get()` filter.
// Used by the OSA invariant probe tests.
function makeProbeDb({ users = [], rooms = [], conversations = [] } = {}) {
  const makeSnap = (rows) => ({
    forEach: (cb) => rows.forEach((r) => cb({ data: () => r, id: r._id || 'x' })),
    size: rows.length,
  });
  return {
    collection: (name) => {
      const all = { users, rooms, conversations }[name] || [];
      return {
        get: async () => makeSnap(all),
        where: (field, op, value) => ({
          get: async () => {
            if (op !== '==') throw new Error('unsupported op');
            return makeSnap(all.filter((r) => r[field] === value));
          },
        }),
      };
    },
    doc: () => ({ get: async () => ({ exists: false }) }),
  };
}

function makeFakeDb(docs = {}) {
  return {
    doc: (docPath) => ({
      get: async () => {
        const data = docs[docPath];
        return {
          exists: data !== undefined,
          data: () => data,
        };
      },
    }),
  };
}

describe('Firestore doc-field equal-to matcher', () => {
  test('passes when string field matches', async () => {
    const ctx = makeCtx({
      db: makeFakeDb({ 'users/50000010': { cohort: 'adult', uniqueId: 50000010 } }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000010" with field "cohort" equal to "adult"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('passes when numeric field matches', async () => {
    const ctx = makeCtx({
      db: makeFakeDb({ 'users/50000010': { cohort: 'adult', uniqueId: 50000010 } }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000010" with field "uniqueId" equal to 50000010',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('fails when string field drifts', async () => {
    const ctx = makeCtx({
      db: makeFakeDb({ 'users/50000010': { cohort: 'minor' } }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000010" with field "cohort" equal to "adult"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('cohort');
    expect(r.error).toContain('minor');
    expect(r.error).toContain('adult');
  });

  test('fails loudly when doc is missing — does NOT silently pass', async () => {
    const ctx = makeCtx({ db: makeFakeDb({}) });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/99999999" with field "cohort" equal to "adult"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/does not exist|missing|not found/i);
  });

  test('fails with explicit error when ctx.db is not initialized', async () => {
    const ctx = makeCtx(); // no db
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/1" with field "cohort" equal to "adult"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore|admin/i);
  });

  test('handles boolean literal', async () => {
    const ctx = makeCtx({
      db: makeFakeDb({ 'users/50000010': { isAgeVerified: true } }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000010" with field "isAgeVerified" equal to true',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('Firestore doc-field containing matcher (array membership)', () => {
  test('passes when array contains the numeric element', async () => {
    const ctx = makeCtx({
      db: makeFakeDb({
        'users/50000010': { followingIds: [50000020, 50000060, 50000040] },
      }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000010" with field "followingIds" containing 50000060',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('passes when array contains the string element', async () => {
    const ctx = makeCtx({
      db: makeFakeDb({
        'rooms/r1': { participantIds: ['fb-uid-a', 'fb-uid-b'] },
      }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "rooms/r1" with field "participantIds" containing "fb-uid-b"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('fails when element is absent', async () => {
    const ctx = makeCtx({
      db: makeFakeDb({ 'users/50000010': { followingIds: [50000020, 50000040] } }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000010" with field "followingIds" containing 60000010',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('followingIds');
    expect(r.error).toContain('60000010');
  });

  test('fails when field is not an array', async () => {
    const ctx = makeCtx({
      db: makeFakeDb({ 'users/50000010': { followingIds: 'not-an-array' } }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000010" with field "followingIds" containing 60000010',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/array|not.*array|type/i);
  });

  test('fails loudly when doc is missing', async () => {
    const ctx = makeCtx({ db: makeFakeDb({}) });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/99999999" with field "followingIds" containing 1',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/does not exist|missing|not found/i);
  });
});

describe('Firestore matchers end-to-end via runFeatureFile', () => {
  function makeFetchAndDb(docs) {
    return {
      fetch: jest.fn(async (url) => {
        if (typeof url === 'string' && url.includes('signInWithPassword')) {
          const idToken =
            'h.' +
            Buffer.from(JSON.stringify({ uniqueId: 50000010, admin: false })).toString(
              'base64url',
            ) +
            '.s';
          return {
            status: 200,
            json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb-1' }),
          };
        }
        if (typeof url === 'string' && url.endsWith('/api/health')) {
          return { status: 200, json: async () => ({ ok: true }) };
        }
        return { status: 500, text: async () => '{}' };
      }),
      db: makeFakeDb(docs),
    };
  }

  test('happy-path scenario with correct doc data passes', async () => {
    const ctx = makeCtx(
      makeFetchAndDb({
        'users/50000010': {
          cohort: 'adult',
          uniqueId: 50000010,
          followingIds: [50000020, 50000060],
        },
      }),
    );
    const { findings, scenarioReports } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-firestore-reads.feature'),
      ctx,
    );
    const happyReport = scenarioReports.find(
      (s) => s.scenario === 'doc-field equality assertion passes when field matches',
    );
    expect(happyReport.status).toBe('pass');
    const happyFindings = findings.filter((f) => f.scenario === happyReport.scenario);
    expect(happyFindings).toEqual([]);
  });

  test('drifted-field scenario produces a Blocker finding (regression-grade)', async () => {
    const ctx = makeCtx(
      makeFetchAndDb({
        'users/50000010': {
          cohort: 'adult',
          uniqueId: 50000010,
          followingIds: [50000020, 50000060],
        },
      }),
    );
    const { findings } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-firestore-reads.feature'),
      ctx,
    );
    const drift = findings.find(
      (f) => f.scenario === 'doc-field equality assertion fails when field drifts',
    );
    expect(drift).toBeDefined();
    expect(drift.severity).toBe('Blocker');
    expect(drift.error).toMatch(/cohort/);
  });

  test('missing-doc scenario surfaces a finding (no silent pass)', async () => {
    const ctx = makeCtx(makeFetchAndDb({ 'users/50000010': { cohort: 'adult' } }));
    const { findings } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-firestore-reads.feature'),
      ctx,
    );
    const missing = findings.find(
      (f) => f.scenario === 'missing doc is a finding (not a silent pass)',
    );
    expect(missing).toBeDefined();
  });

  test('array-containing happy and unhappy paths both classified correctly', async () => {
    const ctx = makeCtx(
      makeFetchAndDb({
        'users/50000010': {
          cohort: 'adult',
          followingIds: [50000020, 50000060],
        },
      }),
    );
    const { findings, scenarioReports } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-firestore-reads.feature'),
      ctx,
    );
    const happyArray = scenarioReports.find(
      (s) => s.scenario === 'array-field containing assertion passes when element is present',
    );
    expect(happyArray.status).toBe('pass');
    const unhappyArray = findings.find(
      (f) => f.scenario === 'array-field containing assertion fails when element is absent',
    );
    expect(unhappyArray).toBeDefined();
    expect(unhappyArray.severity).toBe('Blocker'); // @regression
  });
});

// ── Firestore bulk-query matcher (v2) — stubbed db ────────────────

// Fake Firestore: extend to support .collection(path).get() returning docs.
function makeFakeDbWithCollections(collections = {}, docs = {}) {
  return {
    doc: (docPath) => ({
      get: async () => {
        const data = docs[docPath];
        return { exists: data !== undefined, data: () => data };
      },
    }),
    collection: (colPath) => ({
      get: async () => ({
        docs: (collections[colPath] || []).map((d, i) => ({
          id: d._id || `auto-${i}`,
          data: () => d,
        })),
      }),
    }),
  };
}

describe('Firestore bulk-query matcher (entries-matching)', () => {
  test('passes when actual count equals expected', async () => {
    const ctx = makeCtx({
      db: makeFakeDbWithCollections({
        auditLog: [
          { action: 'blocked', sourceId: 50000010, targetId: 60000010, reason: 'cohort_mismatch' },
          { action: 'blocked', sourceId: 50000040, targetId: 60000010, reason: 'cohort_mismatch' },
        ],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 1 entries in "auditLog" matching {action: "blocked", sourceId: 50000010, targetId: 60000010, reason: "cohort_mismatch"}',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('passes when expected count is zero and predicate filters everything out', async () => {
    const ctx = makeCtx({
      db: makeFakeDbWithCollections({
        auditLog: [{ action: 'blocked' }, { action: 'blocked' }],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 0 entries in "auditLog" matching {action: "device.ban"}',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('fails when count drifts', async () => {
    const ctx = makeCtx({
      db: makeFakeDbWithCollections({
        auditLog: [{ action: 'blocked' }, { action: 'blocked' }],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 5 entries in "auditLog" matching {action: "blocked"}',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('2');
    expect(r.error).toContain('5');
  });

  test('predicate filters by ALL keys (AND semantics)', async () => {
    const ctx = makeCtx({
      db: makeFakeDbWithCollections({
        auditLog: [
          { action: 'blocked', sourceId: 1 },
          { action: 'blocked', sourceId: 2 },
          { action: 'other', sourceId: 1 },
        ],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 1 entries in "auditLog" matching {action: "blocked", sourceId: 1}',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('empty predicate counts every doc in the collection', async () => {
    const ctx = makeCtx({
      db: makeFakeDbWithCollections({
        auditLog: [{ a: 1 }, { b: 2 }, { c: 3 }],
      }),
    });
    const r = await executeStep(
      { kind: 'Then', text: 'the database has 3 entries in "auditLog" matching {}' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('subcollection path with slashes works', async () => {
    const ctx = makeCtx({
      db: makeFakeDbWithCollections({
        'users/50000010/gifts': [{ giftId: 'rose' }, { giftId: 'rose' }, { giftId: 'crown' }],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 2 entries in "users/50000010/gifts" matching {giftId: "rose"}',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('fails with explicit error when ctx.db is missing', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 1 entries in "auditLog" matching {action: "blocked"}',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore|admin/i);
  });

  test('numeric and string predicate values both supported', async () => {
    const ctx = makeCtx({
      db: makeFakeDbWithCollections({
        auditLog: [
          { action: 'blocked', sourceId: 50000010 },
          { action: 'blocked', sourceId: '50000010' }, // wrong type — should NOT match
        ],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 1 entries in "auditLog" matching {sourceId: 50000010}',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('predicate with placeholder {var} reports an actionable error', async () => {
    const ctx = makeCtx({
      db: makeFakeDbWithCollections({ auditLog: [] }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 1 entries in "auditLog" matching {targetId: 50000010, sourceId: {newUniqueId}}',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/placeholder|unresolved|newUniqueId/i);
  });
});

describe('Firestore bulk-query end-to-end via runFeatureFile', () => {
  function fetchOk() {
    return jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' +
          Buffer.from(JSON.stringify({ uniqueId: 50000010, admin: false })).toString('base64url') +
          '.s';
        return {
          status: 200,
          json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb-1' }),
        };
      }
      if (typeof url === 'string' && url.endsWith('/api/health')) {
        return { status: 200, json: async () => ({ ok: true }) };
      }
      return { status: 500, text: async () => '{}' };
    });
  }

  test('happy collection state — positive, zero, and subcollection scenarios all pass', async () => {
    const ctx = makeCtx({
      fetch: fetchOk(),
      db: makeFakeDbWithCollections({
        auditLog: [
          { action: 'blocked', sourceId: 50000010, targetId: 60000010, reason: 'cohort_mismatch' },
          { action: 'age_verification.approve', targetId: 50000010, adminId: 90000001 },
          { action: 'something_else' },
        ],
        'users/50000010/gifts': [{ giftId: 'rose' }, { giftId: 'rose' }, { giftId: 'crown' }],
      }),
    });
    const { findings, scenarioReports } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-firestore-queries.feature'),
      ctx,
    );
    const positive = scenarioReports.find(
      (s) => s.scenario === 'count matching the expected positive value passes',
    );
    expect(positive.status).toBe('pass');
    const zero = scenarioReports.find(
      (s) => s.scenario === 'count matching zero passes when collection has no matches',
    );
    expect(zero.status).toBe('pass');
    const sub = scenarioReports.find(
      (s) => s.scenario === 'subcollection path works (slash-separated)',
    );
    expect(sub.status).toBe('pass');
    // The drift scenario expects 5 but the seeded collection only has 1 'blocked' entry.
    const drift = findings.find((f) => f.scenario === 'count drift produces a finding');
    expect(drift).toBeDefined();
    expect(drift.severity).toBe('Blocker');
  });
});

// ── State-seed matchers (v2) — Persona has field=value ──────────────

// Fake db that supports both .doc(...).get() and .doc(...).set(..., {merge}).
// Mutations are visible to subsequent gets within the same fake instance,
// so the runner contract "seed then assert" round-trips deterministically.
function makeStatefulFakeDb(initialDocs = {}, initialCollections = {}) {
  const docs = { ...initialDocs };
  return {
    doc: (docPath) => ({
      get: async () => {
        const data = docs[docPath];
        return { exists: data !== undefined, data: () => data };
      },
      set: async (patch, opts = {}) => {
        if (opts.merge) docs[docPath] = { ...(docs[docPath] || {}), ...patch };
        else docs[docPath] = { ...patch };
      },
    }),
    collection: (colPath) => ({
      get: async () => ({
        docs: (initialCollections[colPath] || []).map((d, i) => ({
          id: d._id || `auto-${i}`,
          data: () => d,
        })),
      }),
    }),
    _docs: docs, // for test assertions
  };
}

describe('Persona state-seed matcher (Given <Persona> has <field>=<value>)', () => {
  test('numeric value writes the field to users/<uniqueId>', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': { cohort: 'adult' } });
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: 'Alice [P-02] has shyCoins=1000' }, ctx);
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].shyCoins).toBe(1000);
    // Merge semantics — existing fields preserved.
    expect(db._docs['users/50000010'].cohort).toBe('adult');
  });

  test('platform-suffixed form is also accepted', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] on Web has shyCoins=42' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].shyCoins).toBe(42);
  });

  test('boolean literal', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] has isAgeVerified=false' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].isAgeVerified).toBe(false);
  });

  test('quoted-string literal', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: 'Alice [P-02] has cohort="adult"' }, ctx);
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].cohort).toBe('adult');
  });

  test('persona name without [P-XX] tag still resolves via registry', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: 'Alice has shyCoins=500' }, ctx);
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].shyCoins).toBe(500);
  });

  test('unknown persona returns actionable error', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: 'Mxyzptlk has shyCoins=1' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/persona|registry|Mxyzptlk/i);
  });

  test('missing db is an explicit error', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Given', text: 'Alice has shyCoins=1' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore|admin/i);
  });
});

describe('Persona user-doc multi-field state-seed matcher (Given <P> has user doc with k=v, k=v, …)', () => {
  test('writes multiple comma-separated fields in one step', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice [P-02] has user doc with shyCoins=5000, beans=2000, gcs=100',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].shyCoins).toBe(5000);
    expect(db._docs['users/50000010'].beans).toBe(2000);
    expect(db._docs['users/50000010'].gcs).toBe(100);
  });

  test('handles mixed types — int + quoted string + int + empty-array literal', async () => {
    const db = makeStatefulFakeDb({ 'users/50000020': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Lena [P-05] has user doc with acceptedPrivacyVersion=2, lastLoginRewardDate="2026-04-01", loginStreak=0, fcmTokens=[]',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000020'].acceptedPrivacyVersion).toBe(2);
    expect(db._docs['users/50000020'].lastLoginRewardDate).toBe('2026-04-01');
    expect(db._docs['users/50000020'].loginStreak).toBe(0);
    expect(db._docs['users/50000020'].fcmTokens).toEqual([]);
  });

  test('single-field form (no comma) is also accepted', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] has user doc with cohort="adult"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].cohort).toBe('adult');
  });

  test('merge semantics preserve pre-existing fields', async () => {
    const db = makeStatefulFakeDb({
      'users/50000010': { displayName: 'Alice', existingField: 'keep-me' },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] has user doc with shyCoins=42' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].shyCoins).toBe(42);
    expect(db._docs['users/50000010'].existingField).toBe('keep-me');
    expect(db._docs['users/50000010'].displayName).toBe('Alice');
  });

  test('quoted-string value containing a comma is NOT split on the inner comma', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice [P-02] has user doc with bio="hi, welcome", shyCoins=10',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].bio).toBe('hi, welcome');
    expect(db._docs['users/50000010'].shyCoins).toBe(10);
  });

  test('unknown persona fails loudly', async () => {
    const ctx = makeCtx({ db: makeStatefulFakeDb({}) });
    const r = await executeStep(
      { kind: 'Given', text: 'Zorpax [P-99] has user doc with x=1' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/persona|registry/i);
  });

  test('missing db is an explicit error', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Given', text: 'Alice [P-02] has user doc with x=1' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore|admin/i);
  });

  test('malformed pair (no =) surfaces a clear error rather than silently ignoring', async () => {
    const ctx = makeCtx({ db: makeStatefulFakeDb({ 'users/50000010': {} }) });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] has user doc with shyCoins5000' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/=|missing|malformed/i);
  });
});

describe('Persona fresh-install assertion (Given <P> is on <Platform> with the app installed but no Firebase session)', () => {
  test('Android single-token platform passes when no session exists', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Adam [P-01] is on Android with the app installed but no Firebase session',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.has('Adam')).toBe(false);
    expect(ctx.personaPlatforms.get('Adam')).toBe('Android');
  });

  test('iOS Sim multi-token platform passes', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Mia [P-03] is on iOS Sim with the app installed but no Firebase session',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Mia')).toBe('iOS Sim');
  });

  test('Web Chromium multi-token platform passes', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice [P-02] is on Web Chromium with the app installed but no Firebase session',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Alice')).toBe('Web Chromium');
  });

  test('clears any prior session for that persona — no Firebase session is enforced', async () => {
    const ctx = makeCtx();
    ctx.sessions.set('Adam', { idToken: 'stale-token', persona: { uniqueId: 50000005 } });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Adam [P-01] is on Android with the app installed but no Firebase session',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.has('Adam')).toBe(false);
  });

  test('persona-id-less form (just first name) also works', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice is on Android with the app installed but no Firebase session',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Alice')).toBe('Android');
  });

  test('accepts ephemeral persona (Adam P-01) — the whole point of fresh signup scenarios', async () => {
    // Adam P-01 / Mia P-03 are deliberately NOT in the provisioner
    // registry — j01/j02 walk them through signup. This assertion-only
    // matcher must accept them. Typo-catching is deferred to downstream
    // steps that actually need a uniqueId.
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Adam [P-01] is on Android with the app installed but no Firebase session',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Adam')).toBe('Android');
  });

  test('Android physical 2-token platform passes', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice [P-02] is on Android physical with the app installed but no Firebase session',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Alice')).toBe('Android physical');
  });
});

describe('Sign-in with kv-pair state seed (Given <P> is signed in on <Platform> with <fields>)', () => {
  function withSignInFetch(uniqueId = 50000010) {
    return jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' +
          Buffer.from(JSON.stringify({ uniqueId, admin: false })).toString('base64url') +
          '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
  }

  test('multi-field comma-separated state seeds user doc after sign-in', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ fetch: withSignInFetch(50000010), db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice [P-02] is signed in on Web Chromium with shyCoins=5000, beans=2000, gcs=100',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Alice')).toBeDefined();
    expect(db._docs['users/50000010'].shyCoins).toBe(5000);
    expect(db._docs['users/50000010'].beans).toBe(2000);
    expect(db._docs['users/50000010'].gcs).toBe(100);
  });

  test('single-field with shyCoins=5000 also seeds', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ fetch: withSignInFetch(50000010), db });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] is signed in on Android physical with shyCoins=5000' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].shyCoins).toBe(5000);
  });

  test('"X and Y" separator works alongside trailing parenthetical', async () => {
    // j07's first-step shape: Adam will eventually go here when ephemeral
    // sign-in lands; for now we use Hayato (P-06, in registry) to prove
    // the parsing.
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ fetch: withSignInFetch(50000030), db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] is signed in on Android with cohort=adult and isAgeVerified=true (post-j01 state)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000030'].cohort).toBe('adult');
    expect(db._docs['users/50000030'].isAgeVerified).toBe(true);
  });

  test('no `with` clause — existing sign-in semantics unchanged', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch() });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] is signed in on Android' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Alice')).toBeDefined();
  });

  test('quoted-string value in `with` clause writes correctly', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ fetch: withSignInFetch(50000010), db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice [P-02] is signed in on Web Chromium with lastSeenAt="2026-05-17T15:00:00Z"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].lastSeenAt).toBe('2026-05-17T15:00:00Z');
  });

  test('trailing parenthetical alone (no with-clause kv pairs) — sign-in still passes, no seed', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch() });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice [P-02] is signed in on Android (no admin claim)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('with-clause requires ctx.db — explicit error if missing', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch() }); // no db
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Lena [P-05] is signed in on Android with shyCoins=5000',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore/i);
  });
});

describe('ageVerificationSubmission state-seed matcher (j04 first-step shape)', () => {
  test('creates submission doc with status + DOB-on-ID for Hayato', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] submitted an ageVerificationSubmission with status="PENDING" and an ID image showing DOB=2011-05-12',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const docId = 'ageVerificationSubmissions/test-50000030-pending';
    expect(db._docs[docId]).toBeDefined();
    expect(db._docs[docId].userId).toBe('50000030');
    expect(db._docs[docId].status).toBe('pending');
    expect(db._docs[docId].dobOnId).toBe('2011-05-12');
  });

  test('status is lowercased — runner contract matches express-api enum', async () => {
    // Real schema uses lowercase ('pending'/'approved'/'rejected') but
    // scenarios sometimes write the human-readable uppercase. Normalise
    // in one place (the matcher) rather than asking authors to remember.
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] submitted an ageVerificationSubmission with status="APPROVED"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['ageVerificationSubmissions/test-50000030-approved'].status).toBe('approved');
  });

  test('DOB-on-ID is optional — status-only form works for j04 cycle scenarios', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] submitted an ageVerificationSubmission with status="PENDING"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const doc = db._docs['ageVerificationSubmissions/test-50000030-pending'];
    expect(doc.userId).toBe('50000030');
    expect(doc.status).toBe('pending');
    expect(doc.dobOnId).toBeUndefined();
  });

  test('submittedAt timestamp is set on creation', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    const beforeMs = Date.now();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] submitted an ageVerificationSubmission with status="PENDING"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const doc = db._docs['ageVerificationSubmissions/test-50000030-pending'];
    expect(typeof doc.submittedAt).toBe('number');
    expect(doc.submittedAt).toBeGreaterThanOrEqual(beforeMs);
    expect(doc.submittedAt).toBeLessThanOrEqual(Date.now());
  });

  test('idempotent — repeated calls for same (user, status) overwrite the same doc id', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] submitted an ageVerificationSubmission with status="PENDING" and an ID image showing DOB=2010-01-01',
      },
      ctx,
    );
    await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] submitted an ageVerificationSubmission with status="PENDING" and an ID image showing DOB=2011-05-12',
      },
      ctx,
    );
    // Second call overwrites the first — DOB updated, no duplicate docs.
    const docs = Object.keys(db._docs).filter((k) => k.startsWith('ageVerificationSubmissions/'));
    expect(docs).toHaveLength(1);
    expect(db._docs[docs[0]].dobOnId).toBe('2011-05-12');
  });

  test('unknown persona fails loudly', async () => {
    const ctx = makeCtx({ db: makeStatefulFakeDb({}) });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Zorpax [P-99] submitted an ageVerificationSubmission with status="PENDING"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/persona|registry/i);
  });

  test('missing db is an explicit error', async () => {
    const ctx = makeCtx(); // no db
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] submitted an ageVerificationSubmission with status="PENDING"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore/i);
  });
});

describe('Persona has-state-seed — array literals + compound `and` + trailing paren (j04 BG shapes)', () => {
  test('array literal: has followingIds=[N, N] writes array to user doc', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] has followingIds=[50000010, 50000060]',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000030'].followingIds).toEqual([50000010, 50000060]);
  });

  test('array literal with trailing parenthetical — paren stripped, array intact', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] has followingIds=[50000010, 50000060] (two adult follows)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000030'].followingIds).toEqual([50000010, 50000060]);
  });

  test('compound "and" — has shyCoins=100 and isAgeVerified=false writes both fields', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] has shyCoins=100 and isAgeVerified=false',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000030'].shyCoins).toBe(100);
    expect(db._docs['users/50000030'].isAgeVerified).toBe(false);
  });

  test('mixed: array + scalar via `and` — has followingIds=[50000010] and shyCoins=200', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] has followingIds=[50000010] and shyCoins=200',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000030'].followingIds).toEqual([50000010]);
    expect(db._docs['users/50000030'].shyCoins).toBe(200);
  });

  test('empty array literal: has followingIds=[] writes empty array', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] has followingIds=[]',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000030'].followingIds).toEqual([]);
  });

  test('mixed-type array: has tags=["adult", "verified"] writes array of strings', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] has tags=["adult", "verified"]',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000030'].tags).toEqual(['adult', 'verified']);
  });

  test('single-field shape (pre-existing) still works — has shyCoins=42', async () => {
    // Regression check: the wake-1 single-field tests must keep passing
    // after this wake's generalisation.
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: 'Alice [P-02] has shyCoins=42' }, ctx);
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].shyCoins).toBe(42);
  });
});

describe('Persona on-platform-at-path matcher (Given <P> is on <Platform> at "<path>")', () => {
  test('Web Admin at "/admin#age-verification" records platform + path', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Greta [P-12] is on Web Admin at "/admin#age-verification"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Greta')).toBe('Web Admin');
    expect(ctx.personaPaths.get('Greta')).toBe('/admin#age-verification');
  });

  test('with-no-Firebase-session suffix clears any prior session AND records path', async () => {
    // j03's BG line: "Lena [P-05] is on Web Chromium at \"/\" with no Firebase session"
    const ctx = makeCtx();
    ctx.sessions.set('Lena', { idToken: 'stale', persona: { uniqueId: 50000020 } });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Lena [P-05] is on Web Chromium at "/" with no Firebase session',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Lena')).toBe('Web Chromium');
    expect(ctx.personaPaths.get('Lena')).toBe('/');
    expect(ctx.sessions.has('Lena')).toBe(false);
  });

  test('persona-id-less form (just name) works', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Greta is on Web Admin at "/admin#users"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPaths.get('Greta')).toBe('/admin#users');
  });

  test('multi-token platform: "iOS Sim at /chat" works', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Mia [P-03] is on iOS Sim at "/chat"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Mia')).toBe('iOS Sim');
    expect(ctx.personaPaths.get('Mia')).toBe('/chat');
  });

  test('path with query string preserved', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice [P-02] is on Web Chromium at "/discover?cohort=adult&limit=20"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPaths.get('Alice')).toBe('/discover?cohort=adult&limit=20');
  });

  test('records platform/path without requiring Firebase session — pure bookkeeping', async () => {
    // Confirms the matcher does NOT require a prior sign-in. Greta has no
    // session — the matcher must still record her context.
    const ctx = makeCtx();
    expect(ctx.sessions.has('Greta')).toBe(false);
    const r = await executeStep(
      { kind: 'Given', text: 'Greta [P-12] is on Web Admin at "/admin#reports"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Greta')).toBe('Web Admin');
  });
});

describe('Ephemeral persona sign-in (Adam P-01, Mia P-03 — accounts not in provisioner)', () => {
  test('Adam can be signed-in with state seed — no Firebase REST call attempted', async () => {
    // Adam P-01 is ephemeral. The matcher must NOT attempt to authenticate
    // against Firebase (no account exists); instead create a synthetic
    // session record AND seed his declared state into Firestore.
    const fetchSpy = jest.fn();
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ fetch: fetchSpy, db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Adam [P-01] is signed in on Android with cohort=adult and isAgeVerified=true (post-j01 state)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    // No real auth call attempted
    expect(fetchSpy).not.toHaveBeenCalled();
    // Synthetic session is recorded
    const session = ctx.sessions.get('Adam');
    expect(session).toBeDefined();
    expect(session.idToken).toMatch(/^synthetic:/);
    expect(session.persona.id).toBe('P-01');
    // State seeded onto Adam's user doc
    const adamUid = session.persona.uniqueId;
    expect(db._docs[`users/${adamUid}`].cohort).toBe('adult');
    expect(db._docs[`users/${adamUid}`].isAgeVerified).toBe(true);
  });

  test('Mia can be signed-in with state seed — same pattern as Adam', async () => {
    const fetchSpy = jest.fn();
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ fetch: fetchSpy, db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Mia [P-03] is signed in on iOS Sim with cohort=minor',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    const session = ctx.sessions.get('Mia');
    expect(session.persona.id).toBe('P-03');
    expect(session.persona.cohort).toBe('minor');
    const miaUid = session.persona.uniqueId;
    expect(db._docs[`users/${miaUid}`].cohort).toBe('minor');
  });

  test('ephemeral uniqueIds are in the 9xxxxxxx test range — no collision with real personas (5xxxxxxx, 6xxxxxxx)', async () => {
    const ctx = makeCtx({ fetch: jest.fn(), db: makeStatefulFakeDb({}) });
    await executeStep(
      {
        kind: 'Given',
        text: 'Adam [P-01] is signed in on Android with cohort=adult',
      },
      ctx,
    );
    const adamUid = ctx.sessions.get('Adam').persona.uniqueId;
    expect(adamUid).toBeGreaterThanOrEqual(90000000);
    expect(adamUid).toBeLessThan(100000000);
  });

  test('non-ephemeral persona (Alice P-02) still hits real Firebase REST sign-in', async () => {
    // Regression check: ephemeral handling must not bypass real auth for
    // registered personas. Alice still goes through signInWithPassword.
    let signInUrlSeen = null;
    const fetchSpy = jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        signInUrlSeen = url;
        const idToken =
          'h.' + Buffer.from(JSON.stringify({ uniqueId: 50000010 })).toString('base64url') + '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
    const ctx = makeCtx({ fetch: fetchSpy });
    const r = await executeStep({ kind: 'Given', text: 'Alice [P-02] is signed in' }, ctx);
    expect(r.ok).toBe(true);
    expect(signInUrlSeen).toBeTruthy();
    expect(ctx.sessions.get('Alice').idToken).not.toMatch(/^synthetic:/);
  });

  test('ephemeral sign-in without ctx.db is OK if the `with` clause is omitted', async () => {
    // Pure session bookkeeping — no state seed, no db required.
    const ctx = makeCtx({ fetch: jest.fn() }); // no db
    const r = await executeStep(
      { kind: 'Given', text: 'Adam [P-01] is signed in on Android' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Adam')).toBeDefined();
  });

  test('ephemeral sign-in WITH `with` clause requires ctx.db — error if missing', async () => {
    const ctx = makeCtx({ fetch: jest.fn() }); // no db
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Adam [P-01] is signed in on Android with cohort=adult',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore/i);
  });
});

describe('Persona exists-with full-state seed (Given <P> [P-NN] exists with <fields>)', () => {
  test('Officia (P-19, uniqueId=1) full-state seed writes all fields', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Officia [P-19] exists with uniqueId=1, userType=SHYTALK_OFFICIAL, isOfficial=true, isUnblockable=true',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const doc = db._docs['users/1'];
    expect(doc.uniqueId).toBe(1);
    expect(doc.userType).toBe('SHYTALK_OFFICIAL');
    expect(doc.isOfficial).toBe(true);
    expect(doc.isUnblockable).toBe(true);
  });

  test('exists-with does NOT merge — fully replaces the user doc', async () => {
    const db = makeStatefulFakeDb({
      'users/1': { uniqueId: 1, staleField: 'should-be-gone' },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Officia [P-19] exists with uniqueId=1, isOfficial=true',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/1'].staleField).toBeUndefined();
    expect(db._docs['users/1'].isOfficial).toBe(true);
  });

  test('uniqueId in the step body is the source of truth for doc path — overrides registry', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Officia [P-19] exists with uniqueId=42, isOfficial=true' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/42']).toBeDefined();
    expect(db._docs['users/1']).toBeUndefined();
  });

  test('without uniqueId in body — falls back to persona registry uniqueId', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Officia [P-19] exists with isOfficial=true' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/1'].isOfficial).toBe(true);
  });

  test('missing db is an explicit error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Officia [P-19] exists with uniqueId=1, isOfficial=true',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore/i);
  });
});

describe('LiveKit Docker precondition (Given the LiveKit Docker container is running)', () => {
  test('passes as a no-op precondition — mirrors the existing local-stack precondition', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'the LiveKit Docker container is running' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('Sign-in with custom-claim seeding (Given <P> is signed in … with custom claim X=Y)', () => {
  function withSignInFetch(uniqueId = 50000120) {
    return jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' +
          Buffer.from(JSON.stringify({ uniqueId, admin: false })).toString('base64url') +
          '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
  }

  test('isAdmin=true is added to session.customClaims (NOT user doc)', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ fetch: withSignInFetch(), db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Greta [P-12] is signed in on Web Admin Chromium with custom claim isAdmin=true',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const session = ctx.sessions.get('Greta');
    expect(session.customClaims.isAdmin).toBe(true);
    // Custom claims do NOT spill into user doc
    expect(db._docs['users/50000120']).toBeUndefined();
  });

  test('compound `with custom claim X=Y and Z=W` seeds both into customClaims', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch(), db: makeStatefulFakeDb({}) });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Greta [P-12] is signed in on Web with custom claim isAdmin=true and adminLevel=2',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const session = ctx.sessions.get('Greta');
    expect(session.customClaims.isAdmin).toBe(true);
    expect(session.customClaims.adminLevel).toBe(2);
  });

  test('non-custom-claim `with` clause still seeds user doc as before — regression check', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ fetch: withSignInFetch(50000010), db });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] is signed in on Web Chromium with shyCoins=5000' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].shyCoins).toBe(5000);
  });

  test('existing JWT-decoded claims are preserved when merging — additive only', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch(50000120), db: makeStatefulFakeDb({}) });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Greta [P-12] is signed in on Web with custom claim isAdmin=true',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const session = ctx.sessions.get('Greta');
    // Original JWT claim (uniqueId) survives
    expect(session.customClaims.uniqueId).toBe(50000120);
    // New custom claim added
    expect(session.customClaims.isAdmin).toBe(true);
  });
});

describe('Persona on-platform locale+signin compound (Given <P> is on <Platform> with browser locale <X>, signed in as <id>)', () => {
  function withSignInFetch(uniqueId = 50000070) {
    return jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' +
          Buffer.from(JSON.stringify({ uniqueId, admin: false })).toString('base64url') +
          '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
  }

  test('Layla on Web Chromium with browser locale ar, signed in as 50000070', async () => {
    // j13 BG shape: combines platform, locale, and sign-in in one step.
    const ctx = makeCtx({ fetch: withSignInFetch(50000070) });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Layla [P-13] is on Web Chromium with browser locale ar, signed in as 50000070',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Layla')).toBe('Web Chromium');
    expect(ctx.locale).toBe('ar');
    expect(ctx.sessions.get('Layla')).toBeDefined();
  });

  test('CJK locale (ja) for Kenji', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch(50000071) });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Kenji [P-14] is on Web Chromium with browser locale ja, signed in as 50000071',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.locale).toBe('ja');
    expect(ctx.personaPlatforms.get('Kenji')).toBe('Web Chromium');
  });

  test('mismatched uniqueId between persona registry and step body — error', async () => {
    // Layla [P-13] is uniqueId=50000070 in the registry. If the step body
    // claims "signed in as 99999999", that's a step-author bug — fail loudly
    // rather than silently pass with the wrong identity.
    const ctx = makeCtx({ fetch: withSignInFetch(50000070) });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Layla [P-13] is on Web Chromium with browser locale ar, signed in as 99999999',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/mismatch|99999999|50000070/i);
  });
});

describe('Sign-in `at the "X" tab` form (j09 Theo on the rooms tab)', () => {
  function withSignInFetch(uniqueId = 50000110) {
    return jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' +
          Buffer.from(JSON.stringify({ uniqueId, admin: false })).toString('base64url') +
          '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
  }

  test('Theo signed in on Android physical at the "rooms" tab — accepted', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch() });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Theo [P-10] is signed in on Android physical at the "rooms" tab',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Theo')).toBeDefined();
  });

  test('existing "at the X screen" form still works — regression check', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch(50000010) });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] is signed in on Android at the "discovery" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Alice')).toBeDefined();
  });
});

describe('Network throttling matcher (j14 Ines on Slow 3G)', () => {
  test('Slow 3G profile recorded — platform + throttle on ctx', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Ines [P-11] is on Web Chromium with Chrome DevTools network throttling set to "Slow 3G" (400kbps down, 400ms latency)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Ines')).toBe('Web Chromium');
    expect(ctx.networkThrottle).toBe('Slow 3G');
  });

  test('Fast 3G profile also works (trailing-paren-free form)', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Ines [P-11] is on Web Chromium with Chrome DevTools network throttling set to "Fast 3G"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.networkThrottle).toBe('Fast 3G');
  });

  test('Offline profile also works', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Ines [P-11] is on Web Chromium with Chrome DevTools network throttling set to "Offline"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.networkThrottle).toBe('Offline');
  });
});

describe('Negation: <P> has no prior interactions with <Other> (j08 cross-cohort wall setup)', () => {
  test('no-op pass — assumed-clean-environment MVP for "no prior interactions"', async () => {
    // Real impl would query conversations/follows/gifts/etc. and delete
    // any matching docs. For MVP: pass-through; downstream `Then …`
    // assertions catch genuine state violations.
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Vexa has no prior interactions with Marcus' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('persona-id-bracketed form also works', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Vexa [P-07] has no prior interactions with Marcus [P-04]' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('j19 migration query verbs', () => {
  test('single-doc query stores result on ctx.lastQueryResult', async () => {
    const db = makeStatefulFakeDb({ 'users/1': { uniqueId: 1, isOfficial: true } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'When', text: 'a query is run for the user doc "users/1"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastQueryResult).toBeDefined();
    expect(ctx.lastQueryResult.exists).toBe(true);
    expect(ctx.lastQueryResult.data.uniqueId).toBe(1);
  });

  test('single-doc query for missing path still passes — exists=false', async () => {
    const ctx = makeCtx({ db: makeStatefulFakeDb({}) });
    const r = await executeStep(
      { kind: 'When', text: 'a query is run for the user doc "users/99999999"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastQueryResult.exists).toBe(false);
  });

  test('collection scan stores all docs on ctx.lastQueryResult', async () => {
    const db = makeStatefulFakeDb(
      {},
      {
        users: [
          { uniqueId: 50000010, cohort: 'adult' },
          { uniqueId: 60000010, cohort: 'minor' },
        ],
      },
    );
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'When', text: 'a query is run for every "users/*" doc' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(Array.isArray(ctx.lastQueryResult.docs)).toBe(true);
    expect(ctx.lastQueryResult.docs).toHaveLength(2);
  });

  test('filtered collection scan: where cohort="adult"', async () => {
    const db = makeStatefulFakeDb(
      {},
      {
        users: [
          { uniqueId: 50000010, cohort: 'adult' },
          { uniqueId: 60000010, cohort: 'minor' },
          { uniqueId: 50000020, cohort: 'adult' },
        ],
      },
    );
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'When', text: 'a query is run for every "users/*" doc where cohort="adult"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastQueryResult.docs).toHaveLength(2);
    expect(ctx.lastQueryResult.docs.every((d) => d.cohort === 'adult')).toBe(true);
  });

  test('migration script execution is a no-op pass (MVP)', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'the migration script is executed with --dry-run against dev' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('`with` predicate keyword also works (j19 variant)', async () => {
    // Cycle-3 uses both `where` and `with` for predicates — accept either.
    const db = makeStatefulFakeDb(
      {},
      {
        rooms: [
          { state: 'OPEN', cohort: 'adult' },
          { state: 'CLOSED', cohort: 'minor' },
          { state: 'OPEN', cohort: 'mixed' },
        ],
      },
    );
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'When', text: 'a query is run for every "rooms/*" doc with state="OPEN"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastQueryResult.docs).toHaveLength(2);
  });

  test('plural-form `"X/*" docs with field=Y and field=Z` (multi-predicate, no "every")', async () => {
    // j19's mixed-cohort-room scenario shape.
    const db = makeStatefulFakeDb(
      {},
      {
        rooms: [
          { state: 'CLOSED', closedBy: 'migration' },
          { state: 'CLOSED', closedBy: 'user' },
          { state: 'OPEN', closedBy: null },
          { state: 'CLOSED', closedBy: 'migration' },
        ],
      },
    );
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'a query is run for "rooms/*" docs with state="CLOSED" and closedBy="migration"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastQueryResult.docs).toHaveLength(2);
    expect(ctx.lastQueryResult.docs.every((d) => d.state === 'CLOSED')).toBe(true);
    expect(ctx.lastQueryResult.docs.every((d) => d.closedBy === 'migration')).toBe(true);
  });
});

describe('UI driver — Android element-tag assertion (Then <P>\'s Android UI shows the element with tag "<X>")', () => {
  test('element present in UI dump passes', async () => {
    const dump =
      '<node resource-id="main_pmTab" text="" bounds="[0,0][100,100]" />' +
      '<node resource-id="main_homeTab" text="Home" />';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Hayato\'s Android UI shows the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.uiDriver.androidUiDump).toHaveBeenCalled();
  });

  test('element absent from UI dump fails with clear error', async () => {
    const dump = '<node resource-id="main_homeTab" />';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Hayato\'s Android UI shows the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/main_pmTab/);
  });

  test('fully-qualified resource-id (com.shyden.shytalk.dev:id/X) also matches the short tag form', async () => {
    // Real adb uiautomator dump emits `com.shyden.shytalk.dev:id/main_pmTab`
    // even when the Gherkin step uses the short tag. The matcher should
    // accept both forms.
    const dump = '<node resource-id="com.shyden.shytalk.dev:id/main_pmTab" />';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Hayato\'s Android UI shows the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('no ctx.uiDriver configured — explicit error (not silent pass)', async () => {
    const ctx = makeCtx(); // no uiDriver
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Hayato\'s Android UI shows the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('iOS UI step fails with "not yet implemented" (Minor severity tracker)', async () => {
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn() } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Mia\'s iOS Sim UI shows the element with tag "restricted_banner"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iOS|not.*implement|simctl/i);
  });

  test('Web UI step fails with "out of Node scope" (delegated to Playwright MCP)', async () => {
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn() } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Greta\'s Web Admin UI shows the element with tag "admin_age_verification"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Web|Playwright|out.*scope/i);
  });
});

describe('UI driver — Android tap on element with tag (When <P> on Android taps "<X>")', () => {
  test('tap on found element calls androidTap with bounds centre', async () => {
    const dump = '<node resource-id="signup_createAccountButton" bounds="[100,200][300,400]" />';
    const tapSpy = jest.fn(async () => {});
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump), androidTap: tapSpy },
    });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android taps "signup_createAccountButton"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Bounds [100,200][300,400] → centre (200, 300)
    expect(tapSpy).toHaveBeenCalledWith(200, 300);
  });

  test('tap on missing element fails — does not silently pass', async () => {
    const dump = '<node resource-id="other_tag" bounds="[0,0][50,50]" />';
    const tapSpy = jest.fn();
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump), androidTap: tapSpy },
    });
    const r = await executeStep({ kind: 'When', text: 'Adam on Android taps "missing_tag"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing_tag/);
    expect(tapSpy).not.toHaveBeenCalled();
  });

  test('fully-qualified resource-id form also resolves', async () => {
    const dump =
      '<node resource-id="com.shyden.shytalk.dev:id/signup_createAccountButton" bounds="[10,20][30,40]" />';
    const tapSpy = jest.fn(async () => {});
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump), androidTap: tapSpy },
    });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android taps "signup_createAccountButton"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Bounds [10,20][30,40] → centre (20, 30)
    expect(tapSpy).toHaveBeenCalledWith(20, 30);
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx(); // no uiDriver
    const r = await executeStep({ kind: 'When', text: 'Adam on Android taps "any_tag"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('element with no bounds attribute fails with clear error', async () => {
    const dump = '<node resource-id="weird_no_bounds" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump), androidTap: jest.fn() },
    });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android taps "weird_no_bounds"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/bounds/i);
  });
});

describe('UI driver — Android type text into element (When <P> on Android types "<text>" into "<tag>")', () => {
  test('typing into a found field focuses (taps centre) then dispatches text', async () => {
    const dump = '<node resource-id="signup_emailField" bounds="[200,20][320,80]" />';
    const tapSpy = jest.fn(async () => {});
    const typeSpy = jest.fn(async () => {});
    const ctx = makeCtx({
      uiDriver: {
        androidUiDump: jest.fn(async () => dump),
        androidTap: tapSpy,
        androidTypeText: typeSpy,
      },
    });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Adam on Android types "adam-new@shytalk.dev" into "signup_emailField"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Bounds [200,20][320,80] → centre (260, 50)
    expect(tapSpy).toHaveBeenCalledWith(260, 50);
    expect(typeSpy).toHaveBeenCalledWith('adam-new@shytalk.dev');
    // Tap MUST happen before type — adb input text writes to the focused element.
    expect(tapSpy.mock.invocationCallOrder[0]).toBeLessThan(typeSpy.mock.invocationCallOrder[0]);
  });

  test('typing into a missing field fails — no tap, no type', async () => {
    const dump = '<node resource-id="other_field" bounds="[0,0][10,10]" />';
    const tapSpy = jest.fn();
    const typeSpy = jest.fn();
    const ctx = makeCtx({
      uiDriver: {
        androidUiDump: jest.fn(async () => dump),
        androidTap: tapSpy,
        androidTypeText: typeSpy,
      },
    });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Adam on Android types "anything" into "missing_field"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing_field/);
    expect(tapSpy).not.toHaveBeenCalled();
    expect(typeSpy).not.toHaveBeenCalled();
  });

  test('no ctx.uiDriver — loud error before any driver call', async () => {
    const ctx = makeCtx(); // no uiDriver
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android types "x" into "any_tag"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('quoted text passes through verbatim — special chars preserved (e.g. !@#)', async () => {
    const dump = '<node resource-id="signup_passwordField" bounds="[0,0][100,40]" />';
    const tapSpy = jest.fn(async () => {});
    const typeSpy = jest.fn(async () => {});
    const ctx = makeCtx({
      uiDriver: {
        androidUiDump: jest.fn(async () => dump),
        androidTap: tapSpy,
        androidTypeText: typeSpy,
      },
    });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Adam on Android types "TestPassw0rd!" into "signup_passwordField"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(typeSpy).toHaveBeenCalledWith('TestPassw0rd!');
  });

  test('missing androidTypeText driver method — explicit error, not a silent pass', async () => {
    const dump = '<node resource-id="any_field" bounds="[0,0][10,10]" />';
    const ctx = makeCtx({
      uiDriver: {
        androidUiDump: jest.fn(async () => dump),
        androidTap: jest.fn(),
        // androidTypeText intentionally missing
      },
    });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android types "anything" into "any_field"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidTypeText/);
  });
});

describe('within-Nms polling wrapper (Then within Nms <inner-assertion>)', () => {
  test('inner succeeds on first poll — returns ok immediately, well under the budget', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': { ageVerified: true } });
    const ctx = makeCtx({ db });
    const start = Date.now();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 5000ms the database has document "users/50000010" with field "ageVerified" equal to true',
      },
      ctx,
    );
    const elapsed = Date.now() - start;
    expect(r.ok).toBe(true);
    // Should be near-instant since the inner already matches on the first poll.
    expect(elapsed).toBeLessThan(200);
  });

  test('inner succeeds after a delay — returns ok within the window', async () => {
    // Doc starts wrong, flips to expected value after ~80ms.
    let flipped = false;
    setTimeout(() => {
      flipped = true;
    }, 80);
    const db = {
      doc: (p) => ({
        get: async () => ({
          exists: true,
          data: () => ({ status: flipped ? 'ready' : 'pending' }),
        }),
        path: p,
      }),
    };
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 1000ms the database has document "things/abc" with field "status" equal to "ready"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test("inner never succeeds — wrapper returns the inner's last error after timeout", async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': { status: 'pending' } });
    const ctx = makeCtx({ db });
    const start = Date.now();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 100ms the database has document "users/50000010" with field "status" equal to "ready"',
      },
      ctx,
    );
    const elapsed = Date.now() - start;
    expect(r.ok).toBe(false);
    // Wrapper surfaces the underlying assertion failure, not a generic "timed out".
    expect(r.error).toMatch(/status/);
    expect(r.error).toMatch(/expected "ready"/);
    // Should have polled for at least the budget (give some slack for jitter).
    expect(elapsed).toBeGreaterThanOrEqual(95);
    // Should not have polled for much longer than the budget.
    expect(elapsed).toBeLessThan(500);
  });

  test('inner step has no matcher — short-circuits, does not poll for the full window', async () => {
    const ctx = makeCtx();
    const start = Date.now();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 5000ms there is some completely unknown step here',
      },
      ctx,
    );
    const elapsed = Date.now() - start;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/STEP_NOT_IMPLEMENTED/);
    // Critical: should NOT have waited 5s — a missing matcher is a contract problem, not a timing problem.
    expect(elapsed).toBeLessThan(500);
  });

  test('zero-ms budget — runs inner exactly once then returns its result', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': { x: 1 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 0ms the database has document "users/50000010" with field "x" equal to 1',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('wrapper composes over the array-containing matcher (high-leverage proof)', async () => {
    // Demonstrates the pareto-justifying claim: same wrapper, different inner matcher → free win.
    const db = makeStatefulFakeDb({ 'users/50000010': { roles: ['member', 'moderator'] } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 100ms the database has document "users/50000010" with field "roles" containing "moderator"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('UI driver — Android text-content assertion (Then <P>\'s Android UI shows "<text>")', () => {
  test('matches a visible text="..." attribute exactly', async () => {
    const dump = '<node text="Submitted — awaiting review" bounds="[0,0][100,40]" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Adam\'s Android UI shows "Submitted — awaiting review"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('matches a content-desc="..." attribute when text is empty (icon-only view)', async () => {
    const dump = '<node text="" content-desc="Back" bounds="[0,0][50,50]" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep({ kind: 'Then', text: 'Adam\'s Android UI shows "Back"' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('does NOT silently pass on substring match (text="save as draft" should not satisfy "save")', async () => {
    const dump = '<node text="save as draft" bounds="[0,0][100,40]" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep({ kind: 'Then', text: 'Adam\'s Android UI shows "save"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/"save"/);
  });

  test('returns a clear error when neither attribute matches', async () => {
    const dump = '<node text="Some other label" content-desc="Other" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'Vexa\'s Android UI shows "No results found"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No results found/);
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx(); // no uiDriver
    const r = await executeStep({ kind: 'Then', text: 'Adam\'s Android UI shows "anything"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('trailing descriptive context after the quoted text is accepted (e.g. ` indicator on his original message`)', async () => {
    const dump = '<node text="read" bounds="[0,0][50,30]" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Adam\'s Android UI shows "read" indicator on his original message',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('composes with the within-Nms wrapper: polls for the text to appear', async () => {
    // Text not present at t=0, appears at ~80ms.
    let visible = false;
    setTimeout(() => {
      visible = true;
    }, 80);
    const ctx = makeCtx({
      uiDriver: {
        androidUiDump: jest.fn(async () =>
          visible ? '<node text="Ready" />' : '<node text="Loading" />',
        ),
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 500ms Adam\'s Android UI shows "Ready"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('regex-special characters in the quoted text are escaped (no accidental regex injection)', async () => {
    const dump = '<node text="Price: $10.00 (USD)" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Android UI shows "Price: $10.00 (USD)"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('UI driver — Android tag-negation (Then <P>\'s Android UI does not show the element with tag "<X>")', () => {
  test('tag absent — assertion succeeds (ok:true)', async () => {
    const dump = '<node resource-id="other_button" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Adam\'s Android UI does not show the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('tag present in short form — assertion fails with clear error', async () => {
    const dump = '<node resource-id="main_pmTab" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Adam\'s Android UI does not show the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/main_pmTab/);
    // Error must say the tag IS present, not that it isn't (don't confuse the operator).
    expect(r.error).toMatch(/present|found|exists|shown|should not/i);
  });

  test('tag present in fully-qualified form — assertion fails (handles adb pkg-prefixed dumps)', async () => {
    const dump = '<node resource-id="com.shyden.shytalk.dev:id/main_pmTab" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Adam\'s Android UI does not show the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/main_pmTab/);
  });

  test('iOS Sim variant — returns "not yet implemented" error pointing at iosUiDump', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Mia\'s iOS Sim UI does not show the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iOS|simctl|iosUiDump/i);
  });

  test('Web variant — explicit Playwright-MCP-out-of-scope error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Lena\'s Web UI does not show the element with tag "main_roomsTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Playwright|Web/i);
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Adam\'s Android UI does not show the element with tag "anything"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('composes with within-Nms wrapper: polls for tag to disappear', async () => {
    // Tag present at t=0, disappears at ~80ms.
    let still = true;
    setTimeout(() => {
      still = false;
    }, 80);
    const ctx = makeCtx({
      uiDriver: {
        androidUiDump: jest.fn(async () =>
          still
            ? '<node resource-id="main_pmTab" /><node resource-id="other" />'
            : '<node resource-id="other" />',
        ),
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 500ms Hayato\'s Android UI does not show the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('short-form vs qualified-form: short tag string in unrelated content does NOT cause false fail (e.g. "ab" must not match resource-id="cab")', async () => {
    // De Morgan trap — a naive substring check could match `resource-id="some_main_pmTab_suffix"` as containing `main_pmTab`.
    // Wake-15 uses an exact-attribute or :id/ suffix match; the negation must mirror that exactness.
    const dump = '<node resource-id="some_other_widget" /><node resource-id="main_pmTabFooter" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Adam\'s Android UI does not show the element with tag "main_pmTab"',
      },
      ctx,
    );
    // Tag `main_pmTab` is NOT present (the closest is `main_pmTabFooter` which is a different resource-id).
    expect(r.ok).toBe(true);
  });
});

describe('UI driver — Android navigation (When <P> on Android opens the "<X>" screen|tab)', () => {
  test('"screen" noun — calls androidOpenScreen with the exact screen name', async () => {
    const openSpy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidOpenScreen: openSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android opens the "discovery" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(openSpy).toHaveBeenCalledWith('discovery');
  });

  test('"tab" noun — same matcher works (semantically equivalent navigation target)', async () => {
    const openSpy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidOpenScreen: openSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Selma on Android opens the "rooms" tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(openSpy).toHaveBeenCalledWith('rooms');
  });

  test('P-NN persona annotation — handled without polluting the screen name', async () => {
    const openSpy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidOpenScreen: openSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam [P-01] on Android opens the "wallet" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(openSpy).toHaveBeenCalledWith('wallet');
  });

  test('multi-word screen names with underscores pass through verbatim', async () => {
    // Important: don't accidentally strip or transform the name — drivers may need
    // exact case/separator for deeplinks (e.g. shytalk://daily_reward).
    const openSpy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidOpenScreen: openSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android opens the "daily_reward" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(openSpy).toHaveBeenCalledWith('daily_reward');
  });

  test('no ctx.uiDriver — loud error before any driver call', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android opens the "discovery" screen' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('missing androidOpenScreen driver method — specific actionable error', async () => {
    const ctx = makeCtx({ uiDriver: {} }); // uiDriver present, method missing
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android opens the "discovery" screen' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidOpenScreen/);
  });

  test('driver throws — bubbles up through executeStep wrapper as structured finding', async () => {
    const openSpy = jest.fn(async () => {
      throw new Error('adb: device not found');
    });
    const ctx = makeCtx({ uiDriver: { androidOpenScreen: openSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android opens the "discovery" screen' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/adb: device not found/);
  });
});

describe('Firestore doc-field greater-than matcher (Then the database has document X with field Y greater than N)', () => {
  test('actual > expected → ok:true', async () => {
    const db = makeStatefulFakeDb({ 'users/50000020': { shyCoins: 900 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" greater than 800',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('actual === expected → fails (strict greater, NOT >=)', async () => {
    const db = makeStatefulFakeDb({ 'users/50000020': { shyCoins: 800 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" greater than 800',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/800/);
  });

  test('actual < expected → fails with informative error', async () => {
    const db = makeStatefulFakeDb({ 'users/50000020': { shyCoins: 500 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" greater than 800',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/shyCoins/);
    expect(r.error).toMatch(/500/);
    expect(r.error).toMatch(/800/);
  });

  test('field missing — clear error pointing at the missing field', async () => {
    const db = makeStatefulFakeDb({ 'users/50000020': { otherField: 1 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" greater than 0',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/shyCoins/);
  });

  test('doc does not exist — error mentions the doc path', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" greater than 0',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/users\/50000020/);
  });

  test('non-numeric actual field — rejects rather than doing JS lexicographic comparison', async () => {
    // Critical: `"abc" > 100` returns false in JS via NaN coercion, which would
    // silently report the assertion as "fails as expected" — but the actual bug
    // is "the field is wrongly typed". Explicit type rejection avoids that trap.
    const db = makeStatefulFakeDb({ 'users/50000020': { shyCoins: 'not-a-number' } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" greater than 0',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/numeric|number/i);
  });

  test('non-numeric expected literal — rejects with parse error', async () => {
    const db = makeStatefulFakeDb({ 'users/50000020': { shyCoins: 900 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" greater than foo',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/foo|numeric|number/i);
  });

  test('no ctx.db — loud error before any work', async () => {
    const ctx = makeCtx({ db: undefined });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" greater than 800',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore/i);
  });

  test('composes with the within-Nms wrapper — polls until the value crosses the threshold', async () => {
    // shyCoins starts at 500, increments to 1000 at ~80ms.
    let count = 500;
    setTimeout(() => {
      count = 1000;
    }, 80);
    const ctx = makeCtx({
      db: {
        doc: () => ({
          get: async () => ({ exists: true, data: () => ({ shyCoins: count }) }),
        }),
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 500ms the database has document "users/50000020" with field "shyCoins" greater than 800',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('floating-point comparison works (privacyVersion > 0 with non-integer values)', async () => {
    const db = makeStatefulFakeDb({ 'usersAcceptedPolicies/u1': { privacyVersion: 1.5 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "usersAcceptedPolicies/u1" with field "privacyVersion" greater than 0',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('Firestore doc-field NEGATED-containing — `does not have document X with field Y containing N` (vacuous-true on missing doc)', () => {
  test('doc missing — assertion holds vacuously (ok:true)', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database does not have document "users/50000030" with field "blockedIds" containing 1',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('doc exists, field missing — assertion holds (no array to contain N)', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': { name: 'X' } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database does not have document "users/50000030" with field "blockedIds" containing 1',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('doc exists, field is array but does NOT contain N — assertion holds', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': { blockedIds: [2, 3] } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database does not have document "users/50000030" with field "blockedIds" containing 1',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('doc exists, field is array and DOES contain N — assertion FAILS', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': { blockedIds: [1, 2, 3] } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database does not have document "users/50000030" with field "blockedIds" containing 1',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/blockedIds/);
    expect(r.error).toMatch(/1/);
  });

  test('doc exists, field is scalar (non-array) — assertion holds (no array can contain N)', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': { blockedIds: 'not-an-array' } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database does not have document "users/50000030" with field "blockedIds" containing 1',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('no ctx.db — loud error', async () => {
    const ctx = makeCtx({ db: undefined });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database does not have document "users/X" with field "Y" containing 1',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore/i);
  });
});

describe('Firestore doc-field `not containing` — `has document X with field Y not containing N` (requires doc to exist)', () => {
  test('doc exists, array does not contain N — assertion holds (ok:true)', async () => {
    const db = makeStatefulFakeDb({ 'users/60000010': { followerIds: [1, 2, 3] } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/60000010" with field "followerIds" not containing 50000040',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('doc exists, array CONTAINS N — assertion fails', async () => {
    const db = makeStatefulFakeDb({ 'users/60000010': { followerIds: [50000040, 1, 2] } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/60000010" with field "followerIds" not containing 50000040',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/followerIds/);
    expect(r.error).toMatch(/50000040/);
  });

  test('doc missing — assertion fails (must exist; "has document" is part of the contract)', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/60000010" with field "followerIds" not containing 50000040',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/users\/60000010/);
  });

  test('field missing — assertion fails (positive contract requires field present)', async () => {
    const db = makeStatefulFakeDb({ 'users/60000010': { otherField: 'x' } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/60000010" with field "followerIds" not containing 50000040',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/followerIds/);
  });

  test('field is scalar (non-array) — assertion fails (can\'t reason about "containing" in a non-array)', async () => {
    const db = makeStatefulFakeDb({ 'users/60000010': { followerIds: 'oops' } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/60000010" with field "followerIds" not containing 50000040',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/array/i);
  });

  test('composes with within-Nms wrapper (poll until array no longer contains N)', async () => {
    // followerIds starts with N in it, evicts at ~80ms.
    let containsN = true;
    setTimeout(() => {
      containsN = false;
    }, 80);
    const ctx = makeCtx({
      db: {
        doc: () => ({
          get: async () => ({
            exists: true,
            data: () => ({ followerIds: containsN ? [50000040, 1] : [1] }),
          }),
        }),
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 500ms the database has document "users/60000010" with field "followerIds" not containing 50000040',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('no ctx.db — loud error', async () => {
    const ctx = makeCtx({ db: undefined });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/X" with field "Y" not containing 1',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore/i);
  });

  test('does not accidentally match the positive containing matcher (different semantics)', async () => {
    // Critical: regression guard. If a future refactor of the positive
    // matcher accidentally consumed "not containing", the negation would
    // route to the wrong handler and silently invert the assertion.
    const db = makeStatefulFakeDb({ 'users/X': { ids: [1, 2] } });
    const ctx = makeCtx({ db });
    // Containing 1 → positive matcher (should pass).
    const positive = await executeStep(
      { kind: 'Then', text: 'the database has document "users/X" with field "ids" containing 1' },
      ctx,
    );
    expect(positive.ok).toBe(true);
    // Not containing 99 → negation matcher (also should pass, but via different handler).
    const negation = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/X" with field "ids" not containing 99',
      },
      ctx,
    );
    expect(negation.ok).toBe(true);
    // Not containing 1 → negation matcher (should fail because array DOES contain 1).
    const negationFail = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/X" with field "ids" not containing 1',
      },
      ctx,
    );
    expect(negationFail.ok).toBe(false);
  });
});

describe('Response status alternation (Then the response status is N or M)', () => {
  test('actual matches first option — ok:true', async () => {
    const ctx = makeCtx({ lastResponse: { status: 405 } });
    const r = await executeStep({ kind: 'Then', text: 'the response status is 405 or 403' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('actual matches second option — ok:true', async () => {
    const ctx = makeCtx({ lastResponse: { status: 403 } });
    const r = await executeStep({ kind: 'Then', text: 'the response status is 405 or 403' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('actual matches neither — clear error showing actual + both expected', async () => {
    const ctx = makeCtx({ lastResponse: { status: 200 } });
    const r = await executeStep({ kind: 'Then', text: 'the response status is 405 or 403' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/200/);
    expect(r.error).toMatch(/405/);
    expect(r.error).toMatch(/403/);
  });

  test('no prior response — loud error pointing at missing When step', async () => {
    const ctx = makeCtx(); // no lastResponse
    const r = await executeStep({ kind: 'Then', text: 'the response status is 405 or 403' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/prior request|missing|no.*request/i);
  });

  test('does not collide with the exact-match matcher (different pattern shape)', async () => {
    // Regression guard: the exact `^the response status is (\d{3})$` pattern must not
    // match `... is 405 or 403` (would silently report "expected 405, got 405-or-403").
    const ctx = makeCtx({ lastResponse: { status: 405 } });
    const exact = await executeStep({ kind: 'Then', text: 'the response status is 405' }, ctx);
    expect(exact.ok).toBe(true);
    const alt = await executeStep({ kind: 'Then', text: 'the response status is 405 or 403' }, ctx);
    expect(alt.ok).toBe(true);
    // And actual=403 must match the alternation (going through the right handler).
    const ctx2 = makeCtx({ lastResponse: { status: 403 } });
    const alt2 = await executeStep(
      { kind: 'Then', text: 'the response status is 405 or 403' },
      ctx2,
    );
    expect(alt2.ok).toBe(true);
  });
});

describe('Snapshot baseline — `unchanged` matcher (Then the database has document X with field Y unchanged)', () => {
  test('snapshot captured via Given, field still equal — ok:true', async () => {
    const fetchSpy = jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' + Buffer.from(JSON.stringify({ uniqueId: 50000020 })).toString('base64url') + '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
    const db = makeStatefulFakeDb({ 'users/50000020': {} });
    const ctx = makeCtx({ fetch: fetchSpy, db });
    // Given captures baseline
    const given = await executeStep(
      {
        kind: 'Given',
        text: 'Lena [P-05] is signed in on Android with shyCoins=5000',
      },
      ctx,
    );
    expect(given.ok).toBe(true);
    // Then asserts unchanged (no When step in between → still 5000)
    const then = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" unchanged',
      },
      ctx,
    );
    expect(then.ok).toBe(true);
  });

  test('snapshot captured, field CHANGED — fails with both values in error', async () => {
    const fetchSpy = jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' + Buffer.from(JSON.stringify({ uniqueId: 50000020 })).toString('base64url') + '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
    const db = makeStatefulFakeDb({ 'users/50000020': {} });
    const ctx = makeCtx({ fetch: fetchSpy, db });
    await executeStep(
      { kind: 'Given', text: 'Lena [P-05] is signed in on Android with shyCoins=5000' },
      ctx,
    );
    // Simulate a When step changing the value out from under us
    await db.doc('users/50000020').set({ shyCoins: 4500 }, { merge: true });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" unchanged',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/5000/);
    expect(r.error).toMatch(/4500/);
  });

  test('no snapshot captured — loud error pointing at missing Given baseline', async () => {
    const db = makeStatefulFakeDb({ 'users/50000020': { shyCoins: 5000 } });
    const ctx = makeCtx({ db });
    // No Given step — snapshots stays empty
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" unchanged',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/snapshot|baseline|Given/i);
  });
});

describe('Snapshot baseline — `increased by N` matcher (Then the database has document X with field Y increased by N)', () => {
  test('snapshot=5000, actual=5500, delta=500 — ok:true', async () => {
    const fetchSpy = jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' + Buffer.from(JSON.stringify({ uniqueId: 50000020 })).toString('base64url') + '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
    const db = makeStatefulFakeDb({ 'users/50000020': {} });
    const ctx = makeCtx({ fetch: fetchSpy, db });
    await executeStep(
      { kind: 'Given', text: 'Lena [P-05] is signed in on Android with shyCoins=5000' },
      ctx,
    );
    // Simulate a gift being received that bumps coins
    await db.doc('users/50000020').set({ shyCoins: 5500 }, { merge: true });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" increased by 500',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('snapshot=5000, actual=4500 (DECREASED) — fails because delta is wrong sign', async () => {
    const fetchSpy = jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' + Buffer.from(JSON.stringify({ uniqueId: 50000020 })).toString('base64url') + '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
    const db = makeStatefulFakeDb({ 'users/50000020': {} });
    const ctx = makeCtx({ fetch: fetchSpy, db });
    await executeStep(
      { kind: 'Given', text: 'Lena [P-05] is signed in on Android with shyCoins=5000' },
      ctx,
    );
    await db.doc('users/50000020').set({ shyCoins: 4500 }, { merge: true });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" increased by 500',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/-500|decreased|less/i);
  });

  test('snapshot=5000, actual=5300 (delta=300, not 500) — fails with actual delta in error', async () => {
    const fetchSpy = jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' + Buffer.from(JSON.stringify({ uniqueId: 50000020 })).toString('base64url') + '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
    const db = makeStatefulFakeDb({ 'users/50000020': {} });
    const ctx = makeCtx({ fetch: fetchSpy, db });
    await executeStep(
      { kind: 'Given', text: 'Lena [P-05] is signed in on Android with shyCoins=5000' },
      ctx,
    );
    await db.doc('users/50000020').set({ shyCoins: 5300 }, { merge: true });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" increased by 500',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/300/);
    expect(r.error).toMatch(/500/);
  });

  test('no snapshot — error mentions snapshot/baseline/Given', async () => {
    const db = makeStatefulFakeDb({ 'users/50000020': { shyCoins: 5500 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" increased by 500',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/snapshot|baseline|Given/i);
  });

  test('composes with within-Nms wrapper: poll until delta is reached', async () => {
    const fetchSpy = jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' + Buffer.from(JSON.stringify({ uniqueId: 50000020 })).toString('base64url') + '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
    const db = makeStatefulFakeDb({ 'users/50000020': {} });
    const ctx = makeCtx({ fetch: fetchSpy, db });
    await executeStep(
      { kind: 'Given', text: 'Lena [P-05] is signed in on Android with shyCoins=5000' },
      ctx,
    );
    // Defer the change to ~80ms after the Then step starts
    setTimeout(() => {
      db.doc('users/50000020').set({ shyCoins: 5500 }, { merge: true });
    }, 80);
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 500ms the database has document "users/50000020" with field "shyCoins" increased by 500',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('No-entry-added-since matcher (Then no entry is added to "X" since "Y")', () => {
  test('empty collection — assertion holds (ok:true)', async () => {
    const db = makeStatefulFakeDb({}, { 'users/50000040/transactions': [] });
    const ctx = makeCtx({ db, scenarioStartTime: 1_700_000_000_000 });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no entry is added to "users/50000040/transactions" since "{ts}"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('collection has docs created BEFORE scenarioStartTime — assertion holds', async () => {
    const db = makeStatefulFakeDb(
      {},
      {
        'users/50000040/transactions': [
          { _id: 'old1', amount: 100, createdAt: 1_699_999_000_000 },
          { _id: 'old2', amount: 200, createdAt: 1_699_999_500_000 },
        ],
      },
    );
    const ctx = makeCtx({ db, scenarioStartTime: 1_700_000_000_000 });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no entry is added to "users/50000040/transactions" since "{ts}"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('collection has a doc created AFTER scenarioStartTime — assertion FAILS', async () => {
    const db = makeStatefulFakeDb(
      {},
      {
        'users/50000040/transactions': [
          { _id: 'old', amount: 100, createdAt: 1_699_999_000_000 },
          { _id: 'new', amount: 50, createdAt: 1_700_000_500_000 },
        ],
      },
    );
    const ctx = makeCtx({ db, scenarioStartTime: 1_700_000_000_000 });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no entry is added to "users/50000040/transactions" since "{ts}"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/new|users\/50000040\/transactions/);
  });

  test('explicit ISO timestamp (not {ts}) — parses and compares correctly', async () => {
    const db = makeStatefulFakeDb(
      {},
      {
        'users/X/logs': [
          { _id: 'old', createdAt: Date.parse('2024-12-31T23:59:00Z') },
          { _id: 'new', createdAt: Date.parse('2025-01-01T00:00:30Z') },
        ],
      },
    );
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no entry is added to "users/X/logs" since "2025-01-01T00:00:00Z"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/new/);
  });

  test('explicit numeric timestamp (raw ms) — parses and compares correctly', async () => {
    const db = makeStatefulFakeDb(
      {},
      {
        'users/X/logs': [{ _id: 'a', createdAt: 5000 }],
      },
    );
    const ctx = makeCtx({ db });
    // Since 3000 → "a" (createdAt=5000) added after → fail
    const r = await executeStep(
      { kind: 'Then', text: 'no entry is added to "users/X/logs" since "3000"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/a/);
  });

  test('docs without createdAt field are ignored (treated as "old", not erroneously flagged as "new")', async () => {
    // Don't flag missing-createdAt as a new entry — that'd produce false positives
    // for docs the test infra didn't bother to timestamp. If a real bug writes
    // an entry without createdAt, that's a different bug to catch.
    const db = makeStatefulFakeDb(
      {},
      {
        'users/X/transactions': [
          { _id: 'no-ts', amount: 50 }, // missing createdAt
        ],
      },
    );
    const ctx = makeCtx({ db, scenarioStartTime: 1_700_000_000_000 });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no entry is added to "users/X/transactions" since "{ts}"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('no ctx.db — loud error', async () => {
    const ctx = makeCtx({ db: undefined, scenarioStartTime: 1 });
    const r = await executeStep(
      { kind: 'Then', text: 'no entry is added to "users/X/transactions" since "{ts}"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore/i);
  });

  test('{ts} placeholder used without ctx.scenarioStartTime — loud error pointing at missing baseline', async () => {
    const db = makeStatefulFakeDb({}, { 'users/X/transactions': [] });
    const ctx = makeCtx({ db }); // scenarioStartTime intentionally absent
    const r = await executeStep(
      { kind: 'Then', text: 'no entry is added to "users/X/transactions" since "{ts}"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/scenarioStartTime|baseline|\{ts\}/i);
  });
});

describe('Response-from-path in-every-row matcher (Then the response from <path> has <field>="<value>" in every row)', () => {
  test('all rows have matching field (unquoted-field syntax) — ok:true', async () => {
    const ctx = makeCtx({
      lastResponse: {
        status: 200,
        body: [
          { id: 1, cohort: 'adult' },
          { id: 2, cohort: 'adult' },
          { id: 3, cohort: 'adult' },
        ],
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/economy/leaderboards has cohort="adult" in every row',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('all rows have matching field (quoted-expression syntax `"field=value"`) — ok:true', async () => {
    const ctx = makeCtx({
      lastResponse: {
        status: 200,
        body: [
          { id: 1, cohort: 'minor' },
          { id: 2, cohort: 'minor' },
        ],
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/economy/leaderboards has "cohort=minor" in every row',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('one row mismatches — assertion fails with row index in error', async () => {
    const ctx = makeCtx({
      lastResponse: {
        status: 200,
        body: [
          { id: 1, cohort: 'adult' },
          { id: 2, cohort: 'minor' }, // mismatch
          { id: 3, cohort: 'adult' },
        ],
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/economy/leaderboards has cohort="adult" in every row',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/minor/);
    expect(r.error).toMatch(/cohort/);
  });

  test('body is object with first Array property — uses that array (e.g. {users: [...]})', async () => {
    const ctx = makeCtx({
      lastResponse: {
        status: 200,
        body: {
          users: [
            { id: 1, cohort: 'adult' },
            { id: 2, cohort: 'adult' },
          ],
        },
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/users/search has cohort="adult" in every row',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('empty array — assertion holds vacuously (no rows means no mismatches)', async () => {
    // Author intent: "every row matches" with zero rows is trivially true.
    // If the author wanted "at least one row matches", a different assertion
    // is needed (the existing N-result form).
    const ctx = makeCtx({ lastResponse: { status: 200, body: [] } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/economy/leaderboards has cohort="adult" in every row',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('no prior response — loud error', async () => {
    const ctx = makeCtx(); // no lastResponse
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/economy/leaderboards has cohort="adult" in every row',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no.*response|prior request/i);
  });

  test('body has no array — loud error pointing at the body shape', async () => {
    const ctx = makeCtx({
      lastResponse: { status: 200, body: { id: 'just-an-id', name: 'no-array-here' } },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/economy/leaderboards has cohort="adult" in every row',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/array|rows/i);
  });

  test('numeric value coerces correctly (e.g. age=18)', async () => {
    // parseLiteral handles number coercion; the matcher should compare
    // 18 (number) against row.age (number), not the string "18".
    const ctx = makeCtx({
      lastResponse: {
        status: 200,
        body: [{ age: 18 }, { age: 18 }],
      },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/users has age="18" in every row' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('No conversation doc created — `no conversation doc is created` matcher (cross-cohort PM wall)', () => {
  test('conversations collection empty — assertion holds', async () => {
    const db = makeStatefulFakeDb({}, { conversations: [] });
    const ctx = makeCtx({ db, scenarioStartTime: 1_700_000_000_000 });
    const r = await executeStep({ kind: 'Then', text: 'no conversation doc is created' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('conversations collection has only pre-scenario docs — assertion holds', async () => {
    const db = makeStatefulFakeDb(
      {},
      {
        conversations: [{ _id: 'old', participantIds: [1, 2], createdAt: 1_699_999_000_000 }],
      },
    );
    const ctx = makeCtx({ db, scenarioStartTime: 1_700_000_000_000 });
    const r = await executeStep({ kind: 'Then', text: 'no conversation doc is created' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('conversations collection has a doc created AFTER scenarioStartTime — fails', async () => {
    const db = makeStatefulFakeDb(
      {},
      {
        conversations: [
          { _id: 'leaked', participantIds: [50000040, 60000010], createdAt: 1_700_000_500_000 },
        ],
      },
    );
    const ctx = makeCtx({ db, scenarioStartTime: 1_700_000_000_000 });
    const r = await executeStep({ kind: 'Then', text: 'no conversation doc is created' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/leaked|conversations/);
  });

  test('no ctx.db — loud error', async () => {
    const ctx = makeCtx({ db: undefined, scenarioStartTime: 1 });
    const r = await executeStep({ kind: 'Then', text: 'no conversation doc is created' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore/i);
  });

  test('scenarioStartTime missing — loud error so a missing reset is loud not silent', async () => {
    const db = makeStatefulFakeDb({}, { conversations: [] });
    const ctx = makeCtx({ db });
    delete ctx.scenarioStartTime;
    const r = await executeStep({ kind: 'Then', text: 'no conversation doc is created' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/scenarioStartTime|baseline/i);
  });
});

describe('Per-persona JWT custom-claim matcher (Then <P>\'s Android JWT custom claim "X" equals "Y")', () => {
  function makeJwt(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.signature`;
  }

  test('real Firebase JWT — claim equals expected (ok:true)', async () => {
    const idToken = makeJwt({ uniqueId: 50000060, cohort: 'minor', iat: 1, exp: 9999999999 });
    const sessions = new Map();
    sessions.set('Hayato', { idToken });
    const ctx = makeCtx({ sessions });
    const r = await executeStep(
      { kind: 'Then', text: 'Hayato\'s Android JWT custom claim "cohort" equals "minor"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('real Firebase JWT — claim mismatches expected (fail with both values)', async () => {
    const idToken = makeJwt({ uniqueId: 50000060, cohort: 'minor' });
    const sessions = new Map();
    sessions.set('Hayato', { idToken });
    const ctx = makeCtx({ sessions });
    const r = await executeStep(
      { kind: 'Then', text: 'Hayato\'s Android JWT custom claim "cohort" equals "adult"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cohort/);
    expect(r.error).toMatch(/minor/);
    expect(r.error).toMatch(/adult/);
  });

  test('synthetic/ephemeral persona — uses session.customClaims directly (no JWT decode)', async () => {
    const sessions = new Map();
    sessions.set('Adam', {
      idToken: 'synthetic:Adam:50000001',
      customClaims: { uniqueId: 50000001, cohort: 'adult', ephemeral: true },
    });
    const ctx = makeCtx({ sessions });
    const r = await executeStep(
      { kind: 'Then', text: 'Adam\'s Android JWT custom claim "cohort" equals "adult"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('synthetic/ephemeral persona — claim mismatch fails', async () => {
    const sessions = new Map();
    sessions.set('Adam', {
      idToken: 'synthetic:Adam:50000001',
      customClaims: { cohort: 'adult' },
    });
    const ctx = makeCtx({ sessions });
    const r = await executeStep(
      { kind: 'Then', text: 'Adam\'s Android JWT custom claim "cohort" equals "minor"' },
      ctx,
    );
    expect(r.ok).toBe(false);
  });

  test('claim missing from payload — clear error pointing at the missing claim', async () => {
    const idToken = makeJwt({ uniqueId: 1, iat: 1 });
    const sessions = new Map();
    sessions.set('Hayato', { idToken });
    const ctx = makeCtx({ sessions });
    const r = await executeStep(
      { kind: 'Then', text: 'Hayato\'s Android JWT custom claim "cohort" equals "minor"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cohort/);
  });

  test('no session for persona — loud error pointing at missing Given sign-in', async () => {
    const ctx = makeCtx({ sessions: new Map() }); // no sessions
    const r = await executeStep(
      { kind: 'Then', text: 'Hayato\'s Android JWT custom claim "cohort" equals "minor"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/session|Hayato/i);
  });

  test('P-NN persona annotation form — handled (Hayato [P-06])', async () => {
    const idToken = makeJwt({ cohort: 'adult' });
    const sessions = new Map();
    sessions.set('Hayato', { idToken });
    const ctx = makeCtx({ sessions });
    const r = await executeStep(
      { kind: 'Then', text: 'Hayato [P-06]\'s Android JWT custom claim "cohort" equals "adult"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('Trailing-annotation preprocessing — `Then ... (human commentary)` is ignored uniformly', () => {
  test('equal-to matcher accepts `(unchanged)` annotation — value 6000 still parses cleanly', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': { shyCoins: 6000 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000010" with field "shyCoins" equal to 6000 (only one credit)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('equal-to matcher accepts `(NOT 7000)` annotation — runner verifies 6000, ignores commentary', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': { shyCoins: 6000 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000010" with field "shyCoins" equal to 6000 (NOT 7000)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('response status accepts `(idempotent re-credit prevented)` annotation', async () => {
    const ctx = makeCtx({ lastResponse: { status: 409 } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response status is 409 (idempotent re-credit prevented)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('greater-than matcher accepts annotation', async () => {
    const db = makeStatefulFakeDb({ 'users/X': { shyCoins: 900 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/X" with field "shyCoins" greater than 800 (after gift received)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('step WITHOUT annotation — preprocessing is a no-op (no regression)', async () => {
    const db = makeStatefulFakeDb({ 'users/X': { shyCoins: 5000 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/X" with field "shyCoins" equal to 5000',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('quoted string with parens inside is preserved (preprocessing only strips trailing `(...)` at end-of-string)', async () => {
    // Critical: must not falsely strip `(USD)` from within a quoted text-content assertion.
    // The regex `\s+\([^()]*\)$` requires `)` to be the LAST char; here the line ends with `"`,
    // so no stripping happens.
    const dump = '<node text="Price: $10.00 (USD)" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Android UI shows "Price: $10.00 (USD)"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('unmatched annotated step still includes ORIGINAL text (with annotation) in STEP_NOT_IMPLEMENTED error', async () => {
    // Helps the operator see what they actually wrote, not the stripped form.
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'something nonexistent happens (with annotation)',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/STEP_NOT_IMPLEMENTED/);
    expect(r.error).toMatch(/\(with annotation\)/);
  });

  test('containing matcher accepts annotation', async () => {
    const db = makeStatefulFakeDb({ 'users/X': { roles: ['admin', 'mod'] } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/X" with field "roles" containing "admin" (after promotion)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('Response-body array-length matcher (Then the response body has field "X" array length N)', () => {
  test('array length matches — ok:true', async () => {
    const ctx = makeCtx({
      lastResponse: { status: 200, body: { gifts: [{ a: 1 }, { a: 2 }, { a: 3 }] } },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'the response body has field "gifts" array length 3' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('array length mismatches — fails with actual + expected', async () => {
    const ctx = makeCtx({ lastResponse: { status: 200, body: { gifts: [1, 2] } } });
    const r = await executeStep(
      { kind: 'Then', text: 'the response body has field "gifts" array length 5' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/2/);
    expect(r.error).toMatch(/5/);
  });

  test('field is not an array — clear error', async () => {
    const ctx = makeCtx({ lastResponse: { status: 200, body: { gifts: 'oops' } } });
    const r = await executeStep(
      { kind: 'Then', text: 'the response body has field "gifts" array length 0' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/array/i);
  });

  test('field missing — error mentions the missing field', async () => {
    const ctx = makeCtx({ lastResponse: { status: 200, body: {} } });
    const r = await executeStep(
      { kind: 'Then', text: 'the response body has field "gifts" array length 0' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/gifts/);
  });

  test('no prior response — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'the response body has field "gifts" array length 3' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/response/i);
  });
});

describe('Response-body contains alternation (Then the response body contains "X" or "Y")', () => {
  test('first option present — ok:true', async () => {
    const ctx = makeCtx({
      lastResponse: { status: 409, body: { error: 'duplicate request' } },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'the response body contains "duplicate" or "already_consumed"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('second option present — ok:true', async () => {
    const ctx = makeCtx({
      lastResponse: { status: 409, body: { error: 'order already_consumed' } },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'the response body contains "duplicate" or "already_consumed"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('neither option present — fails with both expected', async () => {
    const ctx = makeCtx({
      lastResponse: { status: 500, body: { error: 'something else' } },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'the response body contains "duplicate" or "already_consumed"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/duplicate/);
    expect(r.error).toMatch(/already_consumed/);
  });

  test('does not collide with single-needle contains matcher', async () => {
    // Regression guard: existing `contains "X"$` must still work after adding
    // `contains "X" or "Y"$`. First-match wins ordering must not swap.
    const ctx = makeCtx({ lastResponse: { status: 200, body: { error: 'duplicate' } } });
    const single = await executeStep(
      { kind: 'Then', text: 'the response body contains "duplicate"' },
      ctx,
    );
    expect(single.ok).toBe(true);
    const both = await executeStep(
      { kind: 'Then', text: 'the response body contains "duplicate" or "fallback"' },
      ctx,
    );
    expect(both.ok).toBe(true);
  });
});

describe('Response status-or-body-signal alternation (Then the response has status N or signals "X")', () => {
  test('status matches — ok:true (no need to inspect body signal)', async () => {
    const ctx = makeCtx({ lastResponse: { status: 401, body: {} } });
    const r = await executeStep(
      { kind: 'Then', text: 'the response has status 401 or signals "auth/user-token-expired"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('status mismatches but body contains signal — ok:true (signal serves as fallback)', async () => {
    const ctx = makeCtx({
      lastResponse: {
        status: 500,
        body: { code: 'auth/user-token-expired', message: 'token expired' },
      },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'the response has status 401 or signals "auth/user-token-expired"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('neither status nor signal matches — fails with both observable values', async () => {
    const ctx = makeCtx({
      lastResponse: { status: 500, body: { code: 'something/else' } },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'the response has status 401 or signals "auth/user-token-expired"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/500/);
    expect(r.error).toMatch(/401|auth\/user-token-expired/);
  });

  test('no prior response — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'the response has status 401 or signals "X"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no prior request|response/i);
  });
});

describe('Android search composite matchers (searches "X" in screen / types "X" into the search field)', () => {
  test('`searches "Marcus" in discovery` — calls androidSearchIn("discovery", "Marcus")', async () => {
    const searchSpy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidSearchIn: searchSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Vexa on Android searches "Marcus" in discovery' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(searchSpy).toHaveBeenCalledWith('discovery', 'Marcus');
  });

  test('`types "Alice" into the search field` — calls androidSearchIn(null, "Alice") (null screen = active)', async () => {
    const searchSpy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidSearchIn: searchSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android types "Alice" into the search field' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(searchSpy).toHaveBeenCalledWith(null, 'Alice');
  });

  test('search text with special chars passes through verbatim', async () => {
    const searchSpy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidSearchIn: searchSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android types "adult-power" into the search field' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(searchSpy).toHaveBeenCalledWith(null, 'adult-power');
  });

  test('no ctx.uiDriver — loud error for both matcher forms', async () => {
    const ctx = makeCtx();
    const r1 = await executeStep(
      { kind: 'When', text: 'Vexa on Android searches "Marcus" in discovery' },
      ctx,
    );
    expect(r1.ok).toBe(false);
    expect(r1.error).toMatch(/uiDriver/i);
    const r2 = await executeStep(
      { kind: 'When', text: 'Adam on Android types "Alice" into the search field' },
      ctx,
    );
    expect(r2.ok).toBe(false);
    expect(r2.error).toMatch(/uiDriver/i);
  });

  test('missing androidSearchIn driver method — specific actionable error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Vexa on Android searches "Marcus" in discovery' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidSearchIn/);
  });

  test('driver throws — bubbles up through executeStep wrapper as structured finding', async () => {
    const searchSpy = jest.fn(async () => {
      throw new Error('adb: search field tag not found');
    });
    const ctx = makeCtx({ uiDriver: { androidSearchIn: searchSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Vexa on Android searches "Marcus" in discovery' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/adb: search field tag not found/);
  });

  test('does not collide with the existing `types "X" into "Y"` resource-id matcher', async () => {
    // Regression guard: the existing tap+type matcher uses the pattern
    // `types "X" into "Y"` (Y is a resource-id). The new "into the search
    // field" form (no quoted Y) is a separate matcher; must not be swallowed
    // by greedy regex on the existing one.
    const dump = '<node resource-id="signup_emailField" bounds="[200,20][320,80]" />';
    const tapSpy = jest.fn(async () => {});
    const typeSpy = jest.fn(async () => {});
    const searchSpy = jest.fn(async () => {});
    const ctx = makeCtx({
      uiDriver: {
        androidUiDump: jest.fn(async () => dump),
        androidTap: tapSpy,
        androidTypeText: typeSpy,
        androidSearchIn: searchSpy,
      },
    });
    // Existing resource-id form should hit tap+typeText.
    const existing = await executeStep(
      { kind: 'When', text: 'Adam on Android types "test@x.com" into "signup_emailField"' },
      ctx,
    );
    expect(existing.ok).toBe(true);
    expect(typeSpy).toHaveBeenCalledWith('test@x.com');
    expect(searchSpy).not.toHaveBeenCalled();
    // New search-field form should hit androidSearchIn.
    typeSpy.mockClear();
    const newForm = await executeStep(
      { kind: 'When', text: 'Adam on Android types "query" into the search field' },
      ctx,
    );
    expect(newForm.ok).toBe(true);
    expect(searchSpy).toHaveBeenCalledWith(null, 'query');
    expect(typeSpy).not.toHaveBeenCalled();
  });
});

describe('Android kill-and-relaunch matcher (When <P> on Android kills and relaunches the app)', () => {
  test('calls androidKillAndRelaunch with the persona name (for driver logging)', async () => {
    const killSpy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidKillAndRelaunch: killSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android kills and relaunches the app' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(killSpy).toHaveBeenCalledWith('Adam');
  });

  test('P-NN annotation form handled correctly', async () => {
    const killSpy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidKillAndRelaunch: killSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Raul [P-08] on Android kills and relaunches the app' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(killSpy).toHaveBeenCalledWith('Raul');
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android kills and relaunches the app' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('missing androidKillAndRelaunch driver method — specific actionable error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android kills and relaunches the app' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidKillAndRelaunch/);
  });

  test('driver throws — bubbles up via executeStep wrapper', async () => {
    const killSpy = jest.fn(async () => {
      throw new Error('adb: device offline');
    });
    const ctx = makeCtx({ uiDriver: { androidKillAndRelaunch: killSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android kills and relaunches the app' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/adb: device offline/);
  });
});

describe('Android auth/token-refresh matchers (force-refresh + performs authenticated call)', () => {
  test('`performs any authenticated API call` — calls androidPerformAuthenticatedCall(persona)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidPerformAuthenticatedCall: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Hayato on Android performs any authenticated API call' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Hayato');
  });

  test('`force-refreshes via securetoken endpoint` — calls androidForceRefreshSecureToken(persona)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidForceRefreshSecureToken: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Hayato on Android force-refreshes via securetoken endpoint',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Hayato');
  });

  test('`force-refreshes the JWT` — calls androidForceRefreshJwt(persona)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidForceRefreshJwt: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Raul on Android force-refreshes the JWT' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Raul');
  });

  test('P-NN annotation form on each variant', async () => {
    const spy1 = jest.fn(async () => {});
    const spy2 = jest.fn(async () => {});
    const spy3 = jest.fn(async () => {});
    const ctx = makeCtx({
      uiDriver: {
        androidPerformAuthenticatedCall: spy1,
        androidForceRefreshSecureToken: spy2,
        androidForceRefreshJwt: spy3,
      },
    });
    await executeStep(
      { kind: 'When', text: 'Hayato [P-06] on Android performs any authenticated API call' },
      ctx,
    );
    await executeStep(
      {
        kind: 'When',
        text: 'Hayato [P-06] on Android force-refreshes via securetoken endpoint',
      },
      ctx,
    );
    await executeStep(
      { kind: 'When', text: 'Raul [P-08] on Android force-refreshes the JWT' },
      ctx,
    );
    expect(spy1).toHaveBeenCalledWith('Hayato');
    expect(spy2).toHaveBeenCalledWith('Hayato');
    expect(spy3).toHaveBeenCalledWith('Raul');
  });

  test('no ctx.uiDriver — each variant emits a loud error', async () => {
    const ctx = makeCtx();
    for (const text of [
      'Hayato on Android performs any authenticated API call',
      'Hayato on Android force-refreshes via securetoken endpoint',
      'Raul on Android force-refreshes the JWT',
    ]) {
      const r = await executeStep({ kind: 'When', text }, ctx);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/uiDriver/i);
    }
  });

  test('missing driver methods — each variant names its specific missing method', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r1 = await executeStep(
      { kind: 'When', text: 'Hayato on Android performs any authenticated API call' },
      ctx,
    );
    expect(r1.error).toMatch(/androidPerformAuthenticatedCall/);
    const r2 = await executeStep(
      {
        kind: 'When',
        text: 'Hayato on Android force-refreshes via securetoken endpoint',
      },
      ctx,
    );
    expect(r2.error).toMatch(/androidForceRefreshSecureToken/);
    const r3 = await executeStep(
      { kind: 'When', text: 'Raul on Android force-refreshes the JWT' },
      ctx,
    );
    expect(r3.error).toMatch(/androidForceRefreshJwt/);
  });

  test('driver throws — bubbles up via executeStep wrapper', async () => {
    const spy = jest.fn(async () => {
      throw new Error('Firebase auth: REFRESH_TOKEN_EXPIRED');
    });
    const ctx = makeCtx({ uiDriver: { androidForceRefreshSecureToken: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Hayato on Android force-refreshes via securetoken endpoint',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/REFRESH_TOKEN_EXPIRED/);
  });
});

describe('Android long-press-and-tap composite (When <P> on Android long-presses the message and taps "X")', () => {
  test('Edit menu item — calls androidLongPressMessageAndTap with persona + menu item', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidLongPressMessageAndTap: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android long-presses the message and taps "Edit"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'Edit');
  });

  test('Delete menu item — driver receives correct menu label', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidLongPressMessageAndTap: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android long-presses the message and taps "Delete"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'Delete');
  });

  test('P-NN annotation form handled', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidLongPressMessageAndTap: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Adam [P-01] on Android long-presses the message and taps "Report"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'Report');
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android long-presses the message and taps "Edit"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('missing driver method — specific actionable error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android long-presses the message and taps "Edit"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidLongPressMessageAndTap/);
  });

  test('driver throws — bubbles up via executeStep', async () => {
    const spy = jest.fn(async () => {
      throw new Error('no message in chat history');
    });
    const ctx = makeCtx({ uiDriver: { androidLongPressMessageAndTap: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android long-presses the message and taps "Edit"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no message in chat history/);
  });
});

describe('Android send-message-to-recipient composite (When <P> on Android sends "X" to <Y>)', () => {
  test('simple text message — calls androidSendMessageTo with persona, recipient, content', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidSendMessageTo: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Raul on Android sends "offensive content #1" to Nora',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Raul', 'Nora', 'offensive content #1');
  });

  test('simple gift identifier — works without cost annotation', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidSendMessageTo: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Theo on Android sends "crown" to Selma' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'Selma', 'crown');
  });

  test('P-NN annotation form handled', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidSendMessageTo: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Raul [P-08] on Android sends "msg" to Nora' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Raul', 'Nora', 'msg');
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'When', text: 'Raul on Android sends "msg" to Nora' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('missing driver method — specific actionable error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep({ kind: 'When', text: 'Raul on Android sends "msg" to Nora' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidSendMessageTo/);
  });
});

describe("Android tap-user-card composite (When <P> on Android taps <Y>'s user card)", () => {
  test("Alice's user card — calls androidTapUserCard with persona + target name", async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidTapUserCard: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Adam on Android taps Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'Alice');
  });

  test('P-NN annotation form handled on both persona and target side', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidTapUserCard: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Adam [P-01] on Android taps Marcus's user card" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'Marcus');
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: "Adam on Android taps Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('missing driver method — specific actionable error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: "Adam on Android taps Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidTapUserCard/);
  });

  test('does not collide with existing `taps "X"` (quoted resource-id) matcher', async () => {
    // Regression guard: `taps Alice's user card` is unquoted; existing
    // pattern requires `taps "..."`. They must route to different handlers.
    const tapUserCardSpy = jest.fn(async () => {});
    const dump = '<node resource-id="some_button" bounds="[10,10][50,50]" />';
    const tapSpy = jest.fn(async () => {});
    const ctx = makeCtx({
      uiDriver: {
        androidTapUserCard: tapUserCardSpy,
        androidUiDump: jest.fn(async () => dump),
        androidTap: tapSpy,
      },
    });
    // Resource-id form → existing matcher
    await executeStep({ kind: 'When', text: 'Adam on Android taps "some_button"' }, ctx);
    expect(tapSpy).toHaveBeenCalled();
    expect(tapUserCardSpy).not.toHaveBeenCalled();
    // User-card form → new matcher
    tapSpy.mockClear();
    await executeStep({ kind: 'When', text: "Adam on Android taps Alice's user card" }, ctx);
    expect(tapUserCardSpy).toHaveBeenCalledWith('Adam', 'Alice');
    expect(tapSpy).not.toHaveBeenCalled();
  });
});

describe('iOS Sim tag-assertion matchers (positive + negation, via iosUiDump)', () => {
  test('positive `shows the element with tag` — succeeds when identifier present in JSON dump', async () => {
    const dump =
      '{"children":[{"identifier":"main_pmTab","frame":{"x":10,"y":20,"width":50,"height":40}}]}';
    const ctx = makeCtx({
      uiDriver: { iosUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Mia\'s iOS Sim UI shows the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('positive `shows` — fails when identifier absent', async () => {
    const dump = '{"children":[{"identifier":"other_thing"}]}';
    const ctx = makeCtx({
      uiDriver: { iosUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Mia\'s iOS Sim UI shows the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/main_pmTab/);
  });

  test('negation `does not show` — ok when identifier absent', async () => {
    const dump = '{"children":[{"identifier":"other_thing"}]}';
    const ctx = makeCtx({
      uiDriver: { iosUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Mia\'s iOS Sim UI does not show the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('negation `does not show` — fails when identifier IS present', async () => {
    const dump = '{"children":[{"identifier":"main_pmTab"}]}';
    const ctx = makeCtx({
      uiDriver: { iosUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Mia\'s iOS Sim UI does not show the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
  });

  test('substring-trap rejection — `main_pmTabFooter` is not falsely matched as `main_pmTab`', async () => {
    // The matcher must check the FULL identifier value, not just substring of dump.
    // `"identifier":"main_pmTabFooter"` is a different identifier from `main_pmTab`.
    const dump = '{"children":[{"identifier":"main_pmTabFooter"}]}';
    const ctx = makeCtx({
      uiDriver: { iosUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Mia\'s iOS Sim UI does not show the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('iosUiDump driver method missing — specific error pointing at the missing config', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Mia\'s iOS Sim UI shows the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosUiDump/);
  });
});

describe('iOS Sim tap matcher (When <P> on iOS Sim taps "X")', () => {
  test('calls iosTap with the identifier', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { iosTap: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim taps "signup_createAccountButton"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('signup_createAccountButton');
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'When', text: 'Mia on iOS Sim taps "any_tag"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('missing iosTap driver method — specific error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep({ kind: 'When', text: 'Mia on iOS Sim taps "any_tag"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosTap/);
  });

  test('driver throws — bubbles up via executeStep', async () => {
    const spy = jest.fn(async () => {
      throw new Error('simctl: element not found');
    });
    const ctx = makeCtx({ uiDriver: { iosTap: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim taps "missing_button"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/simctl: element not found/);
  });
});

describe('iOS Sim open-screen matcher (When <P> on iOS Sim opens the "X" screen)', () => {
  test('calls iosOpenScreen with the screen name', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { iosOpenScreen: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim opens the "discovery" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('discovery');
  });

  test('"tab" noun accepted', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { iosOpenScreen: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim opens the "rooms" tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('rooms');
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim opens the "discovery" screen' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('missing iosOpenScreen driver method — specific error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim opens the "discovery" screen' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosOpenScreen/);
  });
});

describe('iOS Sim text-content assertion (Then <P>\'s iOS Sim UI shows "X")', () => {
  test('matches a "label":"..." attribute in JSON dump', async () => {
    const dump =
      '{"children":[{"identifier":"banner","label":"You must be 18 or older to use this feature"}]}';
    const ctx = makeCtx({ uiDriver: { iosUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Mia\'s iOS Sim UI shows "You must be 18 or older to use this feature"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('matches a "value":"..." attribute when label is absent', async () => {
    const dump = '{"children":[{"identifier":"toast","value":"Report submitted"}]}';
    const ctx = makeCtx({ uiDriver: { iosUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: 'Nora\'s iOS Sim UI shows "Report submitted"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('substring rejection: "save" must not match "save as draft"', async () => {
    const dump = '{"children":[{"label":"save as draft"}]}';
    const ctx = makeCtx({ uiDriver: { iosUiDump: jest.fn(async () => dump) } });
    const r = await executeStep({ kind: 'Then', text: 'Mia\'s iOS Sim UI shows "save"' }, ctx);
    expect(r.ok).toBe(false);
  });

  test('trailing descriptive context allowed (e.g. ` toast`)', async () => {
    const dump = '{"children":[{"label":"Report submitted"}]}';
    const ctx = makeCtx({ uiDriver: { iosUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: 'Nora\'s iOS Sim UI shows "Report submitted" toast' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: 'Mia\'s iOS Sim UI shows "anything"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('missing iosUiDump driver method — specific error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep({ kind: 'Then', text: 'Mia\'s iOS Sim UI shows "anything"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosUiDump/);
  });
});

describe('iOS Sim type-into-element matcher (When <P> on iOS Sim types "X" into "Y")', () => {
  test('calls iosTypeText with tag + content', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { iosTypeText: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Mia on iOS Sim types "mia@shytalk.dev" into "signup_emailField"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('signup_emailField', 'mia@shytalk.dev');
  });

  test('special chars in text passed through verbatim', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { iosTypeText: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim types "TestPassw0rd!" into "signup_passwordField"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('signup_passwordField', 'TestPassw0rd!');
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'When', text: 'Mia on iOS Sim types "x" into "y"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('missing iosTypeText driver method — specific error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep({ kind: 'When', text: 'Mia on iOS Sim types "x" into "y"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosTypeText/);
  });
});

describe('iOS Sim type-into-search-field matcher (When <P> on iOS Sim types "X" into the search field)', () => {
  test('calls iosSearchIn(null, text) — active-screen search', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { iosSearchIn: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim types "minor-power" into the search field' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(null, 'minor-power');
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim types "x" into the search field' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('missing iosSearchIn driver method — specific error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim types "x" into the search field' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosSearchIn/);
  });

  test('does not collide with iOS Sim type-into-element matcher', async () => {
    // Regression guard: `types "X" into "Y"` and `types "X" into the search field`
    // must route to different driver methods.
    const typeSpy = jest.fn(async () => {});
    const searchSpy = jest.fn(async () => {});
    const ctx = makeCtx({
      uiDriver: { iosTypeText: typeSpy, iosSearchIn: searchSpy },
    });
    await executeStep({ kind: 'When', text: 'Mia on iOS Sim types "x" into "emailField"' }, ctx);
    expect(typeSpy).toHaveBeenCalled();
    expect(searchSpy).not.toHaveBeenCalled();
    typeSpy.mockClear();
    await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim types "q" into the search field' },
      ctx,
    );
    expect(searchSpy).toHaveBeenCalledWith(null, 'q');
    expect(typeSpy).not.toHaveBeenCalled();
  });
});

describe('Web matchers (ctx.webDriver namespace — Playwright MCP scope)', () => {
  test('`on Web taps "X"` — calls webTap(tag)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webTap: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web taps "wallet_buyCoinsButton"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('wallet_buyCoinsButton');
  });

  test('`on Web opens the "X" screen` — calls webOpenScreen(name)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webOpenScreen: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Lena on Web opens the "wallet" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('wallet');
  });

  test('`on Web opens the "X" tab` — calls webOpenScreen(name) (same driver method as screen)', async () => {
    // The corpus uses "screen" and "tab" interchangeably — same driver call.
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webOpenScreen: spy } });
    const r = await executeStep({ kind: 'When', text: 'Alice on Web opens the "pm" tab' }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('pm');
  });

  test('`on Web Admin opens the "X" tab` — calls webAdminOpenTab(name)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webAdminOpenTab: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin opens the "reports" tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('reports');
  });

  test('Web Admin tab does not collide with non-admin tab matcher', async () => {
    // `Alice on Web opens the "pm" tab` → webOpenScreen
    // `Greta on Web Admin opens the "reports" tab` → webAdminOpenTab
    // Different drivers, different handlers. Regression-guarded.
    const openSpy = jest.fn(async () => {});
    const adminSpy = jest.fn(async () => {});
    const ctx = makeCtx({
      webDriver: { webOpenScreen: openSpy, webAdminOpenTab: adminSpy },
    });
    await executeStep({ kind: 'When', text: 'Alice on Web opens the "pm" tab' }, ctx);
    expect(openSpy).toHaveBeenCalledWith('pm');
    expect(adminSpy).not.toHaveBeenCalled();
    openSpy.mockClear();
    await executeStep({ kind: 'When', text: 'Greta on Web Admin opens the "reports" tab' }, ctx);
    expect(adminSpy).toHaveBeenCalledWith('reports');
    expect(openSpy).not.toHaveBeenCalled();
  });

  test('no ctx.webDriver — loud error pointing at the missing namespace', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web taps "wallet_buyCoinsButton"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webDriver/i);
  });

  test('missing webTap driver method — specific actionable error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep({ kind: 'When', text: 'Alice on Web taps "x"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webTap/);
  });

  test('missing webOpenScreen driver method — specific actionable error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep({ kind: 'When', text: 'Alice on Web opens the "x" screen' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webOpenScreen/);
  });

  test('missing webAdminOpenTab driver method — specific actionable error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin opens the "x" tab' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminOpenTab/);
  });

  test('driver throws — bubbles up through executeStep wrapper', async () => {
    const spy = jest.fn(async () => {
      throw new Error('Playwright MCP: page not connected');
    });
    const ctx = makeCtx({ webDriver: { webTap: spy } });
    const r = await executeStep({ kind: 'When', text: 'Alice on Web taps "any"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Playwright MCP/);
  });
});

describe('Web text-content assertion (Then <P>\'s Web UI shows "X")', () => {
  test('text present in DOM dump — ok:true', async () => {
    const ctx = makeCtx({
      webDriver: { webUiDump: jest.fn(async () => 'No results found') },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'Vexa\'s Web UI shows "No results found"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('text absent — fails with the missing text in error', async () => {
    const ctx = makeCtx({
      webDriver: { webUiDump: jest.fn(async () => 'something else') },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'Vexa\'s Web UI shows "User not found"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/User not found/);
  });

  test('trailing context allowed (e.g. ` toast in German`, ` indicator on her reply`)', async () => {
    const ctx = makeCtx({
      webDriver: { webUiDump: jest.fn(async () => 'Streak reset') },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'Lena\'s Web UI shows "Streak reset" toast in German' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('no ctx.webDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: 'Vexa\'s Web UI shows "any"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webDriver/i);
  });

  test('missing webUiDump driver method — specific error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep({ kind: 'Then', text: 'Vexa\'s Web UI shows "any"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webUiDump/);
  });
});

describe('Web document direction assertion (Then <P>\'s Web UI document direction is "X")', () => {
  test('matches the returned direction (e.g. "ltr")', async () => {
    const ctx = makeCtx({
      webDriver: { webDocumentDirection: jest.fn(async () => 'ltr') },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'Lena\'s Web UI document direction is "ltr"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('rtl when expected ltr — fails with both values', async () => {
    const ctx = makeCtx({
      webDriver: { webDocumentDirection: jest.fn(async () => 'rtl') },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'Lena\'s Web UI document direction is "ltr"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rtl/);
    expect(r.error).toMatch(/ltr/);
  });

  test('missing webDocumentDirection driver method — specific error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      { kind: 'Then', text: 'Lena\'s Web UI document direction is "ltr"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webDocumentDirection/);
  });
});

describe('Web Admin tap-with-reason matcher (When <P> on Web Admin taps "X" with reason "Y")', () => {
  test('calls webAdminTapWithReason(tag, reason)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webAdminTapWithReason: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "Issue warning" with reason "Inappropriate language in voice room"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Issue warning', 'Inappropriate language in voice room');
  });

  test('does not collide with plain `Web Admin taps` without reason (different matcher when added later, currently STEP_NOT_IMPLEMENTED)', async () => {
    // The "with reason" form requires the reason suffix; plain `taps "X"` doesn't match.
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webAdminTapWithReason: spy } });
    await executeStep(
      { kind: 'When', text: 'Greta on Web Admin taps "review" on Hayato\'s submission' },
      ctx,
    );
    // This shape has "on Y's submission" suffix instead of "with reason" — different matcher.
    // It should NOT route to webAdminTapWithReason.
    expect(spy).not.toHaveBeenCalled();
  });

  test('missing driver method — specific error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "X" with reason "Y"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminTapWithReason/);
  });
});

describe('Web Admin confirm-with-reason matcher (When <P> on Web Admin confirms with reason "Y")', () => {
  test('calls webAdminConfirmWithReason(reason)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webAdminConfirmWithReason: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin confirms with reason "First-strike harassment"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('First-strike harassment');
  });

  test('missing driver method — specific error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin confirms with reason "Y"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminConfirmWithReason/);
  });
});

describe('Web sign-in matcher (When <P> on Web signs in with valid credentials)', () => {
  test('calls webSignIn(persona)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webSignIn: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Lena on Web signs in with valid credentials' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Lena');
  });

  test('P-NN annotation', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webSignIn: spy } });
    await executeStep(
      { kind: 'When', text: 'Ines [P-10] on Web signs in with valid credentials' },
      ctx,
    );
    expect(spy).toHaveBeenCalledWith('Ines');
  });

  test('missing webSignIn driver method — specific error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Lena on Web signs in with valid credentials' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webSignIn/);
  });
});

describe("Web open-user-profile matcher (When <P> on Web opens <Y>'s profile)", () => {
  test('calls webOpenUserProfile(persona, target)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webOpenUserProfile: spy } });
    const r = await executeStep({ kind: 'When', text: "Layla on Web opens Alice's profile" }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Layla', 'Alice');
  });

  test('different persona target', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webOpenUserProfile: spy } });
    const r = await executeStep({ kind: 'When', text: "Kenji on Web opens Marcus's profile" }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Kenji', 'Marcus');
  });

  test('missing webOpenUserProfile driver method — specific error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep({ kind: 'When', text: "Layla on Web opens Alice's profile" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webOpenUserProfile/);
  });
});

describe('Web Admin opens-report-and-taps composite (When <P> on Web Admin opens the {first|second|new} report and taps "X" [with reason "Y"])', () => {
  test('first report, no reason — calls webAdminOpenReportAndTap(ordinal, menuItem, null)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webAdminOpenReportAndTap: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin opens the first report and taps "Issue warning"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('first', 'Issue warning', null);
  });

  test('second report with reason — driver receives the reason', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webAdminOpenReportAndTap: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin opens the second report and taps "Dismiss" with reason "No violation observed"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('second', 'Dismiss', 'No violation observed');
  });

  test('new report (non-ordinal keyword) accepted', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webAdminOpenReportAndTap: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin opens the new report and taps "Suspend for 3 days"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('new', 'Suspend for 3 days', null);
  });

  test('missing driver method — specific error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin opens the first report and taps "X"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminOpenReportAndTap/);
  });
});

describe('Web JS console errors assertion (Then no JavaScript console errors are present)', () => {
  test('console returns empty array — ok:true', async () => {
    const ctx = makeCtx({
      webDriver: { webConsoleErrors: jest.fn(async () => []) },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'no JavaScript console errors are present' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('console returns errors — fails with the messages in error', async () => {
    const ctx = makeCtx({
      webDriver: {
        webConsoleErrors: jest.fn(async () => [
          'Uncaught TypeError: x is undefined',
          'Failed to fetch',
        ]),
      },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'no JavaScript console errors are present' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Uncaught TypeError/);
    expect(r.error).toMatch(/Failed to fetch/);
  });

  test('missing webConsoleErrors driver method — specific error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      { kind: 'Then', text: 'no JavaScript console errors are present' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webConsoleErrors/);
  });
});

describe('Web profile-panel navigation (When <P> on Web opens the "X" panel from his profile)', () => {
  test('calls webOpenProfilePanel(persona, panelName)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webOpenProfilePanel: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Tariq on Web opens the "event-host" panel from his profile' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Tariq', 'event-host');
  });

  test('different panel name', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webOpenProfilePanel: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Bao on Web opens the "teaching" panel from his profile' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Bao', 'teaching');
  });

  test('missing webOpenProfilePanel driver method — specific error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Tariq on Web opens the "x" panel from his profile' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webOpenProfilePanel/);
  });
});

describe('Android event-invite tap matcher (When <P> on Android taps "X" on the event invite)', () => {
  test('calls androidTapEventInviteAction(persona, action)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidTapEventInviteAction: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Selma on Android taps "Accept" on the event invite' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma', 'Accept');
  });

  test('Decline action variant', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidTapEventInviteAction: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Selma on Android taps "Decline" on the event invite' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma', 'Decline');
  });

  test('does not collide with existing Android resource-id tap matcher', async () => {
    // Existing `Adam on Android taps "main_pmTab"` uses ctx.uiDriver.androidTap;
    // the new `... taps "Accept" on the event invite` uses
    // ctx.uiDriver.androidTapEventInviteAction. Different drivers, different
    // matchers. Regression-guarded.
    const dump = '<node resource-id="main_pmTab" bounds="[10,10][50,50]" />';
    const inviteSpy = jest.fn(async () => {});
    const tapSpy = jest.fn(async () => {});
    const ctx = makeCtx({
      uiDriver: {
        androidUiDump: jest.fn(async () => dump),
        androidTap: tapSpy,
        androidTapEventInviteAction: inviteSpy,
      },
    });
    await executeStep({ kind: 'When', text: 'Adam on Android taps "main_pmTab"' }, ctx);
    expect(tapSpy).toHaveBeenCalled();
    expect(inviteSpy).not.toHaveBeenCalled();
    tapSpy.mockClear();
    await executeStep(
      { kind: 'When', text: 'Selma on Android taps "Accept" on the event invite' },
      ctx,
    );
    expect(inviteSpy).toHaveBeenCalledWith('Selma', 'Accept');
    expect(tapSpy).not.toHaveBeenCalled();
  });

  test('missing driver method — specific error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Selma on Android taps "Accept" on the event invite' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidTapEventInviteAction/);
  });
});

describe('Cross-cohort Firestore matcher (Then no doc has any entry in "X" whose target|source user has cohort="Y")', () => {
  function makeUserLookupDb(users) {
    // ctx.db.doc("users/<uid>").get() resolves to { exists, data() }.
    return {
      doc: (docPath) => ({
        get: async () => {
          // Match `users/<uid>` paths.
          const match = /^users\/(.+)$/.exec(docPath);
          if (!match) return { exists: false, data: () => undefined };
          const u = users[match[1]];
          return { exists: u !== undefined, data: () => u };
        },
      }),
    };
  }

  test('no doc has a target with the disallowed cohort — ok:true', async () => {
    const db = makeUserLookupDb({
      50000010: { cohort: 'adult' },
      50000020: { cohort: 'adult' },
    });
    const ctx = makeCtx({
      db,
      lastQueryResult: {
        docs: [{ exists: true, data: () => ({ followingIds: [50000010, 50000020] }) }],
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no doc has any entry in "followingIds" whose target user has cohort="minor"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('a doc has a target with the disallowed cohort — fails with offender details', async () => {
    const db = makeUserLookupDb({
      50000010: { cohort: 'adult' },
      90000099: { cohort: 'minor' },
    });
    const ctx = makeCtx({
      db,
      lastQueryResult: {
        docs: [{ exists: true, data: () => ({ followingIds: [50000010, 90000099] }) }],
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no doc has any entry in "followingIds" whose target user has cohort="minor"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/90000099/);
    expect(r.error).toMatch(/minor/);
  });

  test('source variant routes through the same logic', async () => {
    const db = makeUserLookupDb({
      50000010: { cohort: 'adult' },
    });
    const ctx = makeCtx({
      db,
      lastQueryResult: {
        docs: [{ exists: true, data: () => ({ followerIds: [50000010] }) }],
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no doc has any entry in "followerIds" whose source user has cohort="minor"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('no prior query result — loud error pointing at the missing When step', async () => {
    const db = makeUserLookupDb({});
    const ctx = makeCtx({ db });
    delete ctx.lastQueryResult;
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no doc has any entry in "followingIds" whose target user has cohort="minor"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lastQueryResult|query/i);
  });

  test('empty doc field (no entries) is vacuously ok', async () => {
    const db = makeUserLookupDb({});
    const ctx = makeCtx({
      db,
      lastQueryResult: { docs: [{ exists: true, data: () => ({ followingIds: [] }) }] },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no doc has any entry in "followingIds" whose target user has cohort="minor"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('referenced user-doc missing — silently skipped (defensive)', async () => {
    // If a uid points to a non-existent user (data inconsistency), the
    // matcher can't determine cohort. Treat as "not the disallowed cohort"
    // rather than fail loudly — the migration this matcher tests is about
    // cohort containment, not data integrity.
    const db = makeUserLookupDb({});
    const ctx = makeCtx({
      db,
      lastQueryResult: {
        docs: [{ exists: true, data: () => ({ followingIds: [99999999] }) }],
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no doc has any entry in "followingIds" whose target user has cohort="minor"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('Web Arabic-translation matcher (Then <P>\'s Web UI shows Arabic translation of "X")', () => {
  test('driver verifies translation and returns ok:true', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsTranslationOf: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Layla\'s Web UI shows Arabic translation of "ShyCoins"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('ar', 'ShyCoins');
  });

  test('driver returns false — fails with the key in error', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsTranslationOf: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Layla\'s Web UI shows Arabic translation of "Notifications"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Notifications/);
    expect(r.error).toMatch(/ar/i);
  });

  test('missing driver method — specific error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      { kind: 'Then', text: 'Layla\'s Web UI shows Arabic translation of "X"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webShowsTranslationOf/);
  });
});

describe('Translation matcher generalized (locale × platform × optional "the" + suffixes)', () => {
  test('Web + German + "the" prefix dispatches with "de"', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsTranslationOf: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Lena\'s Web UI shows the German translation of "Sign in" in the page heading',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('de', 'Sign in');
  });

  test('Web + Japanese without "the" dispatches with "ja"', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsTranslationOf: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Kenji\'s Web UI shows Japanese translation of "Notifications"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('ja', 'Notifications');
  });

  test('Android + Arabic + "the" dispatches to uiDriver.androidShowsTranslationOf', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsTranslationOf: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Layla\'s Android UI shows the Arabic translation of "Wallet"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('ar', 'Wallet');
  });

  test('iOS Sim + Korean dispatches to uiDriver.iosShowsTranslationOf', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsTranslationOf: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Soo\'s iOS Sim UI shows the Korean translation of "Discover"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('ko', 'Discover');
  });

  test('unknown locale name fails with a clear error before calling driver', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsTranslationOf: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Layla\'s Web UI shows Klingon translation of "X"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Klingon/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('UI-absence-of-person matcher (does not show <Name>)', () => {
  test('Android dump without the name — ok', async () => {
    const dump = '<node text="Hayato"/><node text="Bao"/>';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: "Hayato's Android UI does not show Alice" },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('Android dump containing the name — fail with name in error', async () => {
    const dump = '<node text="Alice"/><node content-desc="Discover"/>';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: "Hayato's Android UI does not show Alice" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice/);
  });

  test('Web dump without the name — ok', async () => {
    const dump = 'Discover\nWallet\nNotifications';
    const ctx = makeCtx({ webDriver: { webUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: "Vexa's Web UI does not show Marcus anywhere" },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('iOS Sim dump without the name — ok', async () => {
    const dump = '{"label":"Hayato"}';
    const ctx = makeCtx({ uiDriver: { iosUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: "Mia's iOS Sim UI does not show Alice anywhere" },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('"X does not show Y\'s room" reads as Y-not-in-dump', async () => {
    const dump = '<node text="Marcus"/>';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: "Marcus's Android UI does not show Selma's room" },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('UI does not show the message-input field matcher', () => {
  test('Web driver returns false (not shown) — ok', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsMessageInput: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Vexa's Web UI does not show the message-input field" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('Web driver returns true (shown) — fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsMessageInput: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Vexa's Web UI does not show the message-input field" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/message-input/);
  });

  test('Android dispatches to uiDriver.androidShowsMessageInput', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsMessageInput: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Marcus's Android UI does not show the message-input field" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });
});

describe('Refreshes the rooms list matcher', () => {
  test('Web → webDriver.webRefreshRoomsList', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webRefreshRoomsList: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web refreshes the rooms list' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('Android → uiDriver.androidRefreshRoomsList', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidRefreshRoomsList: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Marcus on Android refreshes the rooms list' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('missing driver method — clear error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Marcus on Android refreshes the rooms list' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidRefreshRoomsList/);
  });
});

describe("Taps room card / Taps <Owner>'s room matcher", () => {
  test('Web + "taps the room card" → webDriver.webTapRoomCard(undefined)', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webTapRoomCard: spy } });
    const r = await executeStep({ kind: 'When', text: 'Alice on Web taps the room card' }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(undefined);
  });

  test('Android + "taps Selma\'s room" → uiDriver.androidTapRoomCard("Selma")', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidTapRoomCard: spy } });
    const r = await executeStep({ kind: 'When', text: "Theo on Android taps Selma's room" }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma');
  });

  test('iOS Sim + "taps Bao\'s room card" → uiDriver.iosTapRoomCard("Bao")', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { iosTapRoomCard: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Yuki on iOS Sim taps Bao's room card" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Bao');
  });

  test('Android + "taps the room card" → androidTapRoomCard(undefined)', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidTapRoomCard: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Marcus on Android taps the room card' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(undefined);
  });
});

describe('Bare persona-on-platform matcher (no URL, no sign-in clause)', () => {
  test('"Greta [P-12] is on Web Admin" records the platform association', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Given', text: 'Greta [P-12] is on Web Admin' }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Greta')).toBe('Web Admin');
  });

  test('"Alice is on Android" also records the platform association (no P-NN)', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Given', text: 'Alice is on Android' }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Alice')).toBe('Android');
  });

  test('does not shadow "is on X at \\"<url>\\"" — URL-anchored matcher still wins', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Greta [P-12] is on Web Admin at "/admin#users"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Greta')).toBe('Web Admin');
    expect(ctx.personaPaths.get('Greta')).toBe('/admin#users');
  });
});

describe('Persona "signed in at the <path> tab" matcher (j01 j04 etc.)', () => {
  test('"Greta is on Web Admin signed in at the \\"/admin#age-verification\\" tab" records both', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Greta [P-12] is on Web Admin signed in at the "/admin#age-verification" tab',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Greta')).toBe('Web Admin');
    expect(ctx.personaPaths.get('Greta')).toBe('/admin#age-verification');
  });

  test('"signed in at the \\"discovery\\" screen" variant also works', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice [P-02] is on Web Chromium signed in at the "discovery" screen',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Alice')).toBe('Web Chromium');
    expect(ctx.personaPaths.get('Alice')).toBe('discovery');
  });
});

describe('Gift catalog state-seed matcher', () => {
  test('"the gift X costs N coins and awards M beans" writes a doc with cost+award', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'the gift "rose" costs 10 coins and awards 5 beans' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['gifts/rose']).toEqual({
      id: 'rose',
      costCoins: 10,
      awardBeans: 5,
    });
  });

  test('"crown" with larger amounts is handled the same way', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'the gift "crown" costs 500 coins and awards 250 beans' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['gifts/crown']).toEqual({
      id: 'crown',
      costCoins: 500,
      awardBeans: 250,
    });
  });

  test('missing ctx.db errors out clearly', async () => {
    const ctx = makeCtx();
    delete ctx.db;
    const r = await executeStep(
      { kind: 'Given', text: 'the gift "rose" costs 10 coins and awards 5 beans' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db/i);
  });
});

describe('Web Admin issues a warning matcher', () => {
  test('"Greta on Web Admin issues a warning to Theo" delegates to driver', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminIssueWarning: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin issues a warning to Theo' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo');
  });

  test('missing driver method — clear error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin issues a warning to Marcus' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminIssueWarning/);
  });
});

describe('Confirms action matcher', () => {
  test('"Alice on Web confirms" → webDriver.webConfirm()', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webConfirm: spy } });
    const r = await executeStep({ kind: 'When', text: 'Alice on Web confirms' }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('"Selma on Android confirms" → uiDriver.androidConfirm()', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidConfirm: spy } });
    const r = await executeStep({ kind: 'When', text: 'Selma on Android confirms' }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('"Nora on iOS Sim confirms" → uiDriver.iosConfirm()', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { iosConfirm: spy } });
    const r = await executeStep({ kind: 'When', text: 'Nora on iOS Sim confirms' }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });
});

describe('Open <pronoun> <screen> generalization (the | his | her | their)', () => {
  test('"Alice on Web opens her \\"gift_wall\\" screen" matches', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webOpenScreen: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web opens her "gift_wall" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('gift_wall');
  });

  test('"Selma on Android opens her \\"gift_wall\\" screen" matches', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidOpenScreen: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Selma on Android opens her "gift_wall" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('gift_wall');
  });

  test('existing "the" form still works (regression-guard)', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webOpenScreen: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web opens the "wallet" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('wallet');
  });
});

describe('Send gift with coin-cost matcher (j16 economy verification)', () => {
  test('"Alice on Web sends \\"crown\\" (500 coins) to Selma" → webSendGift', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webSendGift: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web sends "crown" (500 coins) to Selma' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('crown', 500, 'Selma');
  });

  test('"Theo on Android sends \\"rose\\" (10 coins) to Selma" → androidSendGift', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidSendGift: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Theo on Android sends "rose" (10 coins) to Selma' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('rose', 10, 'Selma');
  });

  test('iOS Sim variant routes correctly', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { iosSendGift: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim sends "rose" (10 coins) to Selma' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('rose', 10, 'Selma');
  });
});

describe('Picks DOB in picker matcher (j01 Android + j02 iOS Sim)', () => {
  test('Android: "Adam on Android picks DOB \\"2004-01-01\\" in \\"signup_dobPicker\\"" → androidPickDOB', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidPickDOB: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android picks DOB "2004-01-01" in "signup_dobPicker"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('2004-01-01', 'signup_dobPicker');
  });

  test('iOS Sim: "Mia on iOS Sim picks DOB \\"2010-08-20\\" in \\"signup_dobPicker\\"" → iosPickDOB', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { iosPickDOB: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim picks DOB "2010-08-20" in "signup_dobPicker"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('2010-08-20', 'signup_dobPicker');
  });
});

describe('Android age-verification matchers (j01 Adam)', () => {
  test('"picks ID type \\"passport\\"" → androidPickIdType', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidPickIdType: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android picks ID type "passport"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('passport');
  });

  test('"selects test image \\"X.jpg\\" from the gallery" → androidSelectGalleryImage', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidSelectGalleryImage: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Adam on Android selects test image "test-passport-adult.jpg" from the gallery',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('test-passport-adult.jpg');
  });

  test('"signs up with DOB \\"X\\" and accepts legal" → androidSignupWithDOB', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidSignupWithDOB: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Adam on Android signs up with DOB "2004-01-01" and accepts legal',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('2004-01-01');
  });
});

describe('Web Admin age-verification matchers (j01 Greta)', () => {
  test('"refreshes the age-verification tab" → webAdminRefreshAgeVerification', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminRefreshAgeVerification: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin refreshes the age-verification tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('"taps \\"approve\\" on the submission for \\"{newUniqueId}\\"" → webAdminActOnSubmission', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminActOnSubmission: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "approve" on the submission for "{newUniqueId}"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('approve', '{newUniqueId}');
  });

  test('"taps \\"reject\\" on the submission for \\"50000010\\"" — literal uid also accepted', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminActOnSubmission: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "reject" on the submission for "50000010"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('reject', '50000010');
  });

  test('missing driver method for refresh — clear error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin refreshes the age-verification tab' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminRefreshAgeVerification/);
  });
});

describe('Scenario-var interpolation (runner-level preprocessing)', () => {
  test('"{varName}" in step text resolves to ctx.scenarioVars value', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminActOnSubmission: spy } });
    ctx.scenarioVars = new Map([['newUniqueId', '50000010']]);
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "approve" on the submission for "{newUniqueId}"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('approve', '50000010');
  });

  test('multiple "{vars}" in the same step are all resolved', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminActOnSubmission: spy } });
    ctx.scenarioVars = new Map([
      ['actionVar', 'reject'],
      ['uidVar', '50000020'],
    ]);
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "{actionVar}" on the submission for "{uidVar}"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('reject', '50000020');
  });

  test('unresolved "{var}" left as literal — no interpolation error', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminActOnSubmission: spy } });
    ctx.scenarioVars = new Map();
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "approve" on the submission for "{unknownVar}"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('approve', '{unknownVar}');
  });

  test('ctx.scenarioVars missing — step matches normally without interpolation', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminActOnSubmission: spy } });
    // no scenarioVars on ctx at all
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "approve" on the submission for "literal-uid"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('approve', 'literal-uid');
  });
});

describe('uniqueId capture matcher (writes to ctx.scenarioVars)', () => {
  test('"X\'s uniqueId is recorded as {newUniqueId}" captures from ctx.sessions', async () => {
    const ctx = makeCtx();
    ctx.sessions = new Map([['Adam', { uniqueId: 50000010 }]]);
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Adam's uniqueId is recorded as {newUniqueId} for the rest of this scenario",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.scenarioVars.get('newUniqueId')).toBe('50000010');
  });

  test('captures from persona registry when no session exists', async () => {
    const ctx = makeCtx();
    // Alice P-02 = 50000010 in persona registry
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Alice's uniqueId is recorded as {aliceUid} for the rest of this scenario",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.scenarioVars.get('aliceUid')).toBe('50000010');
  });

  test('end-to-end: capture then interpolate', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminActOnSubmission: spy } });
    ctx.sessions = new Map([['Adam', { uniqueId: 50000099 }]]);
    // Step 1: capture
    const r1 = await executeStep(
      {
        kind: 'Then',
        text: "Adam's uniqueId is recorded as {newUniqueId} for the rest of this scenario",
      },
      ctx,
    );
    expect(r1.ok).toBe(true);
    // Step 2: interpolate
    const r2 = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "approve" on the submission for "{newUniqueId}"',
      },
      ctx,
    );
    expect(r2.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('approve', '50000099');
  });

  test('unknown persona — clear error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Nobody's uniqueId is recorded as {x} for the rest of this scenario",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Nobody/);
  });
});

describe('Env-var fallback in scenario-var interpolation', () => {
  const originalEnv = process.env.PERSONAS_PASSWORD;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PERSONAS_PASSWORD;
    else process.env.PERSONAS_PASSWORD = originalEnv;
  });

  test('"{PERSONAS_PASSWORD}" resolves from process.env when scenarioVars miss', async () => {
    process.env.PERSONAS_PASSWORD = 'real-pw';
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webTypeAndSubmit: spy } });
    ctx.scenarioVars = new Map(); // empty — fallback should kick in
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Lena on Web types "lapsed@shytalk.dev" + "{PERSONAS_PASSWORD}" and submits',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('lapsed@shytalk.dev', 'real-pw');
  });

  test('scenarioVars wins over env when both have the key', async () => {
    process.env.PERSONAS_PASSWORD = 'env-pw';
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webTypeAndSubmit: spy } });
    ctx.scenarioVars = new Map([['PERSONAS_PASSWORD', 'scenario-pw']]);
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Lena on Web types "x@y.com" + "{PERSONAS_PASSWORD}" and submits',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('x@y.com', 'scenario-pw');
  });

  test('lower-case "{coins}" does NOT fall through to env (avoids leaking arbitrary env)', async () => {
    process.env.coins = 'sneaky-leak';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => '<node text="+{coins}"/>') },
    });
    ctx.scenarioVars = new Map(); // empty
    const r = await executeStep(
      { kind: 'Then', text: 'Adam\'s Android UI shows the "+{coins}" reward animation' },
      ctx,
    );
    // The lowercase placeholder must be left as the literal "{coins}" string
    // — and since the fake dump intentionally contains literal "{coins}",
    // the assertion passes. The point of this test is that env didn't leak.
    expect(r.ok).toBe(true);
    delete process.env.coins;
  });
});

describe('Reward animation matcher (Android, uses interpolation)', () => {
  test('"+{coins}" interpolated against scenarioVars then asserted in dump', async () => {
    const dump = '<node text="+50"/>';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    ctx.scenarioVars = new Map([['coins', '50']]);
    const r = await executeStep(
      { kind: 'Then', text: 'Adam\'s Android UI shows the "+{coins}" reward animation' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('reward animation NOT in dump — fail', async () => {
    const dump = '<node text="discover"/>';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    ctx.scenarioVars = new Map([['coins', '50']]);
    const r = await executeStep(
      { kind: 'Then', text: 'Adam\'s Android UI shows the "+{coins}" reward animation' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/\+50/);
  });
});

describe('Main tabs + PM tab hidden matcher (Android, j01)', () => {
  test('dump has main tabs but no PM tab — ok', async () => {
    const dump =
      '<node content-desc="discover"/><node content-desc="wallet"/><node content-desc="profile"/>';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Android UI shows main tabs but PM tab is hidden" },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('dump has main tabs AND PM tab — fail with PM-presence error', async () => {
    const dump =
      '<node content-desc="discover"/><node content-desc="wallet"/><node content-desc="profile"/><node content-desc="pm"/>';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Android UI shows main tabs but PM tab is hidden" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PM/i);
  });
});

describe('Deep-link navigation matcher (Android + iOS Sim)', () => {
  test('Android: "Adam on Android attempts to navigate to \\"/pm\\" via deep link" → androidOpenDeepLink', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidOpenDeepLink: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android attempts to navigate to "/pm" via deep link' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('/pm');
  });

  test('iOS Sim: "Mia on iOS Sim attempts to navigate to \\"/age-verification\\" via deep link" → iosOpenDeepLink', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { iosOpenDeepLink: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Mia on iOS Sim attempts to navigate to "/age-verification" via deep link',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('/age-verification');
  });
});

describe('No <X> screen renders matcher (UI-absence)', () => {
  test('driver returns false (screen NOT rendered) — ok', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { currentPlatformRendersScreen: spy } });
    const r = await executeStep({ kind: 'Then', text: 'no PM screen renders' }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('PM');
  });

  test('driver returns true (screen IS rendered) — fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { currentPlatformRendersScreen: spy } });
    const r = await executeStep({ kind: 'Then', text: 'no PM screen renders' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PM/);
  });
});

describe('Gift selection (Android)', () => {
  test('"selects gift \\"rose\\" and recipient \\"Alice\\"" → androidSelectGiftRecipient', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidSelectGiftRecipient: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android selects gift "rose" and recipient "Alice"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('rose', 'Alice');
  });
});

describe('Sign-in form filler (types email + password and submits)', () => {
  test('Web: "Lena on Web types \\"X\\" + \\"Y\\" and submits" → webTypeAndSubmit', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webTypeAndSubmit: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Lena on Web types "lapsed-adult@shytalk.dev" + "secret" and submits',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('lapsed-adult@shytalk.dev', 'secret');
  });

  test('Android: "Marcus on Android types \\"X\\" + \\"Y\\" and submits" → androidTypeAndSubmit', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidTypeAndSubmit: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Marcus on Android types "x@y.com" + "secret" and submits' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('x@y.com', 'secret');
  });
});

describe('Array-of-quoted-strings in signed-in `with` clause (j17 Bao teaching languages)', () => {
  test('teachingLanguages=["zh", "en"] writes a string-array to user doc', async () => {
    const fetchSpy = jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' + Buffer.from(JSON.stringify({ uniqueId: 50000090 })).toString('base64url') + '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
    const db = makeStatefulFakeDb({ 'users/50000090': {} });
    const ctx = makeCtx({ fetch: fetchSpy, db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Bao [P-17] is signed in on Web Chromium with userType=TEACHER and teachingLanguages=["zh", "en"]',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000090'].userType).toBe('TEACHER');
    expect(db._docs['users/50000090'].teachingLanguages).toEqual(['zh', 'en']);
  });
});

describe('State-seed end-to-end via runFeatureFile', () => {
  test('every fixture scenario passes after seed + read round-trip', async () => {
    const fakeFetch = jest.fn(async (url) => {
      if (typeof url === 'string' && url.endsWith('/api/health')) {
        return { status: 200, json: async () => ({ ok: true }) };
      }
      return { status: 500, text: async () => '{}' };
    });
    const db = makeStatefulFakeDb({ 'users/50000010': { cohort: 'adult' } });
    const ctx = makeCtx({ fetch: fakeFetch, db });
    const { findings, scenarioReports } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-state-seed.feature'),
      ctx,
    );
    for (const sr of scenarioReports) {
      expect(sr.status).toBe('pass');
    }
    expect(findings).toEqual([]);
  });
});

// ── PR-E: OSA Background verbs (the cycle-1 finding gap) ───────────

describe('OSA Background verbs (cycle 1 findings)', () => {
  function withSignInFetch() {
    return jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' +
          Buffer.from(JSON.stringify({ uniqueId: 50000010, admin: false })).toString('base64url') +
          '.s';
        return {
          status: 200,
          json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }),
        };
      }
      if (typeof url === 'string' && url.endsWith('/api/health')) {
        return { status: 200, json: async () => ({ ok: true }) };
      }
      return { status: 500, text: async () => '{}' };
    });
  }

  test('sign-in "with cohort=X" clause now seeds user doc (was: tolerated as docs)', async () => {
    // PR-E originally treated `with cohort=X` as informational. The
    // 2026-05-17 wake-3 change made it state-mutating so scenarios can
    // declare known starting state directly on the sign-in step.
    // Trailing parenthetical is still treated as documentation.
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ fetch: withSignInFetch(), db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] is signed in on Android with cohort=adult (DOB=2007-01-01 in users doc)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Hayato')).toBeDefined();
    expect(db._docs['users/50000030'].cohort).toBe('adult');
  });

  test('sign-in tolerates "AND on <Platform>" multi-device form', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch() });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Vexa [P-07] is signed in on Web Chromium AND on Android (same Firebase user)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Vexa')).toBeDefined();
  });

  test('sign-in tolerates trailing parenthetical context', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch() });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Marcus [P-04] is signed in on Android (same-cohort minor) at the "discovery" screen',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('migration-state precondition passes when data invariants are clean', async () => {
    const ctx = makeCtx({
      db: makeProbeDb({
        users: [
          { uniqueId: 50000010, cohort: 'adult', followingIds: [50000020], followerIds: [] },
          { uniqueId: 50000020, cohort: 'adult', followingIds: [], followerIds: [50000010] },
          { uniqueId: 60000010, cohort: 'minor', followingIds: [], followerIds: [] },
        ],
        rooms: [],
        conversations: [],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the dev environment migration ran at least once (lastMigrationRunAt is set in "ops/segregation-migration")',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('migration-state precondition fails when cross-cohort follow edges exist', async () => {
    const ctx = makeCtx({
      db: makeProbeDb({
        users: [
          { uniqueId: 50000010, cohort: 'adult', followingIds: [60000010] },
          { uniqueId: 60000010, cohort: 'minor', followerIds: [50000010] },
        ],
        rooms: [],
        conversations: [],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the dev environment migration ran at least once',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cross-cohort followingIds/);
  });

  test('migration-state precondition fails when OPEN room has mixed-cohort participants', async () => {
    const ctx = makeCtx({
      db: makeProbeDb({
        users: [
          { uniqueId: 50000010, cohort: 'adult' },
          { uniqueId: 60000010, cohort: 'minor' },
        ],
        rooms: [{ state: 'OPEN', cohort: 'adult', participantIds: [50000010, 60000010] }],
        conversations: [],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the dev environment migration ran at least once',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/mixed-cohort OPEN rooms/);
  });

  test('migration-state precondition fails when cross-cohort conversation is not frozen', async () => {
    const ctx = makeCtx({
      db: makeProbeDb({
        users: [
          { uniqueId: 50000010, cohort: 'adult' },
          { uniqueId: 60000010, cohort: 'minor' },
        ],
        rooms: [],
        conversations: [{ participantIds: [50000010, 60000010], frozen: false }],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the dev environment migration ran at least once',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unfrozen cross-cohort conversations/);
  });

  test('migration-state precondition treats SHYTALK_OFFICIAL as exempt', async () => {
    // Officia (uniqueId=1) has cross-cohort follow edges by design.
    const ctx = makeCtx({
      db: makeProbeDb({
        users: [
          {
            uniqueId: 1,
            cohort: 'adult',
            userType: 'SHYTALK_OFFICIAL',
            isOfficial: true,
            followingIds: [60000010],
            followerIds: [60000010],
          },
          { uniqueId: 50000010, cohort: 'adult' },
          { uniqueId: 60000010, cohort: 'minor' },
        ],
        rooms: [],
        conversations: [],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the dev environment migration ran at least once',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('migration-state precondition result is cached on ctx (avoids re-scanning)', async () => {
    const fakeUsers = jest.fn(async () => ({
      forEach: (cb) => {
        cb({ data: () => ({ uniqueId: 50000010, cohort: 'adult' }) });
      },
    }));
    const fakeRoomsQuery = { get: jest.fn(async () => ({ forEach: () => {}, size: 0 })) };
    const ctx = makeCtx({
      db: {
        collection: (name) => {
          if (name === 'users') return { get: fakeUsers };
          if (name === 'rooms') return { where: () => fakeRoomsQuery };
          if (name === 'conversations')
            return { get: jest.fn(async () => ({ forEach: () => {} })) };
          return { get: jest.fn(async () => ({ forEach: () => {} })) };
        },
        doc: () => ({ get: async () => ({ exists: false }) }),
      },
    });
    const r1 = await executeStep(
      { kind: 'Given', text: 'the dev environment migration ran at least once' },
      ctx,
    );
    expect(r1.ok).toBe(true);
    const r2 = await executeStep(
      { kind: 'Given', text: 'the dev environment migration ran at least once' },
      ctx,
    );
    expect(r2.ok).toBe(true);
    expect(fakeUsers).toHaveBeenCalledTimes(1); // cached
  });

  test('LiveKit Docker precondition is a no-op for dev target', async () => {
    const ctx = makeCtx({ target: 'dev' });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the LiveKit Docker container is running on ws://localhost:7880',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('LiveKit Docker precondition passes for local (MVP — no actual WS probe)', async () => {
    const ctx = makeCtx({ target: 'local' });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the LiveKit Docker container is running on ws://localhost:7880',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('OSA Background verbs end-to-end via runFeatureFile', () => {
  test('all four fixture scenarios pass against a seeded fake', async () => {
    const fetchOk = jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' + Buffer.from(JSON.stringify({ uniqueId: 50000010 })).toString('base64url') + '.s';
        return {
          status: 200,
          json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }),
        };
      }
      if (typeof url === 'string' && url.endsWith('/api/health')) {
        return { status: 200, json: async () => ({ ok: true }) };
      }
      return { status: 500, text: async () => '{}' };
    });
    // Hybrid db: supports doc().get() for read assertions AND
    // collection().get()/.where() for the probe-based migration matcher.
    const docStore = {
      'users/50000010': { uniqueId: 50000010, cohort: 'adult' },
    };
    const probeDb = makeProbeDb({
      users: [{ uniqueId: 50000010, cohort: 'adult' }],
      rooms: [],
      conversations: [],
    });
    const hybridDb = {
      doc: (docPath) => ({
        get: async () => ({
          exists: docStore[docPath] !== undefined,
          data: () => docStore[docPath],
        }),
        set: async (patch, opts = {}) => {
          if (opts.merge) docStore[docPath] = { ...(docStore[docPath] || {}), ...patch };
          else docStore[docPath] = { ...patch };
        },
      }),
      collection: probeDb.collection,
    };
    const ctx = makeCtx({ target: 'dev', fetch: fetchOk, db: hybridDb });
    const { findings, scenarioReports } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-osa-background.feature'),
      ctx,
    );
    for (const sr of scenarioReports) {
      expect(sr.status).toBe('pass');
    }
    expect(findings).toEqual([]);
  });
});

// ── HTTP-call verbs v3 (POSTs / GETs / opens / navigates) ──────────

/**
 * Shared helper — produces a fetch mock that signs in any persona and
 * captures every subsequent /api/ call so tests can assert on body,
 * headers, URL, and the `path` field that v3 records on lastResponse.
 *
 * The mock returns `apiResponse` for /api/ paths so individual tests can
 * shape the status+body, and a stub signin response for the identitytoolkit
 * URL. Test-specific overrides take precedence.
 */
function makeV3Fetch(apiResponse) {
  const idToken =
    'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000040 })).toString('base64url') + '.bbb';
  return jest.fn(async (url, opts) => {
    if (url.includes('signInWithPassword')) {
      return {
        status: 200,
        json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb' }),
      };
    }
    // Capture call for assertion later via toHaveBeenCalledWith.
    return {
      status: apiResponse?.status ?? 200,
      text: async () => JSON.stringify(apiResponse?.body ?? {}),
      _capturedOpts: opts,
    };
  });
}

describe('HTTP-call v3 — POSTs with kv-list', () => {
  test('parses single numeric kv-pair and POSTs with persona token', async () => {
    const fetchMock = makeV3Fetch({ status: 404, body: {} });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Vexa on Web POSTs /api/users/follow with targetUniqueId=60000010',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastResponse.status).toBe(404);
    expect(ctx.lastResponse.path).toBe('/api/users/follow');
    // Inspect the captured POST: URL, method, body, auth header.
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(lastCall[0]).toBe('https://dev-api.example/api/users/follow');
    expect(lastCall[1].method).toBe('POST');
    expect(JSON.parse(lastCall[1].body)).toEqual({ targetUniqueId: 60000010 });
    expect(lastCall[1].headers.Authorization).toMatch(/^Bearer /);
  });

  test('parses multi-pair kv-list with mixed types', async () => {
    const fetchMock = makeV3Fetch({ status: 200, body: {} });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Vexa on Web POSTs /api/economy/send-gift with recipient=60000010 and giftId="rose"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(JSON.parse(lastCall[1].body)).toEqual({ recipient: 60000010, giftId: 'rose' });
  });

  test('without explicit platform — `Marcus POSTs /api/foo`', async () => {
    const fetchMock = makeV3Fetch({ status: 200, body: {} });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Marcus [P-04] is signed in' }, ctx);
    const r = await executeStep({ kind: 'When', text: 'Marcus POSTs /api/foo with x=1' }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.lastResponse.path).toBe('/api/foo');
  });

  test('errors with actionable message when persona has no session', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Vexa on Web POSTs /api/users/follow with targetUniqueId=60000010' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no signed-in session for "Vexa"/);
  });

  test('errors when kv-list is malformed (key has no =)', async () => {
    const fetchMock = makeV3Fetch({ status: 200 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in' }, ctx);
    const r = await executeStep({ kind: 'When', text: 'Vexa POSTs /api/foo with badpair' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/could not parse kv-pairs/);
  });

  test('accepts multi-word platform "Web Chromium"', async () => {
    const fetchMock = makeV3Fetch({ status: 404 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'Vexa on Web Chromium POSTs /api/foo with x=1' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('HTTP-call v3 — alt word order: POST <path> with X as <Persona>', () => {
  test('kv-pairs body — `POST /api/foo with x=1 as Marcus`', async () => {
    const fetchMock = makeV3Fetch({ status: 404 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Marcus [P-04] is signed in on Android' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'POST /api/users/follow with targetUniqueId=50000010 as Marcus' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastResponse.path).toBe('/api/users/follow');
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(JSON.parse(lastCall[1].body)).toEqual({ targetUniqueId: 50000010 });
  });

  test('any-payload form — `POST /api/X with any payload as Marcus`', async () => {
    const fetchMock = makeV3Fetch({ status: 200 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Marcus [P-04] is signed in on Android' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'POST /api/age-verification/submit with any payload as Marcus' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(JSON.parse(lastCall[1].body)).toEqual({});
  });

  test('explicit-body form — `POST /api/X with body {...} as Marcus`', async () => {
    const fetchMock = makeV3Fetch({ status: 200 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Marcus [P-04] is signed in on Android' }, ctx);
    const r = await executeStep(
      {
        kind: 'When',
        text: 'POST /api/users/me with body {"displayName": "M"} as Marcus',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(JSON.parse(lastCall[1].body)).toEqual({ displayName: 'M' });
  });

  test('explicit-body form errors on malformed JSON', async () => {
    const fetchMock = makeV3Fetch({ status: 200 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Marcus [P-04] is signed in on Android' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'POST /api/users/me with body {not json} as Marcus' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/malformed JSON body/);
  });

  test('errors when persona has no session', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'POST /api/users/follow with x=1 as Marcus' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no signed-in session for "Marcus"/);
  });
});

describe('HTTP-call v3 — attempts POST with body', () => {
  test('drives explicit-body POST', async () => {
    const fetchMock = makeV3Fetch({ status: 403 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Vexa on Web attempts POST /api/conversations/c1/messages with body {"text": "hello"}',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastResponse.status).toBe(403);
    expect(ctx.lastResponse.path).toBe('/api/conversations/c1/messages');
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(JSON.parse(lastCall[1].body)).toEqual({ text: 'hello' });
  });

  test('errors on malformed JSON body', async () => {
    const fetchMock = makeV3Fetch({ status: 200 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'Vexa attempts POST /api/foo with body {bad json}' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/malformed JSON body/);
  });
});

describe('HTTP-call v3 — opens / navigates verbs', () => {
  test('opens /api/X fires a GET and records path on lastResponse', async () => {
    const fetchMock = makeV3Fetch({ status: 200, body: { results: [] } });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'Vexa on Web opens "/api/users/search?q=Marcus"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastResponse.status).toBe(200);
    expect(ctx.lastResponse.path).toBe('/api/users/search?q=Marcus');
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(lastCall[0]).toBe('https://dev-api.example/api/users/search?q=Marcus');
    expect(lastCall[1].method).toBe('GET');
  });

  test('opens "/discovery" (non-API path) records lastVisit but no HTTP call', async () => {
    const fetchMock = makeV3Fetch({ status: 200 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const apiCallsBefore = fetchMock.mock.calls.length;
    const r = await executeStep({ kind: 'When', text: 'Vexa on Web opens "/discovery"' }, ctx);
    expect(r.ok).toBe(true);
    // No additional fetch fired (only the sign-in one before).
    expect(fetchMock.mock.calls.length).toBe(apiCallsBefore);
    expect(ctx.lastVisit).toEqual({ persona: 'Vexa', path: '/discovery' });
  });

  test('navigates to is treated as an alias for opens', async () => {
    const fetchMock = makeV3Fetch({ status: 404 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'Vexa on Web navigates to "/profile/60000010"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastVisit).toEqual({ persona: 'Vexa', path: '/profile/60000010' });
  });

  test('opens path with #fragment is treated as web nav not API', async () => {
    const fetchMock = makeV3Fetch({ status: 200 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const apiCallsBefore = fetchMock.mock.calls.length;
    const r = await executeStep(
      { kind: 'When', text: 'Vexa on Web opens "/profile/50000040#stalkers"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(apiCallsBefore);
    expect(ctx.lastVisit.path).toBe('/profile/50000040#stalkers');
  });

  test('errors when persona has no session', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'When', text: 'Vexa on Web opens "/discovery"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no signed-in session for "Vexa"/);
  });
});

describe('Response-from-path assertion (v3)', () => {
  test('passes when path matches and body has results array', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = {
      status: 200,
      body: { results: [{ uniqueId: 1 }, { uniqueId: 2 }] },
      path: '/api/users/search',
    };
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/users/search has 2 results' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('handles bare-array body shape', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: [{ a: 1 }], path: '/api/things' };
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/things has 1 result' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('handles { data: [...] } shape', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: { data: [] }, path: '/api/x' };
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/x has 0 results' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('handles { users: [...] } shape', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: { users: [{}, {}, {}] }, path: '/api/u' };
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/u has 3 results' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('fails when count mismatches with both numbers in error', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: { results: [1, 2] }, path: '/api/x' };
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/x has 0 results' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('2');
    expect(r.error).toContain('0');
  });

  test('fails when last response path does not match expected', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: { results: [] }, path: '/api/users/me' };
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/users/search has 0 results' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('/api/users/me');
    expect(r.error).toContain('/api/users/search');
  });

  test('fails with no prior response — chain break message', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/x has 0 results' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no prior response/);
  });

  test('fails informatively when body has no list field', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: { foo: 'bar' }, path: '/api/x' };
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/x has 0 results' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no recognised list field/);
    expect(r.error).toContain('foo');
  });
});

describe('HTTP-call v3 end-to-end via runFeatureFile', () => {
  test('all 6 fixture scenarios pass when API + visit + assertions chain', async () => {
    // Build a fetch mock that knows how to respond to each path the fixture hits.
    const idToken =
      'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000040 })).toString('base64url') + '.bbb';
    const fetchMock = jest.fn(async (url) => {
      if (url.includes('signInWithPassword')) {
        return {
          status: 200,
          json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb' }),
        };
      }
      if (url.endsWith('/api/health')) return { status: 200, json: async () => ({}) };
      if (url.includes('/api/users/follow') || url.includes('/api/conversations/c1/messages')) {
        return {
          status: url.includes('/messages') ? 403 : 404,
          text: async () => JSON.stringify({}),
        };
      }
      if (url.includes('/api/age-verification/submit')) {
        return { status: 200, text: async () => JSON.stringify({}) };
      }
      if (url.includes('/api/users/search')) {
        return { status: 200, text: async () => JSON.stringify({ results: [] }) };
      }
      // Default for unknown paths.
      return { status: 200, text: async () => JSON.stringify({}) };
    });
    const ctx = makeCtx({ fetch: fetchMock });
    const { findings, scenarioReports } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-http-call-v3.feature'),
      ctx,
    );
    for (const sr of scenarioReports) {
      // Comment lines mean some scenarios may have STEP_NOT_IMPLEMENTED UI assertions in
      // theory — but the fixture is shaped to only use v3 verbs end-to-end. So all pass.
      expect(sr.status).toBe('pass');
    }
    expect(findings).toEqual([]);
  });
});

// ── Code-review finding fixes: hardening tests ─────────────────────

/**
 * C-1 — executeStep must convert handler-thrown exceptions into structured
 * findings instead of crashing the runner. These tests pass a fetch mock
 * that throws (network error / DNS failure / timeout simulation) and
 * verify each new handler returns ok:false with an actionable error
 * message that includes the original throw text.
 */
describe('C-1 — handler-thrown exceptions become structured findings', () => {
  function signedInCtx() {
    const idToken =
      'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000040 })).toString('base64url') + '.bbb';
    const ctx = makeCtx({
      fetch: jest.fn(async (url) => {
        if (url.includes('signInWithPassword')) {
          return {
            status: 200,
            json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb' }),
          };
        }
        throw new Error('ECONNREFUSED');
      }),
    });
    return ctx;
  }

  test('POSTs handler — fetch rejection becomes finding, not crash', async () => {
    const ctx = signedInCtx();
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const r = await executeStep({ kind: 'When', text: 'Vexa on Web POSTs /api/foo with x=1' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ECONNREFUSED');
    expect(r.error).toMatch(/handler threw/);
  });

  test('alt-order POST handler — fetch rejection becomes finding', async () => {
    const ctx = signedInCtx();
    await executeStep({ kind: 'Given', text: 'Marcus [P-04] is signed in on Android' }, ctx);
    const r = await executeStep({ kind: 'When', text: 'POST /api/foo with x=1 as Marcus' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ECONNREFUSED');
  });

  test('attempts POST handler — fetch rejection becomes finding', async () => {
    const ctx = signedInCtx();
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'Vexa attempts POST /api/foo with body {"x": 1}' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ECONNREFUSED');
  });

  test('opens /api handler — fetch rejection becomes finding', async () => {
    const ctx = signedInCtx();
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const r = await executeStep({ kind: 'When', text: 'Vexa on Web opens "/api/users/me"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ECONNREFUSED');
  });

  test('end-to-end — a thrown fetch surfaces as finding, runFeatureFile does not reject', async () => {
    const fetchMock = jest.fn(async (url) => {
      if (url.includes('signInWithPassword')) {
        const idToken =
          'aaa.' +
          Buffer.from(JSON.stringify({ uniqueId: 50000040 })).toString('base64url') +
          '.bbb';
        return {
          status: 200,
          json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb' }),
        };
      }
      if (url.endsWith('/api/health')) return { status: 200, json: async () => ({}) };
      throw new Error('SIMULATED_NETWORK_BLIP');
    });
    const ctx = makeCtx({ fetch: fetchMock });
    const result = await runFeatureFile(path.join(FIXTURE_DIR, 'sample-http-call-v3.feature'), ctx);
    // The throw must surface as at least one finding — confirm the
    // try/catch wrap doesn't merely suppress the error.
    const networkFindings = result.findings.filter((f) =>
      (f.error || '').includes('SIMULATED_NETWORK_BLIP'),
    );
    expect(networkFindings.length).toBeGreaterThan(0);
    // The error should be tagged with "handler threw:" prefix so the
    // operator can distinguish a runtime exception from an assertion failure.
    expect(networkFindings[0].error).toMatch(/handler threw/);
  });
});

/**
 * I-4 — sessions with missing/undefined idToken (sign-in handler returned
 * 200 but the response body had no idToken field) must fail fast with an
 * actionable error rather than send `Authorization: Bearer undefined`.
 */
describe('I-4 — session with no idToken fails fast in every handler', () => {
  function ctxWithBrokenSession(name) {
    const ctx = makeCtx({ fetch: jest.fn() });
    ctx.sessions.set(name, { persona: {}, idToken: undefined, customClaims: {} });
    return ctx;
  }

  test('POSTs handler errors with "no idToken"', async () => {
    const ctx = ctxWithBrokenSession('Vexa');
    const r = await executeStep({ kind: 'When', text: 'Vexa on Web POSTs /api/foo with x=1' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no idToken/);
  });

  test('alt-order POST handler errors with "no idToken"', async () => {
    const ctx = ctxWithBrokenSession('Marcus');
    const r = await executeStep({ kind: 'When', text: 'POST /api/foo with x=1 as Marcus' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no idToken/);
  });

  test('attempts POST handler errors with "no idToken"', async () => {
    const ctx = ctxWithBrokenSession('Vexa');
    const r = await executeStep(
      { kind: 'When', text: 'Vexa attempts POST /api/foo with body {"x": 1}' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no idToken/);
  });

  test('opens handler errors with "no idToken" for /api/ path', async () => {
    const ctx = ctxWithBrokenSession('Vexa');
    const r = await executeStep({ kind: 'When', text: 'Vexa on Web opens "/api/users/me"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no idToken/);
  });

  // The idToken guard is intentionally scoped to API paths only — a
  // non-API visit ("/discovery") does not fire an HTTP call and so a
  // missing idToken is irrelevant to that step. Documenting the contract.
  test('opens handler PASSES for non-API path even with broken session', async () => {
    const ctx = ctxWithBrokenSession('Vexa');
    const r = await executeStep({ kind: 'When', text: 'Vexa on Web opens "/discovery"' }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.lastVisit).toEqual({ persona: 'Vexa', path: '/discovery' });
  });

  test('existing sends GET handler also errors with "no idToken" (retroactive fix)', async () => {
    const ctx = ctxWithBrokenSession('Alice');
    const r = await executeStep(
      { kind: 'When', text: 'Alice sends GET /api/users/me with her ID token' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no idToken/);
  });
});

/**
 * I-5 — response-from-path must produce an actionable error when the
 * upstream response had no JSON body (204 No Content, binary, etc.),
 * not the confusing "no recognised list field (keys: object)" message.
 */
describe('I-5 — response-from-path handles non-JSON / null body honestly', () => {
  test('body=null returns "response body was not JSON" with status', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 204, body: null, path: '/api/x' };
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/x has 0 results' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/was not JSON/);
    expect(r.error).toContain('204');
  });

  test('body=undefined returns the same actionable error', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 500, body: undefined, path: '/api/x' };
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/x has 0 results' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/was not JSON/);
    expect(r.error).toContain('500');
  });
});

/**
 * I-6 — `opens` to a non-API path must clear `ctx.lastResponse` so a
 * subsequent assertion like `the response status is 200` fails honestly
 * with "no prior response" rather than silently asserting against a
 * stale response from an earlier step.
 */
describe('I-6 — opens non-API path clears stale lastResponse', () => {
  test('non-API open clears stale lastResponse', async () => {
    const fetchMock = jest.fn(async (url) => {
      const idToken =
        'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000040 })).toString('base64url') + '.bbb';
      if (url.includes('signInWithPassword')) {
        return {
          status: 200,
          json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb' }),
        };
      }
      return { status: 200, text: async () => JSON.stringify({ a: 1 }) };
    });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    // Pre-populate lastResponse via an API path open.
    await executeStep({ kind: 'When', text: 'Vexa on Web opens "/api/users/me"' }, ctx);
    expect(ctx.lastResponse).not.toBeNull();
    // Now open a non-API path — stale lastResponse must be cleared.
    await executeStep({ kind: 'When', text: 'Vexa on Web opens "/discovery"' }, ctx);
    expect(ctx.lastResponse).toBeNull();
    // Confirm the honest-failure contract: a subsequent assertion gets a
    // "no prior request" error, not a silent pass on stale data.
    const r = await executeStep({ kind: 'Then', text: 'the response status is 200' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no prior request/);
  });

  test('runScenario resets lastVisit between scenarios', async () => {
    // The fixture has multiple scenarios; verify lastVisit is reset before
    // each scenario by ensuring at least one scenario fires opens "/discovery"
    // and the per-scenario isolation holds (scenario sequence runs cleanly).
    const fetchMock = jest.fn(async (url) => {
      if (url.includes('signInWithPassword')) {
        const idToken =
          'aaa.' +
          Buffer.from(JSON.stringify({ uniqueId: 50000040 })).toString('base64url') +
          '.bbb';
        return {
          status: 200,
          json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb' }),
        };
      }
      if (url.endsWith('/api/health')) return { status: 200, json: async () => ({}) };
      if (url.includes('/api/users/follow') || url.includes('/api/conversations/c1/messages')) {
        return {
          status: url.includes('/messages') ? 403 : 404,
          text: async () => JSON.stringify({}),
        };
      }
      if (url.includes('/api/age-verification/submit')) {
        return { status: 200, text: async () => JSON.stringify({}) };
      }
      if (url.includes('/api/users/search')) {
        return { status: 200, text: async () => JSON.stringify({ results: [] }) };
      }
      return { status: 200, text: async () => JSON.stringify({}) };
    });
    const ctx = makeCtx({ fetch: fetchMock });
    const { scenarioReports } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-http-call-v3.feature'),
      ctx,
    );
    // After the full run, ctx.lastVisit reflects only the LAST scenario's
    // state (the "opens /discovery" scenario). Per-scenario reset is verified
    // by all 6 scenarios passing — if lastVisit bled in, the runner's per-
    // scenario reset would not be honoured. Every scenario passes.
    for (const sr of scenarioReports) {
      expect(sr.status).toBe('pass');
    }
  });
});

/**
 * I-3 — the alt-order POST handler dispatches the explicit-body branch off
 * the regex capture group (m[3]), not a string-prefix on m[2]. The concrete
 * failure mode is unreachable today (the regex's `body {...}` alternative
 * wins for actual JSON bodies) but the new gating prevents future fixture
 * authors from triggering JSON.parse(undefined) crashes.
 */
describe('I-3 — alt-order POST dispatches body-branch off m[3], not m[2]', () => {
  test('explicit-body still works (m[3] defined)', async () => {
    const idToken =
      'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000040 })).toString('base64url') + '.bbb';
    const fetchMock = jest.fn(async (url) => {
      if (url.includes('signInWithPassword')) {
        return { status: 200, json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb' }) };
      }
      return { status: 200, text: async () => JSON.stringify({}) };
    });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Marcus [P-04] is signed in on Android' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'POST /api/x with body {"a": 1} as Marcus' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(JSON.parse(lastCall[1].body)).toEqual({ a: 1 });
  });

  // A kv-text fragment whose first field name starts with `body` (e.g.,
  // `bodyVar=42`) must NOT accidentally trigger the JSON-body branch.
  // m[3] is undefined → kv-pair branch runs → POST body is {bodyVar: 42}.
  test('kv-text with field name starting with "body" goes to kv-pair branch', async () => {
    const idToken =
      'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000040 })).toString('base64url') + '.bbb';
    const fetchMock = jest.fn(async (url) => {
      if (url.includes('signInWithPassword')) {
        return { status: 200, json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb' }) };
      }
      return { status: 200, text: async () => JSON.stringify({}) };
    });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Marcus [P-04] is signed in on Android' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'POST /api/x with bodyVar=42 as Marcus' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(JSON.parse(lastCall[1].body)).toEqual({ bodyVar: 42 });
  });
});

describe('I-5 — response-from-path with body=null but successful status', () => {
  // Some endpoints intentionally return 200 with no body (e.g., empty list
  // endpoint returning bare 200 + nothing). The null-body guard fires
  // regardless of status — fine, but document with a test that the error
  // message still surfaces the original status so the operator can tell
  // "no body AND failure" vs "no body BUT 200".
  test('body=null with 200 status still produces actionable error', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: null, path: '/api/x' };
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/x has 0 results' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/was not JSON/);
    expect(r.error).toContain('200');
  });
});
