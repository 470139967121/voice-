/**
 * Tests for the Cloudflare Pages Function middleware that locks down
 * non-prod hostnames (no indexing + basic auth gate).
 *
 * The middleware lives in `functions/_middleware.js` (loaded by
 * Cloudflare Pages at edge) and intercepts every request. To keep the
 * logic unit-testable without spinning up workerd / miniflare, we
 * export pure helpers from a sibling `functions/_lib/lockdown.js`
 * file:
 *   - isProdHostname(hostname) — returns true for the canonical prod
 *     host and only that one
 *   - shouldServeBlockingRobots(hostname) — true for non-prod
 *   - blockingRobotsBody() — the literal robots.txt content for non-prod
 *   - basicAuthOk(authorizationHeader, expectedPassword) — boolean
 *   - basicAuthChallenge() — the Response shape for a 401 prompt
 *
 * The middleware then composes those helpers; this test pins each
 * piece. The composed middleware itself is tested via a thin
 * `handleRequest()` function that takes `(request, env)` and returns a
 * `Response` — testable by feeding fake Request objects.
 */

const {
  isProdHostname,
  isProdApiHostname,
  shouldServeBlockingRobots,
  blockingRobotsBody,
  basicAuthOk,
  basicAuthChallenge,
  noIndexHeaderValue,
  PROD_HOSTNAME,
  PROD_API_HOSTNAME,
} = require('../../../functions/_lib/lockdown.js');

describe('isProdHostname', () => {
  test('returns true for the canonical prod host only', () => {
    expect(isProdHostname('shytalk.shyden.co.uk')).toBe(true);
  });

  test('returns false for the dev host', () => {
    expect(isProdHostname('dev.shytalk.shyden.co.uk')).toBe(false);
  });

  test('returns false for the Cloudflare Pages preview host', () => {
    // wrangler pages deploy publishes a preview at e.g.
    // `<sha>.<project>.pages.dev`. These must NOT be treated as prod.
    expect(isProdHostname('abc1234.shytalk-site-dev.pages.dev')).toBe(false);
    expect(isProdHostname('shytalk-site-dev.pages.dev')).toBe(false);
  });

  test('returns false for localhost / 127.0.0.1', () => {
    expect(isProdHostname('localhost')).toBe(false);
    expect(isProdHostname('127.0.0.1')).toBe(false);
  });

  test('case-insensitive match', () => {
    // DNS is case-insensitive; the underlying hostname comparison
    // should mirror that. A prod-but-uppercased Host header must NOT
    // accidentally trip the dev gate.
    expect(isProdHostname('SHYTALK.SHYDEN.CO.UK')).toBe(true);
    expect(isProdHostname('Shytalk.Shyden.Co.Uk')).toBe(true);
  });

  test('returns false for a near-miss subdomain (defence vs spoofing)', () => {
    // `shytalk.shyden.co.uk.evil.com` would have prefix-match risk —
    // pin exact equality, not prefix.
    expect(isProdHostname('shytalk.shyden.co.uk.evil.com')).toBe(false);
    expect(isProdHostname('staging.shytalk.shyden.co.uk')).toBe(false);
  });

  test('PROD_HOSTNAME constant matches the prod-positive test', () => {
    // Single source of truth for the prod host. If a future deploy
    // moves the prod host (e.g. to a different domain), this constant
    // is the only edit.
    expect(PROD_HOSTNAME).toBe('shytalk.shyden.co.uk');
  });
});

describe('isProdApiHostname', () => {
  // The Express API has its own prod hostname (`api.shytalk.shyden.co.uk`)
  // distinct from the web's `shytalk.shyden.co.uk`. The same lockdown
  // logic applies — non-prod API hostnames get noindex header + a
  // blocking robots.txt — but `isProdHostname` would wrongly classify
  // `api.shytalk.shyden.co.uk` as non-prod and start serving Disallow:/
  // to the world. Hence a separate predicate.

  test('returns true for the canonical prod API host only', () => {
    expect(isProdApiHostname('api.shytalk.shyden.co.uk')).toBe(true);
  });

  test('returns false for the dev API host', () => {
    expect(isProdApiHostname('dev-api.shytalk.shyden.co.uk')).toBe(false);
  });

  test('returns false for localhost (local emulator)', () => {
    expect(isProdApiHostname('localhost')).toBe(false);
    expect(isProdApiHostname('127.0.0.1')).toBe(false);
  });

  test('returns false for the web prod host (different surface)', () => {
    // Defensive: a misdirected request reaching the API code with the
    // web hostname must NOT be treated as prod-API.
    expect(isProdApiHostname('shytalk.shyden.co.uk')).toBe(false);
  });

  test('case-insensitive match', () => {
    expect(isProdApiHostname('API.SHYTALK.SHYDEN.CO.UK')).toBe(true);
  });

  test('PROD_API_HOSTNAME constant matches the prod-positive test', () => {
    expect(PROD_API_HOSTNAME).toBe('api.shytalk.shyden.co.uk');
  });
});

describe('shouldServeBlockingRobots', () => {
  test('returns true for non-prod hostnames', () => {
    expect(shouldServeBlockingRobots('dev.shytalk.shyden.co.uk')).toBe(true);
    expect(shouldServeBlockingRobots('shytalk-site-dev.pages.dev')).toBe(true);
    expect(shouldServeBlockingRobots('localhost')).toBe(true);
  });

  test('returns false for prod', () => {
    expect(shouldServeBlockingRobots('shytalk.shyden.co.uk')).toBe(false);
  });
});

describe('blockingRobotsBody', () => {
  test('returns a robots.txt that disallows all crawlers from all paths', () => {
    const body = blockingRobotsBody();
    // Pin both directives individually so a future refactor that
    // accidentally changes one but not the other fails this test.
    expect(body).toMatch(/^User-agent:\s*\*/m);
    expect(body).toMatch(/^Disallow:\s*\/\s*$/m);
  });

  test('includes a comment so a human reader knows why', () => {
    // The robots.txt is the most likely place a curious dev / engineer
    // looks first when investigating "why isn't dev being indexed?".
    // A comment with the rationale saves a round-trip to git history.
    const body = blockingRobotsBody();
    expect(body).toMatch(/non-prod|dev|noindex/i);
  });
});

describe('noIndexHeaderValue', () => {
  test('contains noindex AND nofollow AND noarchive', () => {
    const v = noIndexHeaderValue();
    expect(v).toMatch(/noindex/);
    expect(v).toMatch(/nofollow/);
    expect(v).toMatch(/noarchive/);
  });

  test('directives are comma-separated per RFC convention', () => {
    const v = noIndexHeaderValue();
    // X-Robots-Tag uses comma separation. Pin the format.
    expect(v.split(',').map((s) => s.trim())).toEqual(
      expect.arrayContaining(['noindex', 'nofollow', 'noarchive']),
    );
  });
});

describe('basicAuthOk', () => {
  test('returns true for the correct Basic-encoded password', () => {
    // `dev:hunter2` in base64.
    const correct = 'Basic ' + Buffer.from('dev:hunter2').toString('base64');
    expect(basicAuthOk(correct, 'hunter2')).toBe(true);
  });

  test('returns false for missing Authorization header', () => {
    expect(basicAuthOk(null, 'hunter2')).toBe(false);
    expect(basicAuthOk(undefined, 'hunter2')).toBe(false);
    expect(basicAuthOk('', 'hunter2')).toBe(false);
  });

  test('returns false for wrong password', () => {
    const wrong = 'Basic ' + Buffer.from('dev:wrong').toString('base64');
    expect(basicAuthOk(wrong, 'hunter2')).toBe(false);
  });

  test('returns false for non-Basic auth scheme', () => {
    expect(basicAuthOk('Bearer abc123', 'hunter2')).toBe(false);
    expect(basicAuthOk('Digest username="dev"', 'hunter2')).toBe(false);
  });

  test('returns false if expected password is empty/null (fail closed)', () => {
    // A misconfigured deploy (DEV_PASSWORD env var unset) MUST NOT
    // accept any credential — otherwise the gate is wide open.
    const anyAttempt = 'Basic ' + Buffer.from('dev:').toString('base64');
    expect(basicAuthOk(anyAttempt, '')).toBe(false);
    expect(basicAuthOk(anyAttempt, null)).toBe(false);
    expect(basicAuthOk(anyAttempt, undefined)).toBe(false);
  });

  test('case-sensitive password comparison', () => {
    const lower = 'Basic ' + Buffer.from('dev:hunter2').toString('base64');
    expect(basicAuthOk(lower, 'HUNTER2')).toBe(false);
  });

  test('username does not have to be the literal "dev"', () => {
    // The credential is a shared password; we ignore the username
    // half because it adds zero security and rotating both is
    // pointless friction. Pin that the function only checks the
    // password half.
    const userA = 'Basic ' + Buffer.from('alice:hunter2').toString('base64');
    const userB = 'Basic ' + Buffer.from('bob:hunter2').toString('base64');
    expect(basicAuthOk(userA, 'hunter2')).toBe(true);
    expect(basicAuthOk(userB, 'hunter2')).toBe(true);
  });
});

describe('basicAuthChallenge', () => {
  test('returns a 401 Response with WWW-Authenticate header', () => {
    const r = basicAuthChallenge();
    expect(r.status).toBe(401);
    expect(r.headers.get('WWW-Authenticate')).toMatch(/^Basic realm=/);
  });

  test('challenge body explains the 401 to a human', () => {
    // An empty 401 looks like the server is broken. Include text so a
    // visitor who arrives at a stale dev URL sees an informative
    // page (not security-sensitive — just helpful).
    return basicAuthChallenge()
      .text()
      .then((body) => {
        expect(body.length).toBeGreaterThan(0);
        expect(body).toMatch(/non-prod|dev|restricted/i);
      });
  });

  test('challenge response carries the noindex header', () => {
    // Even the challenge page must not be indexed — a Googlebot
    // crawl that lands on the 401 page should still see noindex.
    const r = basicAuthChallenge();
    expect(r.headers.get('X-Robots-Tag')).toMatch(/noindex/);
  });
});
