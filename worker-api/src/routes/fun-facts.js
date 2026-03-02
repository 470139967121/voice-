/**
 * Fun facts routes — CRUD for language/culture facts shown on splash screen.
 *
 * GET    /api/fun-facts             → All active facts (any authenticated user)
 * GET    /api/admin/fun-facts       → All facts (admin)
 * POST   /api/admin/fun-facts       → Create fact (admin)
 * PUT    /api/admin/fun-facts/:id   → Update fact (admin)
 * DELETE /api/admin/fun-facts/:id   → Delete fact (admin)
 */

const { json, jsonError, generateId, now } = require('../utils');
const { requireAdmin } = require('../middleware/auth');

function registerFunFactRoutes(router) {
  // ── All active facts (any authenticated user) ──
  router.get('/api/fun-facts', async (request, env) => {
    const { results } = await env.DB.prepare(
      'SELECT * FROM fun_facts WHERE is_active = 1 ORDER BY RANDOM()'
    ).all();

    return json(results);
  });

  // ── All facts (admin) ──
  router.get('/api/admin/fun-facts', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const { results } = await env.DB.prepare(
      'SELECT * FROM fun_facts ORDER BY created_at DESC'
    ).all();

    return json(results);
  });

  // ── Create fact (admin) ──
  router.post('/api/admin/fun-facts', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Invalid JSON body', 400);
    if (!body.text) return jsonError('text is required', 400);

    const id = generateId();
    const timestamp = now();

    await env.DB.prepare(`
      INSERT INTO fun_facts (id, text, category, emoji, source_language, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      body.text,
      body.category || 'trivia',
      body.emoji || '',
      body.source_language || '',
      body.is_active !== undefined ? (body.is_active ? 1 : 0) : 1,
      timestamp,
      timestamp
    ).run();

    return json({ success: true, id });
  });

  // ── Update fact (admin) ──
  router.put('/api/admin/fun-facts/:id', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Invalid JSON body', 400);

    const existing = await env.DB.prepare(
      'SELECT id FROM fun_facts WHERE id = ?'
    ).bind(params.id).first();
    if (!existing) return jsonError('Fun fact not found', 404);

    const fields = [];
    const binds = [];

    if (body.text !== undefined) { fields.push('text = ?'); binds.push(body.text); }
    if (body.category !== undefined) { fields.push('category = ?'); binds.push(body.category); }
    if (body.emoji !== undefined) { fields.push('emoji = ?'); binds.push(body.emoji); }
    if (body.source_language !== undefined) { fields.push('source_language = ?'); binds.push(body.source_language); }
    if (body.is_active !== undefined) { fields.push('is_active = ?'); binds.push(body.is_active ? 1 : 0); }

    if (fields.length === 0) return jsonError('No fields to update', 400);

    fields.push('updated_at = ?');
    binds.push(now());
    binds.push(params.id);

    await env.DB.prepare(
      `UPDATE fun_facts SET ${fields.join(', ')} WHERE id = ?`
    ).bind(...binds).run();

    return json({ success: true });
  });

  // ── Delete fact (admin) ──
  router.delete('/api/admin/fun-facts/:id', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const existing = await env.DB.prepare(
      'SELECT id FROM fun_facts WHERE id = ?'
    ).bind(params.id).first();
    if (!existing) return jsonError('Fun fact not found', 404);

    await env.DB.prepare('DELETE FROM fun_facts WHERE id = ?').bind(params.id).run();

    return json({ success: true });
  });
}

module.exports = { registerFunFactRoutes };
