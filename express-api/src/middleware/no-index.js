/**
 * Express middleware that locks down non-prod ShyTalk API hostnames
 * from search-engine indexing.
 *
 *   - Adds `X-Robots-Tag: noindex, nofollow, noarchive` to every
 *     response from non-prod hostnames so any URL exposed (e.g.
 *     `dev-api.shytalk.shyden.co.uk/api/firebase-config`) is dropped
 *     from search results.
 *   - Serves `/robots.txt` with `Disallow: /` on non-prod, and a
 *     standard "allow everything" response on prod.
 *
 * Detection is by `req.hostname` (Express-parsed Host header), NOT by
 * `process.env.NODE_ENV` — the dev VM may run with NODE_ENV=production
 * for pm2 reasons, so the hostname is the more reliable signal. The
 * single-source-of-truth `PROD_API_HOSTNAME` lives in
 * `functions/_lib/lockdown.js` so the web Pages middleware and this
 * Express middleware agree on what "prod" means.
 *
 * Does NOT add basic auth — the API is consumed by mobile apps that
 * embed the URL in their binary, and adding HTTP auth would break
 * their request flow. Discoverability via search is the actual leak,
 * and noindex closes that.
 */

// NOTE: helpers are inlined below rather than required from
// `../../../functions/_lib/lockdown.js` because the deploy workflow's
// backend tarball is built with `cd express-api && tar czf api.tar.gz .`
// and cannot reach files outside that directory. The first deploy of
// this middleware (run 25276782190) crashed the dev API at startup
// with `MODULE_NOT_FOUND: ../../functions/_lib/lockdown.js`. The
// Cloudflare Pages middleware in `functions/_middleware.js` continues
// to use the shared `_lib/lockdown.js` because Pages deploys both
// `public/` and `functions/` together.
//
// Drift risk between the two copies is mitigated by `dev-lockdown-middleware.test.js`
// pinning the rules from one side and `no-index.test.js` pinning the
// integration on the other; if the constants ever diverge the dev API
// or Pages function behaviour will fail those tests.
const log = require('../utils/log');

const PROD_API_HOSTNAME = 'api.shytalk.shyden.co.uk';

function isProdApiHostname(hostname) {
  if (typeof hostname !== 'string' || hostname.length === 0) return false;
  return hostname.toLowerCase() === PROD_API_HOSTNAME;
}

function noIndexHeaderValue() {
  return 'noindex, nofollow, noarchive';
}

function blockingRobotsBody() {
  return [
    '# Non-prod ShyTalk environment — blocked from indexing.',
    '# See express-api/src/middleware/no-index.js (and',
    '# functions/_lib/lockdown.js for the web side).',
    'User-agent: *',
    'Disallow: /',
    '',
  ].join('\n');
}

// Hostnames we expect to see at runtime. Anything outside this set is a
// misconfiguration — most likely Caddy / a future reverse-proxy edit
// dropped or rewrote the Host header. We log a warning ONCE per unseen
// hostname so the misclassification surfaces in logs instead of silently
// shipping noindex on prod (or, worse, NOT shipping noindex on a
// dev hostname that doesn't match our pattern).
//
// Memoised in module scope so the warning fires at most once per process
// per hostname — without memoisation a misconfigured proxy floods logs.
const KNOWN_NON_PROD_HOSTNAME_PATTERNS = [/^dev-api\./i, /^localhost$/i, /^127\.0\.0\.1$/];
const seenUnexpectedHostnames = new Set();

function warnIfUnexpectedHostname(hostname) {
  if (typeof hostname !== 'string' || hostname.length === 0) return;
  if (isProdApiHostname(hostname)) return;
  if (KNOWN_NON_PROD_HOSTNAME_PATTERNS.some((p) => p.test(hostname))) return;
  if (seenUnexpectedHostnames.has(hostname)) return;
  seenUnexpectedHostnames.add(hostname);
  log.warn(
    'no-index',
    'Unexpected hostname classified non-prod — verify reverse proxy is forwarding the public Host header. ' +
      'Misclassification could ship X-Robots-Tag: noindex on prod or break dev SEO defence.',
    { hostname, expectedProd: PROD_API_HOSTNAME },
  );
}

/**
 * Mounted via `app.use(noIndex)` BEFORE any other route so the header
 * is set on every downstream response (errors, 404s, etc.).
 */
function noIndex(req, res, next) {
  warnIfUnexpectedHostname(req.hostname);
  if (!isProdApiHostname(req.hostname)) {
    res.set('X-Robots-Tag', noIndexHeaderValue());
  }
  next();
}

/**
 * Mounted as `app.get('/robots.txt', robotsTxt)`. Returns:
 *   - non-prod: `Disallow: /` (block all crawlers)
 *   - prod: a permissive `Allow: /` body
 *
 * The endpoint is intentionally NOT inside the `/api` prefix because
 * crawlers fetch `https://<host>/robots.txt` at the root.
 */
function robotsTxt(req, res) {
  // /robots.txt is the highest-impact silent-failure surface — a
  // misclassified hostname here would deindex prod. Warn loudly the
  // first time we see an unexpected hostname.
  warnIfUnexpectedHostname(req.hostname);
  if (isProdApiHostname(req.hostname)) {
    // Prod robots.txt — permissive. Strictly speaking the API root
    // hostname doesn't need a robots.txt at all (no HTML to index),
    // but serving an explicit allow makes the file present and
    // documents intent.
    res.type('text/plain; charset=utf-8').send(['User-agent: *', 'Allow: /', ''].join('\n'));
    return;
  }
  res
    .type('text/plain; charset=utf-8')
    .set('X-Robots-Tag', noIndexHeaderValue())
    .send(blockingRobotsBody());
}

module.exports = { noIndex, robotsTxt };
