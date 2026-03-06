/**
 * Admin economy routes — balance adjustment, backpack, luck, transactions, gacha guarantee.
 *
 * GET    /users/:uid/economy              → Economy snapshot
 * POST   /users/:uid/adjust-balance       → Adjust coins or beans
 * POST   /users/:uid/backpack             → Set backpack item quantity
 * GET    /users/:uid/luck                 → Get luck + pity
 * POST   /users/:uid/luck                 → Update luck/pity
 * GET    /users/:uid/transactions         → Paginated transaction history
 * GET    /users/:uid/guarantee-next-pull  → Check guarantee status
 * POST   /users/:uid/guarantee-next-pull  → Set guaranteed next pull
 * DELETE /users/:uid/guarantee-next-pull  → Revoke guarantee
 */

const router = require('express').Router();
const { db, FieldValue } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');
const { generateId, now } = require('../utils/helpers');

// ── Economy snapshot ──
router.get('/users/:uid/economy', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const snap = await db.doc(`users/${req.params.uid}`).get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });
    const user = snap.data();

    res.json({
      shyCoins:                user.shyCoins                ?? user.shy_coins                ?? 0,
      shyBeans:                user.shyBeans                ?? user.shy_beans                ?? 0,
      luckScore:               user.luckScore               ?? user.luck_score               ?? 0,
      pityCounter:             user.pityCounter             ?? user.pity_counter             ?? 0,
      isSuperShy:              user.isSuperShy              ?? user.is_super_shy             ?? false,
      superShyExpiry:          user.superShyExpiry          ?? user.super_shy_expiry         ?? null,
      superShyTier:            user.superShyTier            ?? user.super_shy_tier           ?? null,
      loginStreak:             user.loginStreak             ?? user.login_streak             ?? 0,
      lastLoginDate:           user.lastLoginDate           ?? user.last_login_date          ?? null,
      guaranteedNextPullGiftId: user.guaranteedNextPullGiftId ?? user.guaranteed_next_pull_gift_id ?? null,
    });
  } catch (err) {
    console.error('GET /users/:uid/economy error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Adjust balance (coins or beans) ──
router.post('/users/:uid/adjust-balance', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Invalid JSON body' });

    const { reason } = body;
    const currency = (body.currency || '').toLowerCase();
    // Support both signed amount and operation+amount
    let amount = body.amount;
    if (typeof amount !== 'number' || amount === 0) {
      return res.status(400).json({ error: 'amount must be a non-zero number' });
    }
    if (body.operation === 'deduct' && amount > 0) amount = -amount;
    if (!['coins', 'beans'].includes(currency)) {
      return res.status(400).json({ error: 'currency must be "coins" or "beans"' });
    }

    const field = currency === 'coins' ? 'shyCoins' : 'shyBeans';
    const snap = await db.doc(`users/${req.params.uid}`).get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });
    const user = snap.data();

    const currentBalance = user[field] ?? (currency === 'coins' ? (user.shy_coins ?? 0) : (user.shy_beans ?? 0));
    const newBalance = Math.max(0, currentBalance + amount);
    const timestamp = now();
    const txId = generateId();
    const logId = generateId();

    await Promise.all([
      db.doc(`users/${req.params.uid}`).update({ [field]: newBalance }),

      db.doc(`users/${req.params.uid}/transactions/${txId}`).set({
        id:           txId,
        userId:       req.params.uid,
        type:         'ADMIN_ADJUSTMENT',
        amount:       amount,
        currency:     currency.toUpperCase(),
        balanceAfter: newBalance,
        details:      reason || `Admin adjustment: ${amount > 0 ? '+' : ''}${amount} ${currency}`,
        timestamp:    timestamp,
      }),

      db.doc(`adminAuditLog/${logId}`).set({
        adminId:      req.auth.uid,
        action:       'ADJUST_BALANCE',
        targetUserId: req.params.uid,
        details:      `${amount > 0 ? '+' : ''}${amount} ${currency} (${reason || 'no reason'})`,
        createdAt:    timestamp,
      }),
    ]);

    res.json({ success: true, newBalance, currency });
  } catch (err) {
    console.error('POST /users/:uid/adjust-balance error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Set backpack item quantity (admin) ──
router.post('/users/:uid/backpack', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body?.giftId) return res.status(400).json({ error: 'giftId required' });
    if (typeof body.quantity !== 'number' || body.quantity < 0) {
      return res.status(400).json({ error: 'quantity must be a non-negative number' });
    }

    const timestamp = now();
    const backpackRef = db.doc(`users/${req.params.uid}/backpack/${body.giftId}`);

    if (body.quantity === 0) {
      await backpackRef.delete();
    } else {
      await backpackRef.set({
        giftId:       body.giftId,
        quantity:     body.quantity,
        lastAcquired: timestamp,
      });
    }

    await db.doc(`adminAuditLog/${generateId()}`).set({
      adminId:      req.auth.uid,
      action:       'SET_BACKPACK',
      targetUserId: req.params.uid,
      details:      `Set ${body.giftId} quantity to ${body.quantity}`,
      createdAt:    timestamp,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('POST /users/:uid/backpack error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Get luck + pity ──
router.get('/users/:uid/luck', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const snap = await db.doc(`users/${req.params.uid}`).get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });
    const user = snap.data();

    res.json({
      luckScore:   user.luckScore   ?? user.luck_score   ?? 0,
      pityCounter: user.pityCounter ?? user.pity_counter ?? 0,
    });
  } catch (err) {
    console.error('GET /users/:uid/luck error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Update luck/pity ──
router.post('/users/:uid/luck', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Invalid JSON body' });

    const updates = {};
    if (body.luckScore != null) {
      updates.luckScore = Math.max(0, Math.min(100, parseInt(body.luckScore)));
    }
    if (body.pityCounter != null) {
      updates.pityCounter = Math.max(0, parseInt(body.pityCounter));
    }

    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });

    await Promise.all([
      db.doc(`users/${req.params.uid}`).update(updates),

      db.doc(`adminAuditLog/${generateId()}`).set({
        adminId:      req.auth.uid,
        action:       'SET_LUCK',
        targetUserId: req.params.uid,
        details:      JSON.stringify(body),
        createdAt:    now(),
      }),
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error('POST /users/:uid/luck error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Transaction history (admin view — any user) ──
router.get('/users/:uid/transactions', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const limit = Math.min(parseInt(req.query.limit || '50'), 200);
    const filterType = req.query.type;

    let query = db.collection(`users/${req.params.uid}/transactions`)
      .orderBy('timestamp', 'desc')
      .limit(limit);

    if (filterType) {
      query = query.where('type', '==', filterType);
    }

    const snapshot = await query.get();
    const results = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    res.json(results);
  } catch (err) {
    console.error('GET /users/:uid/transactions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Gacha guarantee: check ──
router.get('/users/:uid/guarantee-next-pull', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const snap = await db.doc(`users/${req.params.uid}`).get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });
    const user = snap.data();

    const guaranteedGiftId = user.guaranteedNextPullGiftId
      ?? user.guaranteed_next_pull_gift_id
      ?? null;

    let gift = null;
    if (guaranteedGiftId) {
      const giftSnap = await db.doc(`gifts/${guaranteedGiftId}`).get();
      if (giftSnap.exists) {
        const giftData = giftSnap.data();
        gift = {
          id:        giftSnap.id,
          name:      giftData.name,
          coinValue: giftData.coinValue ?? giftData.coin_value,
          iconUrl:   giftData.iconUrl   ?? giftData.icon_url,
        };
      }
    }

    res.json({ guaranteedGiftId, gift });
  } catch (err) {
    console.error('GET /users/:uid/guarantee-next-pull error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Gacha guarantee: set ──
router.post('/users/:uid/guarantee-next-pull', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body?.giftId) return res.status(400).json({ error: 'giftId required' });

    // Verify gift exists
    const giftSnap = await db.doc(`gifts/${body.giftId}`).get();
    if (!giftSnap.exists) return res.status(404).json({ error: 'Gift not found' });
    const gift = giftSnap.data();

    await Promise.all([
      db.doc(`users/${req.params.uid}`).update({ guaranteedNextPullGiftId: body.giftId }),

      db.doc(`adminAuditLog/${generateId()}`).set({
        adminId:      req.auth.uid,
        action:       'SET_GUARANTEE',
        targetUserId: req.params.uid,
        details:      `Guaranteed: ${body.giftId}`,
        createdAt:    now(),
      }),
    ]);

    res.json({
      success: true,
      giftName: gift.name ?? gift.giftName ?? body.giftId,
      coinValue: gift.coinValue ?? gift.coin_value ?? 0,
    });
  } catch (err) {
    console.error('POST /users/:uid/guarantee-next-pull error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Gacha guarantee: revoke ──
router.delete('/users/:uid/guarantee-next-pull', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    await Promise.all([
      db.doc(`users/${req.params.uid}`).update({ guaranteedNextPullGiftId: null }),

      db.doc(`adminAuditLog/${generateId()}`).set({
        adminId:      req.auth.uid,
        action:       'REVOKE_GUARANTEE',
        targetUserId: req.params.uid,
        details:      null,
        createdAt:    now(),
      }),
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /users/:uid/guarantee-next-pull error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
