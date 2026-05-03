/**
 * Integration tests for the Express no-index middleware
 * (`src/middleware/no-index.js`). The pure helpers from
 * `functions/_lib/lockdown.js` are tested separately in
 * `tests/scripts/dev-lockdown-middleware.test.js`; this file pins the
 * end-to-end Express wiring — the middleware actually setting the
 * header on real requests, the /robots.txt route serving the right
 * body per hostname, and prod traffic getting through untouched.
 */

const express = require('express');
const request = require('supertest');
const { noIndex, robotsTxt } = require('../../src/middleware/no-index');

function buildApp() {
  const app = express();
  // Express 5 requires explicit `trust proxy` to honour the
  // X-Forwarded-Host header in tests; supertest sets `Host:` directly
  // so this is unnecessary here, but keeping the comment as a hint
  // for future test maintainers wondering about hostname routing.
  app.use(noIndex);
  app.get('/robots.txt', robotsTxt);
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/firebase-config', (_req, res) => res.json({ apiKey: 'public-firebase-key' }));
  return app;
}

describe('noIndex middleware on a non-prod hostname', () => {
  test('sets X-Robots-Tag with noindex/nofollow/noarchive on every response', async () => {
    const res = await request(buildApp())
      .get('/api/health')
      .set('Host', 'dev-api.shytalk.shyden.co.uk');

    expect(res.status).toBe(200);
    expect(res.headers['x-robots-tag']).toBeDefined();
    expect(res.headers['x-robots-tag']).toMatch(/noindex/);
    expect(res.headers['x-robots-tag']).toMatch(/nofollow/);
    expect(res.headers['x-robots-tag']).toMatch(/noarchive/);
  });

  test('sets the header on JSON endpoints too (e.g. firebase-config)', async () => {
    // The original concern that motivated this work — leaking
    // dev-api/firebase-config to search results. Pin that the header
    // appears on this exact response.
    const res = await request(buildApp())
      .get('/api/firebase-config')
      .set('Host', 'dev-api.shytalk.shyden.co.uk');

    expect(res.headers['x-robots-tag']).toMatch(/noindex/);
    expect(res.body.apiKey).toBe('public-firebase-key');
  });

  test('sets the header on localhost too (developer machine should also be uncacheable)', async () => {
    const res = await request(buildApp()).get('/api/health').set('Host', 'localhost');
    expect(res.headers['x-robots-tag']).toMatch(/noindex/);
  });
});

describe('noIndex middleware on the prod hostname', () => {
  test('does NOT set X-Robots-Tag (allows normal indexing)', async () => {
    // Prod must serve as-is. If prod accidentally got noindex,
    // `api.shytalk.shyden.co.uk` would fall out of search and any
    // public discovery would break. Pin the absence.
    const res = await request(buildApp())
      .get('/api/health')
      .set('Host', 'api.shytalk.shyden.co.uk');

    expect(res.status).toBe(200);
    expect(res.headers['x-robots-tag']).toBeUndefined();
  });
});

describe('GET /robots.txt', () => {
  test('returns Disallow: / on non-prod hostname', async () => {
    const res = await request(buildApp())
      .get('/robots.txt')
      .set('Host', 'dev-api.shytalk.shyden.co.uk');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toMatch(/^User-agent:\s*\*/m);
    expect(res.text).toMatch(/^Disallow:\s*\/\s*$/m);
    // The /robots.txt response should ALSO carry the noindex header
    // — defence in depth in case a crawler ignores the body.
    expect(res.headers['x-robots-tag']).toMatch(/noindex/);
  });

  test('returns Allow: / on prod hostname', async () => {
    // Prod's robots.txt is permissive. Strictly the Express API
    // hostname has no HTML so robots.txt is a formality, but
    // serving an explicit Allow documents intent and lets a future
    // sitemap link be added without further changes.
    const res = await request(buildApp())
      .get('/robots.txt')
      .set('Host', 'api.shytalk.shyden.co.uk');

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/^User-agent:\s*\*/m);
    expect(res.text).toMatch(/^Allow:\s*\//m);
    expect(res.text).not.toMatch(/Disallow:/);
    expect(res.headers['x-robots-tag']).toBeUndefined();
  });
});
