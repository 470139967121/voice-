/**
 * Pure helpers for the Cloudflare Pages middleware that locks down
 * non-prod hostnames. Extracted from `_middleware.js` so the logic is
 * unit-testable from Jest without spinning up workerd / miniflare.
 *
 * Used by:
 *   - `functions/_middleware.js` (Cloudflare Pages, edge runtime)
 *   - `express-api/tests/scripts/dev-lockdown-middleware.test.js` (Jest)
 *
 * Plan: protect dev / preview deployments from public discovery and
 * scrape access. Apple-content-guideline / 18+ work is in flight on
 * dev; leaking the in-progress UI to Google search results is a
 * compliance + reputation risk.
 */

// Single source of truth for the prod hostnames. Two surfaces — the
// public web (Cloudflare Pages) and the Express API (Oracle Cloud).
// Each has its own canonical hostname; the lockdown predicate picks
// the right one based on which surface the request is hitting.
const PROD_HOSTNAME = 'shytalk.shyden.co.uk';
const PROD_API_HOSTNAME = 'api.shytalk.shyden.co.uk';

/**
 * Returns true if and only if the request is reaching the canonical
 * production hostname. Case-insensitive (DNS is case-insensitive).
 * Exact equality — NOT prefix / contains — so a near-miss subdomain
 * like `staging.shytalk.shyden.co.uk` or a hostile
 * `shytalk.shyden.co.uk.evil.com` cannot trip the prod gate.
 */
function isProdHostname(hostname) {
  if (typeof hostname !== 'string' || hostname.length === 0) return false;
  return hostname.toLowerCase() === PROD_HOSTNAME;
}

/**
 * API-surface analogue of [isProdHostname] — true for the canonical
 * prod API hostname only, case-insensitive, exact match. Used by
 * `express-api/src/middleware/no-index.js` to decide whether to
 * inject the X-Robots-Tag header and serve the blocking robots.txt.
 */
function isProdApiHostname(hostname) {
  if (typeof hostname !== 'string' || hostname.length === 0) return false;
  return hostname.toLowerCase() === PROD_API_HOSTNAME;
}

/**
 * Inverse convenience — true for any non-prod host (dev, Pages
 * preview, localhost). Used to gate the noindex + basic-auth flow.
 */
function shouldServeBlockingRobots(hostname) {
  return !isProdHostname(hostname);
}

/**
 * Body of the dev `robots.txt`. Single literal so the format and
 * comment don't drift between the test fixture and the served response.
 */
function blockingRobotsBody() {
  return [
    '# Non-prod ShyTalk environment — blocked from indexing.',
    '# See functions/_middleware.js / functions/_lib/lockdown.js.',
    '# Prod robots.txt (if any) is served only on shytalk.shyden.co.uk.',
    'User-agent: *',
    'Disallow: /',
    '',
  ].join('\n');
}

/**
 * The X-Robots-Tag value to inject on every non-prod response.
 * `noindex` removes from search results; `nofollow` keeps crawlers
 * from following links into other dev pages; `noarchive` blocks the
 * Google cached copy.
 */
function noIndexHeaderValue() {
  return 'noindex, nofollow, noarchive';
}

/**
 * Validates a Basic-auth `Authorization` header against the expected
 * shared password. Username half is ignored — see test for rationale.
 *
 * Fails closed: a missing header or empty/null `expectedPassword`
 * always returns false, so a misconfigured deploy (DEV_PASSWORD env
 * var unset) does NOT leave the gate wide open.
 */
function basicAuthOk(authorizationHeader, expectedPassword) {
  if (!expectedPassword) return false;
  if (typeof authorizationHeader !== 'string') return false;
  if (!authorizationHeader.startsWith('Basic ')) return false;
  const encoded = authorizationHeader.slice('Basic '.length).trim();
  if (encoded.length === 0) return false;
  let decoded;
  try {
    // atob is available in Cloudflare Workers + modern Node ≥ 16. The
    // Buffer fallback keeps Jest happy without polyfills.
    decoded =
      typeof atob === 'function'
        ? atob(encoded)
        : Buffer.from(encoded, 'base64').toString('utf-8');
  } catch {
    return false;
  }
  const colon = decoded.indexOf(':');
  if (colon < 0) return false;
  // Username half discarded; only password matters. Constant-time
  // comparison would be ideal but Cloudflare Workers' standard library
  // doesn't expose `crypto.subtle.timingSafeEqual`. The risk surface
  // here (a single shared password gate on dev) does not warrant the
  // extra implementation complexity.
  const password = decoded.slice(colon + 1);
  return password === expectedPassword;
}

/**
 * The 401 challenge response shown when a non-prod request arrives
 * without (or with wrong) credentials. Browsers will show their
 * native Basic-auth prompt because of the `WWW-Authenticate` header.
 *
 * Body text is a short human-readable explanation — not
 * security-sensitive — so a visitor stumbling onto a dev URL doesn't
 * see an empty white page.
 *
 * Carries `X-Robots-Tag: noindex` because even the challenge page
 * must not be indexed if a Googlebot somehow reaches it.
 */
function basicAuthChallenge() {
  const body =
    'This is a non-prod ShyTalk environment and is restricted to authorised testers. ' +
    'If you arrived here by mistake, visit https://shytalk.shyden.co.uk for the public site.';
  return new Response(body, {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="ShyTalk Non-Prod"',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Robots-Tag': noIndexHeaderValue(),
    },
  });
}

module.exports = {
  PROD_HOSTNAME,
  PROD_API_HOSTNAME,
  isProdHostname,
  isProdApiHostname,
  shouldServeBlockingRobots,
  blockingRobotsBody,
  noIndexHeaderValue,
  basicAuthOk,
  basicAuthChallenge,
};
