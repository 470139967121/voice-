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
        text: 'Alice [P-02] is signed in on Android with shyCoins=5000',
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
