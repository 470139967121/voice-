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

const {
  isProdApiHostname,
  blockingRobotsBody,
  noIndexHeaderValue,
} = require('../../../functions/_lib/lockdown.js');

/**
 * Mounted via `app.use(noIndex)` BEFORE any other route so the header
 * is set on every downstream response (errors, 404s, etc.).
 */
function noIndex(req, res, next) {
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
