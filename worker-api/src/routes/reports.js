/**
 * Report & moderation routes — reports, suspensions, appeals, audit log.
 *
 * POST   /api/reports                       → Submit a report
 * GET    /api/reports                       → List pending reports (admin)
 * POST   /api/reports/:id/resolve           → Resolve a report (admin)
 * POST   /api/reports/:id/lock              → Lock a report (admin)
 * DELETE /api/reports/:id/lock              → Unlock a report (admin)
 * POST   /api/admin/users/:uid/suspend      → Suspend a user (admin)
 * POST   /api/admin/users/:uid/unsuspend    → Unsuspend a user (admin)
 * GET    /api/appeals                       → List appeals (admin)
 * PATCH  /api/appeals/:id                   → Review an appeal (admin)
 * POST   /api/appeals                       → Submit an appeal
 * GET    /api/admin/audit-log               → Get admin audit log (admin)
 */

const { json, jsonError, generateId, now, parseBody } = require('../utils');
const { requireAdmin } = require('../middleware/auth');
const { sendFcmToTokens, cleanupInvalidTokens } = require('../utils/fcm');

function registerReportRoutes(router) {
  // ── Submit report ──
  router.post('/api/reports', async (request, env) => {
    const body = await parseBody(request);
    if (!body) return jsonError('Invalid JSON body', 400);

    const {
      reportedUserId, reportedUserName, reportedUserUniqueId,
      conversationId, messageId, messageText,
      reason, description, evidenceUrls,
    } = body;

    if (!reportedUserId || !reason) {
      return jsonError('reportedUserId and reason required', 400);
    }

    const reporter = await env.DB.prepare(
      'SELECT display_name, unique_id FROM users WHERE uid = ?'
    ).bind(request.auth.uid).first();

    const reportId = generateId();

    await env.DB.prepare(`
      INSERT INTO reports (
        id, reporter_id, reporter_name, reporter_unique_id,
        reported_user_id, reported_user_name, reported_user_unique_id,
        conversation_id, message_id, message_text,
        reason, description, evidence_urls, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).bind(
      reportId, request.auth.uid,
      reporter?.display_name || null, reporter?.unique_id || null,
      reportedUserId, reportedUserName || null, reportedUserUniqueId || null,
      conversationId || null, messageId || null, messageText || null,
      reason, description || null,
      evidenceUrls ? JSON.stringify(evidenceUrls) : null,
      now()
    ).run();

    // Fire-and-forget: FCM push notification to admin tokens
    const ctx = request.ctx;
    if (ctx) {
      ctx.waitUntil((async () => {
        try {
          const { results: adminTokens } = await env.DB.prepare(
            'SELECT token FROM admin_tokens'
          ).all();
          if (adminTokens.length > 0) {
            const data = {
              type: 'ADMIN_NEW_REPORT',
              reportId,
              reason,
              reportedUserName: reportedUserName || 'Unknown',
            };
            const invalid = await sendFcmToTokens(env, adminTokens.map(t => t.token), data);
            await cleanupInvalidTokens(env, invalid, 'admin_tokens');
          }
        } catch (err) {
          console.error('Failed to send report notification:', err);
        }
      })());
    }

    return json({ success: true, reportId });
  });

  // ── List pending reports (admin) ──
  router.get('/api/reports', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const { results } = await env.DB.prepare(
      "SELECT * FROM reports WHERE status = 'pending' ORDER BY created_at ASC"
    ).all();

    return json(results);
  });

  // ── Resolve report (admin) ──
  router.post('/api/reports/:id/resolve', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    const action = body?.action || 'dismissed';

    await env.DB.prepare(`
      UPDATE reports SET status = 'resolved', action_taken = ?, resolved_at = ?, resolved_by = ?
      WHERE id = ?
    `).bind(action, now(), request.auth.uid, params.id).run();

    return json({ success: true });
  });

  // ── Lock report (admin) ──
  router.post('/api/reports/:id/lock', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    await env.DB.prepare(`
      INSERT INTO report_locks (report_id, locked_by, locked_at)
      VALUES (?, ?, ?)
      ON CONFLICT(report_id) DO UPDATE SET locked_by = ?, locked_at = ?
    `).bind(params.id, request.auth.uid, now(), request.auth.uid, now()).run();

    return json({ success: true });
  });

  // ── Unlock report (admin) ──
  router.delete('/api/reports/:id/lock', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    await env.DB.prepare(
      'DELETE FROM report_locks WHERE report_id = ?'
    ).bind(params.id).run();

    return json({ success: true });
  });

  // ══════════════════════════════════════════════════════════════
  // SUSPENSIONS (admin)
  // ══════════════════════════════════════════════════════════════

  // ── Suspend user ──
  router.post('/api/admin/users/:uid/suspend', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    if (!body?.reason) return jsonError('reason is required', 400);
    if (typeof body.canAppeal !== 'boolean') return jsonError('canAppeal must be a boolean', 400);

    let endTimestamp = null;
    if (body.endDate) {
      const d = new Date(body.endDate);
      if (isNaN(d.getTime())) return jsonError('endDate must be a valid ISO-8601 date', 400);
      if (d.getTime() <= Date.now()) return jsonError('endDate must be in the future', 400);
      endTimestamp = d.getTime();
    }

    const user = await env.DB.prepare(
      'SELECT display_name, profile_photo_url, cover_photo_url FROM users WHERE uid = ?'
    ).bind(params.uid).first();

    if (!user) return jsonError('User not found', 404);

    const timestamp = now();
    const stmts = [
      // Save pre-suspension values and mask profile
      env.DB.prepare(`
        UPDATE users SET
          is_suspended = 1,
          suspension_reason = ?,
          suspension_start_date = ?,
          suspension_end_date = ?,
          suspension_can_appeal = ?,
          suspended_by = ?,
          pre_suspension_display_name = ?,
          pre_suspension_photo_url = ?,
          pre_suspension_cover_url = ?,
          display_name = 'Suspended Account',
          profile_photo_url = NULL,
          cover_photo_url = NULL,
          avatar_url = NULL,
          bio = NULL,
          current_room_id = NULL
        WHERE uid = ?
      `).bind(
        body.reason.trim(), timestamp, endTimestamp,
        body.canAppeal ? 1 : 0, request.auth.uid,
        user.display_name, user.profile_photo_url, user.cover_photo_url,
        params.uid
      ),
      // Audit log
      env.DB.prepare(`
        INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details, created_at)
        VALUES (?, ?, 'SUSPEND', ?, ?, ?)
      `).bind(generateId(), request.auth.uid, params.uid, body.reason, timestamp),
    ];
    await env.DB.batch(stmts);

    // Evict from rooms (fire-and-forget)
    const ctx = request.ctx;
    if (ctx) {
      ctx.waitUntil(evictSuspendedUser(env, params.uid));
    }

    return json({ success: true });
  });

  // ── Unsuspend user ──
  router.post('/api/admin/users/:uid/unsuspend', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const user = await env.DB.prepare(
      'SELECT pre_suspension_display_name, pre_suspension_photo_url, pre_suspension_cover_url FROM users WHERE uid = ?'
    ).bind(params.uid).first();

    if (!user) return jsonError('User not found', 404);

    const updates = [
      'is_suspended = 0',
      'suspension_reason = NULL',
      'suspension_start_date = NULL',
      'suspension_end_date = NULL',
      'suspension_can_appeal = NULL',
      'suspended_by = NULL',
    ];
    const binds = [];

    // Restore pre-suspension profile data if available
    if (user.pre_suspension_display_name) {
      updates.push('display_name = ?');
      binds.push(user.pre_suspension_display_name);
    }
    if (user.pre_suspension_photo_url) {
      updates.push('profile_photo_url = ?');
      binds.push(user.pre_suspension_photo_url);
    }
    if (user.pre_suspension_cover_url) {
      updates.push('cover_photo_url = ?');
      binds.push(user.pre_suspension_cover_url);
    }
    updates.push(
      'pre_suspension_display_name = NULL',
      'pre_suspension_photo_url = NULL',
      'pre_suspension_cover_url = NULL'
    );

    binds.push(params.uid);
    await env.DB.prepare(
      `UPDATE users SET ${updates.join(', ')} WHERE uid = ?`
    ).bind(...binds).run();

    // Audit log
    await env.DB.prepare(`
      INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details, created_at)
      VALUES (?, ?, 'UNSUSPEND', ?, NULL, ?)
    `).bind(generateId(), request.auth.uid, params.uid, now()).run();

    return json({ success: true });
  });

  // ══════════════════════════════════════════════════════════════
  // APPEALS
  // ══════════════════════════════════════════════════════════════

  // ── Submit appeal ──
  router.post('/api/appeals', async (request, env) => {
    const body = await parseBody(request);
    if (!body?.appealText) return jsonError('appealText is required', 400);

    const uid = request.auth.uid;

    // Check if user is actually suspended
    const user = await env.DB.prepare(
      'SELECT is_suspended, suspension_can_appeal FROM users WHERE uid = ?'
    ).bind(uid).first();

    if (!user?.is_suspended) return jsonError('User is not suspended', 400);
    if (!user.suspension_can_appeal) return jsonError('Appeals are not allowed for this suspension', 403);

    // Check for existing pending appeal
    const existing = await env.DB.prepare(
      "SELECT id FROM suspension_appeals WHERE user_id = ? AND status = 'pending'"
    ).bind(uid).first();

    if (existing) return jsonError('An appeal is already pending', 409);

    const appealId = generateId();
    await env.DB.prepare(`
      INSERT INTO suspension_appeals (id, user_id, appeal_text, status, created_at)
      VALUES (?, ?, ?, 'pending', ?)
    `).bind(appealId, uid, body.appealText, now()).run();

    return json({ success: true, appealId });
  });

  // ── List appeals (admin) ──
  router.get('/api/appeals', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const { results: appeals } = await env.DB.prepare(`
      SELECT sa.*, u.display_name, u.unique_id, u.suspension_reason, u.suspension_end_date
      FROM suspension_appeals sa
      JOIN users u ON u.uid = sa.user_id
      ORDER BY sa.created_at DESC
      LIMIT 100
    `).all();

    return json(appeals);
  });

  // ── Review appeal (admin) ──
  router.patch('/api/appeals/:id', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    const status = body?.status; // 'approved' or 'denied'
    if (!status || !['approved', 'denied'].includes(status)) {
      return jsonError('status must be "approved" or "denied"', 400);
    }

    const appeal = await env.DB.prepare(
      'SELECT user_id FROM suspension_appeals WHERE id = ?'
    ).bind(params.id).first();

    if (!appeal) return jsonError('Appeal not found', 404);

    const stmts = [
      env.DB.prepare(`
        UPDATE suspension_appeals SET status = ?, reviewed_by = ?, reviewed_at = ?
        WHERE id = ?
      `).bind(status, request.auth.uid, now(), params.id),
    ];

    // If approved, unsuspend the user
    if (status === 'approved') {
      const user = await env.DB.prepare(
        'SELECT pre_suspension_display_name, pre_suspension_photo_url, pre_suspension_cover_url FROM users WHERE uid = ?'
      ).bind(appeal.user_id).first();

      let unsuspendSql = `UPDATE users SET
        is_suspended = 0, suspension_reason = NULL,
        suspension_start_date = NULL, suspension_end_date = NULL,
        suspension_can_appeal = NULL, suspended_by = NULL,
        pre_suspension_display_name = NULL,
        pre_suspension_photo_url = NULL,
        pre_suspension_cover_url = NULL`;
      const unsuspendBinds = [];

      if (user?.pre_suspension_display_name) {
        unsuspendSql += ', display_name = ?';
        unsuspendBinds.push(user.pre_suspension_display_name);
      }
      if (user?.pre_suspension_photo_url) {
        unsuspendSql += ', profile_photo_url = ?';
        unsuspendBinds.push(user.pre_suspension_photo_url);
      }
      if (user?.pre_suspension_cover_url) {
        unsuspendSql += ', cover_photo_url = ?';
        unsuspendBinds.push(user.pre_suspension_cover_url);
      }

      unsuspendSql += ' WHERE uid = ?';
      unsuspendBinds.push(appeal.user_id);

      stmts.push(env.DB.prepare(unsuspendSql).bind(...unsuspendBinds));
    }

    // Audit log
    stmts.push(env.DB.prepare(`
      INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      generateId(), request.auth.uid,
      status === 'approved' ? 'APPEAL_APPROVED' : 'APPEAL_DENIED',
      appeal.user_id, null, now()
    ));

    await env.DB.batch(stmts);

    return json({ success: true });
  });

  // ══════════════════════════════════════════════════════════════
  // AUDIT LOG (admin)
  // ══════════════════════════════════════════════════════════════

  router.get('/api/admin/audit-log', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');

    const { results } = await env.DB.prepare(`
      SELECT al.*, u.display_name as admin_name
      FROM admin_audit_log al
      LEFT JOIN users u ON u.uid = al.admin_id
      ORDER BY al.created_at DESC
      LIMIT ?
    `).bind(limit).all();

    return json(results);
  });
}

/**
 * Evict a suspended user from all rooms they're in.
 * If they own a room, close it via the RoomDO. Otherwise remove them as participant.
 */
async function evictSuspendedUser(env, userId) {
  try {
    const { results: participations } = await env.DB.prepare(
      'SELECT room_id FROM room_participants WHERE user_id = ?'
    ).bind(userId).all();

    for (const { room_id: roomId } of participations) {
      const room = await env.DB.prepare(
        'SELECT owner_id FROM rooms WHERE id = ?'
      ).bind(roomId).first();

      if (!room) continue;

      if (room.owner_id === userId) {
        // Owner — close the room via DurableObject
        try {
          const doId = env.ROOM_DO.idFromName(roomId);
          const stub = env.ROOM_DO.get(doId);
          await stub.fetch(new Request('https://do/broadcast', {
            method: 'POST',
            body: JSON.stringify({ type: 'room_closed' }),
          }));
        } catch {}
        await env.DB.prepare("UPDATE rooms SET status = 'CLOSED' WHERE id = ?").bind(roomId).run();
      } else {
        // Participant — remove from room
        await env.DB.batch([
          env.DB.prepare('DELETE FROM room_participants WHERE room_id = ? AND user_id = ?').bind(roomId, userId),
          env.DB.prepare('DELETE FROM room_seats WHERE room_id = ? AND user_id = ?').bind(roomId, userId),
        ]);
        // Broadcast room update
        try {
          const doId = env.ROOM_DO.idFromName(roomId);
          const stub = env.ROOM_DO.get(doId);
          await stub.fetch(new Request('https://do/broadcast', {
            method: 'POST',
            body: JSON.stringify({ type: 'room_updated' }),
          }));
        } catch {}
      }
    }
  } catch (err) {
    console.error(`Failed to evict suspended user ${userId} from rooms:`, err);
  }
}

module.exports = { registerReportRoutes };
