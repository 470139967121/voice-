/**
 * Cloudflare Pages middleware — runs on every request to non-prod
 * ShyTalk hostnames.
 *
 * Responsibilities:
 *   1. Inject `X-Robots-Tag: noindex, nofollow, noarchive` so search
 *      engines don't index the dev / preview deployment.
 *   2. Serve `/robots.txt` with `Disallow: /` on non-prod (intercept
 *      before the static asset pipeline, so the dev deploy doesn't
 *      have to ship a separate file).
 *   3. Gate every request behind HTTP Basic Auth — the shared password
 *      lives in `env.DEV_PASSWORD` (set via Cloudflare Pages → Settings
 *      → Environment Variables). Without the password the gate fails
 *      closed (challenge response, no access).
 *
 * Pure logic is in `_lib/lockdown.js` so it's unit-testable from Jest
 * without spinning up workerd / miniflare. This file is just the
 * Cloudflare Pages plumbing.
 *
 * Hostname is read from the request URL — Cloudflare Pages sets it
 * correctly for every binding (custom domain, *.pages.dev preview,
 * etc.). On prod (`shytalk.shyden.co.uk`) the middleware is a no-op
 * via early `next()`.
 */

const {
  isProdHostname,
  blockingRobotsBody,
  noIndexHeaderValue,
  basicAuthOk,
  basicAuthChallenge,
} = require('./_lib/lockdown.js');

// CommonJS module syntax (supported by Cloudflare Pages Functions per
// https://developers.cloudflare.com/pages/functions/api-reference/).
// Chosen here so the `./_lib/lockdown.js` helper module can be shared
// verbatim with `express-api/src/middleware/no-index.js` and the Jest
// test suite without a separate ESM build target.
exports.onRequest = async ({ request, env, next }) => {
  const url = new URL(request.url);
  const hostname = url.hostname;

  // Prod = pass through with no modifications. The gate exists for
  // dev / preview / *.pages.dev only.
  if (isProdHostname(hostname)) {
    return next();
  }

  // /robots.txt is intercepted BEFORE the basic-auth gate so search
  // engines (which never send Authorization) can read the Disallow
  // directive. Without this, Googlebot would see a 401 and might
  // assume the site is temporarily unavailable rather than
  // permanently disallowed.
  if (url.pathname === '/robots.txt') {
    return new Response(blockingRobotsBody(), {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Robots-Tag': noIndexHeaderValue(),
        // Short cache so a future change to the body propagates
        // quickly. Robots.txt is read by crawlers on a slow cadence
        // anyway, so the cache barely matters.
        'Cache-Control': 'public, max-age=300',
      },
    });
  }

  // Auth gate. `env.DEV_PASSWORD` is the shared secret (set in
  // Cloudflare Pages → Settings → Environment Variables). If it's
  // unset the gate fails closed — every request gets the 401
  // challenge until an operator configures it.
  const auth = request.headers.get('Authorization');
  if (!basicAuthOk(auth, env.DEV_PASSWORD)) {
    return basicAuthChallenge();
  }

  // Auth passed → fetch the underlying static asset / next handler,
  // then graft the noindex header onto its response. We have to clone
  // the response because `next()` returns an immutable Response.
  const response = await next();
  const newHeaders = new Headers(response.headers);
  newHeaders.set('X-Robots-Tag', noIndexHeaderValue());
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
};
