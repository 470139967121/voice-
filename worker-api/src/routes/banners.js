/**
 * Banner carousel routes — CRUD + active banners + image upload.
 *
 * GET    /api/banners/active           → Active banners (any authenticated user)
 * GET    /api/admin/banners            → All banners (admin)
 * POST   /api/admin/banners            → Create banner (admin)
 * PUT    /api/admin/banners/reorder    → Batch reorder (admin)
 * PUT    /api/admin/banners/:id        → Update banner (admin)
 * DELETE /api/admin/banners/:id        → Delete banner + R2 image (admin)
 * POST   /api/admin/banners/upload     → Upload image to R2 (admin)
 */

const { json, jsonError, generateId, now } = require('../utils');
const { requireAdmin } = require('../middleware/auth');

function registerBannerRoutes(router) {
  // ── Active banners (any authenticated user) ──
  router.get('/api/banners/active', async (request, env) => {
    const timestamp = now();
    const { results } = await env.DB.prepare(`
      SELECT * FROM banners
      WHERE is_active = 1
        AND (start_date IS NULL OR start_date <= ?)
        AND (end_date IS NULL OR end_date > ?)
      ORDER BY sort_order ASC
    `).bind(timestamp, timestamp).all();

    return json(results);
  });

  // ── All banners (admin) ──
  router.get('/api/admin/banners', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const { results } = await env.DB.prepare(
      'SELECT * FROM banners ORDER BY sort_order ASC'
    ).all();

    return json(results);
  });

  // ── Create banner (admin) ──
  router.post('/api/admin/banners', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Invalid JSON body', 400);
    if (!body.image_url) return jsonError('image_url is required', 400);

    const id = generateId();
    const timestamp = now();

    // Get next sort_order
    const maxRow = await env.DB.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) as max_order FROM banners'
    ).first();
    const sortOrder = (maxRow?.max_order ?? -1) + 1;

    await env.DB.prepare(`
      INSERT INTO banners (id, title, image_url, action_type, action_value,
        start_date, end_date, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      body.title || null,
      body.image_url,
      body.action_type || 'NONE',
      body.action_value || null,
      body.start_date ?? null,
      body.end_date ?? null,
      sortOrder,
      body.is_active !== undefined ? (body.is_active ? 1 : 0) : 1,
      timestamp,
      timestamp
    ).run();

    return json({ success: true, id });
  });

  // ── Batch reorder (admin) — must be before /:id route ──
  router.put('/api/admin/banners/reorder', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await request.json().catch(() => null);
    if (!Array.isArray(body)) return jsonError('Expected array of {id, sort_order}', 400);

    const timestamp = now();
    const stmts = body.map(item =>
      env.DB.prepare(
        'UPDATE banners SET sort_order = ?, updated_at = ? WHERE id = ?'
      ).bind(item.sort_order, timestamp, item.id)
    );

    await env.DB.batch(stmts);
    return json({ success: true });
  });

  // ── Update banner (admin) ──
  router.put('/api/admin/banners/:id', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Invalid JSON body', 400);

    const existing = await env.DB.prepare(
      'SELECT id FROM banners WHERE id = ?'
    ).bind(params.id).first();
    if (!existing) return jsonError('Banner not found', 404);

    const fields = [];
    const binds = [];

    if (body.title !== undefined) { fields.push('title = ?'); binds.push(body.title || null); }
    if (body.image_url !== undefined) { fields.push('image_url = ?'); binds.push(body.image_url); }
    if (body.action_type !== undefined) { fields.push('action_type = ?'); binds.push(body.action_type); }
    if (body.action_value !== undefined) { fields.push('action_value = ?'); binds.push(body.action_value || null); }
    if (body.start_date !== undefined) { fields.push('start_date = ?'); binds.push(body.start_date); }
    if (body.end_date !== undefined) { fields.push('end_date = ?'); binds.push(body.end_date); }
    if (body.is_active !== undefined) { fields.push('is_active = ?'); binds.push(body.is_active ? 1 : 0); }

    if (fields.length === 0) return jsonError('No fields to update', 400);

    fields.push('updated_at = ?');
    binds.push(now());
    binds.push(params.id);

    await env.DB.prepare(
      `UPDATE banners SET ${fields.join(', ')} WHERE id = ?`
    ).bind(...binds).run();

    return json({ success: true });
  });

  // ── Delete banner (admin) ──
  router.delete('/api/admin/banners/:id', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    // Get image_url to delete from R2
    const banner = await env.DB.prepare(
      'SELECT image_url FROM banners WHERE id = ?'
    ).bind(params.id).first();

    if (!banner) return jsonError('Banner not found', 404);

    // Delete R2 object if it's our CDN URL
    const CDN_PREFIX = 'https://images.shytalk.shyden.co.uk/';
    if (banner.image_url && banner.image_url.startsWith(CDN_PREFIX)) {
      const key = banner.image_url.slice(CDN_PREFIX.length);
      await env.R2_BUCKET.delete(key);
    }

    await env.DB.prepare('DELETE FROM banners WHERE id = ?').bind(params.id).run();

    return json({ success: true });
  });

  // ── Upload banner image to R2 (admin) ──
  router.post('/api/admin/banners/upload', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return jsonError('Expected multipart/form-data', 400);
    }

    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return jsonError('No file uploaded', 400);
    }

    // Determine extension from MIME type
    const mimeToExt = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    const ext = mimeToExt[file.type] || 'jpg';
    const key = `banners/${generateId()}_${Date.now()}.${ext}`;

    await env.R2_BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });

    const imageUrl = `https://images.shytalk.shyden.co.uk/${key}`;
    return json({ success: true, image_url: imageUrl, key });
  });
}

module.exports = { registerBannerRoutes };
