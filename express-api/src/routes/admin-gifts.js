/**
 * Admin gift catalog routes — CRUD + seed.
 *
 * POST   /gifts         → Create new gift (admin)
 * PUT    /gifts/:id     → Update gift fields (admin)
 * DELETE /gifts/:id     → Delete gift (admin)
 * POST   /gifts/seed    → Seed 27-gift catalog (admin, idempotent)
 */

const router = require('express').Router();
const { db, FieldValue } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');
const { generateId, now } = require('../utils/helpers');

// ── Create gift ──
router.post('/gifts', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body?.name || body.coinValue == null) {
      return res.status(400).json({ error: 'name and coinValue required' });
    }

    const id = body.id || generateId();
    const giftData = {
      id,
      name:             body.name,
      coinValue:        body.coinValue,
      animationUrl:     body.animationUrl ?? body.animation_url ?? '',
      soundUrl:         body.soundUrl     ?? body.sound_url     ?? '',
      iconUrl:          body.iconUrl      ?? body.icon_url      ?? '',
      order:            body.order        ?? 0,
      expiresAfterDays: body.expiresAfterDays ?? body.expires_after_days ?? null,
      showInStore:      body.showInStore  !== false && body.show_in_store  !== false,
      showOnWheel:      body.showOnWheel  !== false && body.show_on_wheel  !== false,
      weight:           body.weight       ?? 1.0,
    };

    await Promise.all([
      db.doc(`gifts/${id}`).set(giftData),

      db.doc(`adminAuditLog/${generateId()}`).set({
        adminId:      req.auth.uid,
        action:       'CREATE_GIFT',
        targetUserId: null,
        details:      `Created gift: ${body.name} (${id})`,
        createdAt:    now(),
      }),
    ]);

    res.json({ success: true, id });
  } catch (err) {
    console.error('POST /gifts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Update gift ──
router.put('/gifts/:id', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Invalid JSON body' });

    // Build camelCase update object from either camelCase or snake_case input
    const updates = {};
    if ('name' in body)                                                    updates.name             = body.name;
    if ('coinValue' in body || 'coin_value' in body)                      updates.coinValue         = body.coinValue        ?? body.coin_value;
    if ('animationUrl' in body || 'animation_url' in body)                updates.animationUrl      = body.animationUrl     ?? body.animation_url;
    if ('soundUrl' in body || 'sound_url' in body)                        updates.soundUrl          = body.soundUrl         ?? body.sound_url;
    if ('iconUrl' in body || 'icon_url' in body)                          updates.iconUrl           = body.iconUrl          ?? body.icon_url;
    if ('order' in body)                                                   updates.order             = body.order;
    if ('expiresAfterDays' in body || 'expires_after_days' in body)       updates.expiresAfterDays  = body.expiresAfterDays ?? body.expires_after_days;
    if ('showInStore' in body || 'show_in_store' in body)                 updates.showInStore       = !!(body.showInStore   ?? body.show_in_store);
    if ('showOnWheel' in body || 'show_on_wheel' in body)                 updates.showOnWheel       = !!(body.showOnWheel   ?? body.show_on_wheel);
    if ('weight' in body)                                                  updates.weight            = body.weight;

    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    await db.doc(`gifts/${req.params.id}`).update(updates);

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /gifts/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete gift ──
router.delete('/gifts/:id', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    await Promise.all([
      db.doc(`gifts/${req.params.id}`).delete(),

      db.doc(`adminAuditLog/${generateId()}`).set({
        adminId:      req.auth.uid,
        action:       'DELETE_GIFT',
        targetUserId: null,
        details:      `Deleted gift: ${req.params.id}`,
        createdAt:    now(),
      }),
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /gifts/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Seed gift catalog (idempotent upsert) ──
router.post('/gifts/seed', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const SEED_GIFTS = [
      { id: 'rose',           name: 'Rose',           coinValue: 1,      order: 1  },
      { id: 'lollipop',       name: 'Lollipop',       coinValue: 5,      order: 2  },
      { id: 'ice_cream',      name: 'Ice Cream',      coinValue: 10,     order: 3  },
      { id: 'coffee',         name: 'Coffee',         coinValue: 25,     order: 4  },
      { id: 'teddy_bear',     name: 'Teddy Bear',     coinValue: 50,     order: 5  },
      { id: 'chocolate_box',  name: 'Chocolate Box',  coinValue: 100,    order: 6  },
      { id: 'bouquet',        name: 'Bouquet',        coinValue: 200,    order: 7  },
      { id: 'perfume',        name: 'Perfume',        coinValue: 500,    order: 8  },
      { id: 'fireworks',      name: 'Fireworks',      coinValue: 1000,   order: 9  },
      { id: 'diamond_ring',   name: 'Diamond Ring',   coinValue: 2000,   order: 10 },
      { id: 'crown',          name: 'Crown',          coinValue: 5000,   order: 11 },
      { id: 'castle',         name: 'Castle',         coinValue: 10000,  order: 12 },
      { id: 'yacht',          name: 'Yacht',          coinValue: 20000,  order: 13 },
      { id: 'rocket',         name: 'Rocket',         coinValue: 50000,  order: 14 },
      { id: 'planet',         name: 'Planet',         coinValue: 100000, order: 15 },
      { id: 'universe',       name: 'Universe',       coinValue: 200000, order: 16 },
      { id: 'star',           name: 'Star',           coinValue: 10,     order: 17 },
      { id: 'heart',          name: 'Heart',          coinValue: 25,     order: 18 },
      { id: 'balloon',        name: 'Balloon',        coinValue: 5,      order: 19 },
      { id: 'cake',           name: 'Cake',           coinValue: 50,     order: 20 },
      { id: 'pizza',          name: 'Pizza',          coinValue: 15,     order: 21 },
      { id: 'sushi',          name: 'Sushi',          coinValue: 30,     order: 22 },
      { id: 'rainbow',        name: 'Rainbow',        coinValue: 500,    order: 23 },
      { id: 'sunflower',      name: 'Sunflower',      coinValue: 100,    order: 24 },
      { id: 'music_box',      name: 'Music Box',      coinValue: 250,    order: 25 },
      { id: 'magic_lamp',     name: 'Magic Lamp',     coinValue: 1500,   order: 26 },
      { id: 'treasure_chest', name: 'Treasure Chest', coinValue: 3000,   order: 27 },
    ];

    // Batch upsert all gifts — use set with merge to be idempotent
    const batch = db.batch();

    for (const g of SEED_GIFTS) {
      batch.set(db.doc(`gifts/${g.id}`), {
        id:           g.id,
        name:         g.name,
        coinValue:    g.coinValue,
        order:        g.order,
        animationUrl: '',
        soundUrl:     '',
        iconUrl:      '',
        showInStore:  true,
        showOnWheel:  true,
        weight:       1.0,
      }, { merge: true });
    }

    await batch.commit();

    await db.doc(`adminAuditLog/${generateId()}`).set({
      adminId:      req.auth.uid,
      action:       'SEED_GIFTS',
      targetUserId: null,
      details:      'Seeded 27 gifts',
      createdAt:    now(),
    });

    res.json({ success: true, count: SEED_GIFTS.length });
  } catch (err) {
    console.error('POST /gifts/seed error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
