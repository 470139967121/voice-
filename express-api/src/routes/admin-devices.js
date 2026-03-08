/**
 * Admin device bindings routes — list, search, get, unbind devices.
 *
 * GET    /admin/devices              → List all device bindings (paginated, searchable)
 * GET    /admin/devices/user/:userId → Get all devices for a user
 * GET    /admin/devices/:deviceId    → Get single device binding
 * DELETE /admin/devices/:deviceId    → Unbind device (delete binding)
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');
const { generateId, now } = require('../utils/helpers');

// ─── List all device bindings (paginated + searchable) ──────────

router.get('/admin/devices', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const q = (req.query.q || '').toLowerCase().trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const snap = await db.collection('deviceBindings').get();
    let devices = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // In-memory search (Firestore doesn't support full-text search)
    if (q) {
      devices = devices.filter(d => {
        const searchable = [
          d.id,
          d.userId,
          d.manufacturer,
          d.model,
          d.lastIp,
          d.isp,
        ]
          .filter(Boolean)
          .map(v => String(v).toLowerCase())
          .join(' ');
        return searchable.includes(q);
      });
    }

    const total = devices.length;
    const paginated = devices.slice(offset, offset + limit);

    res.json({ devices: paginated, total });
  } catch (err) {
    console.error('GET /admin/devices error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Get all devices for a user ─────────────────────────────────

router.get('/admin/devices/user/:userId', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const userId = req.params.userId;
    const snap = await db.collection('deviceBindings').where('userId', '==', userId).get();

    const devices = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    res.json({ devices });
  } catch (err) {
    console.error('GET /admin/devices/user/:userId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Get single device binding ──────────────────────────────────

router.get('/admin/devices/:deviceId', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const deviceId = req.params.deviceId;
    const snap = await db.doc(`deviceBindings/${deviceId}`).get();

    if (!snap.exists) {
      return res.status(404).json({ error: 'Device binding not found' });
    }

    res.json({ id: snap.id, ...snap.data() });
  } catch (err) {
    console.error('GET /admin/devices/:deviceId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Unbind device ──────────────────────────────────────────────

router.delete('/admin/devices/:deviceId', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const deviceId = req.params.deviceId;

    // Check if binding exists
    const snap = await db.doc(`deviceBindings/${deviceId}`).get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Device binding not found' });
    }

    await db.doc(`deviceBindings/${deviceId}`).delete();

    // Audit log
    await db.doc(`adminAuditLog/${generateId()}`).set({
      adminId: req.auth.uid,
      action: 'UNBIND_DEVICE',
      targetDeviceId: deviceId,
      details: `Unbound device ${deviceId}`,
      createdAt: now(),
    });

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/devices/:deviceId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
