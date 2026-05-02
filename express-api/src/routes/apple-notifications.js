/**
 * Apple App Store Server Notifications V2 webhook receiver.
 *
 * Apple POSTs signed JWS payloads to this endpoint when subscription /
 * purchase events happen server-side (refunds, renewals, revokes, etc.).
 * This is the **authoritative** path for refund handling — `Transaction.updates`
 * on the iOS client is a redundancy that only fires while the app is
 * running.
 *
 * **Setup (manual, one-time):** in App Store Connect → App Information →
 * App Store Server Notifications, set production + sandbox notification
 * URLs to the prod and dev API base URLs respectively, both with the path
 * `/api/apple-notifications/v2` (e.g. on local dev:
 * `http://localhost:3000/api/apple-notifications/v2` via an ngrok tunnel
 * if Apple needs to reach it).
 *
 * Idempotency: Apple may retry up to 5 times. Side effect + dedupe row
 * are committed in a single Firestore batch so retries are safe — either
 * both happen or neither does. Repeated POSTs of the same notificationUUID
 * return 200 immediately without re-applying the side effect.
 *
 * Money safety: refund amounts are read from the original `purchaseReceipt`
 * (which records `coinsGranted` / `tierGranted` at purchase time) rather
 * than from the live `coinPackages` / `SUBSCRIPTION_TIERS` config — so a
 * later price change cannot retroactively rewrite the refund. Orphan
 * refunds (no matching receipt) and unknown product configs page an
 * operator via `alertManager` and persist to a queryable worklist
 * (`orphanRefunds`, `pendingRefundReversals`).
 */

const express = require('express');
const router = express.Router();
const { db, FieldValue } = require('../utils/firebase');
const log = require('../utils/log');
const alertManager = require('../utils/alertManagerInstance');
const { generateId, now } = require('../utils/helpers');
const { verifyAppleNotification, verifyAppleSignedTransaction } = require('../utils/appleStore');
const { SUBSCRIPTION_TIERS } = require('../utils/subscriptionTiers');

/**
 * Look up the user that originally received the entitlement for a given
 * Apple transaction. Receipts are joined by `purchaseReceipts.orderId`
 * (recorded at /economy/purchase time as the verified `transactionId`).
 *
 * Apple notifications carry both the renewal `transactionId` and the
 * `originalTransactionId` (the first purchase in a subscription chain).
 * We coalesce both into a single `where('orderId', 'in', […])` query so
 * the renewal-refund case costs one Firestore read instead of two.
 */
async function findUserAndReceipt(transaction) {
  const candidates = [transaction.transactionId, transaction.originalTransactionId]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
  if (candidates.length === 0) return null;

  const snap = await db
    .collection('purchaseReceipts')
    .where('orderId', 'in', candidates)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { receiptId: doc.id, receipt: doc.data(), userId: doc.data().userId };
}

/**
 * Reverse a coin-pack purchase atomically with the dedupe-row write.
 *
 * Reads `coinsGranted` / `bonusCoinsGranted` from the original receipt
 * so the reversal matches what the user actually received, even if the
 * `coinPackages` config has changed since purchase. Legacy receipts
 * (pre-`coinsGranted` schema) fall back to the live `coinPackages`
 * lookup with a logged warning so operators can spot the migration tail.
 *
 * The user's coin balance can go negative if they've already spent the
 * refunded coins — the in-arrears state is intentional (we can't claw
 * back spent coins, but the negative balance prevents further spending
 * until topped up).
 *
 * Returns `{ ok: true }` on success, `{ ok: false, reason }` if the
 * refund cannot be applied safely (caller decides whether to alert).
 */
async function reverseCoinPackEntitlement(found, transaction, dedupePayload, dedupeRef) {
  const { receipt, userId } = found;
  const productId = transaction.productId;

  let totalCoins;
  let detailSuffix;
  if (receipt.coinsGranted !== undefined) {
    const coins = receipt.coinsGranted || 0;
    const bonus = receipt.bonusCoinsGranted || 0;
    totalCoins = coins + bonus;
    detailSuffix = `${coins} + ${bonus} bonus coins (${productId})`;
  } else {
    log.warn(
      'apple-notifications',
      'Legacy receipt without coinsGranted; falling back to live coinPackages',
      {
        receiptId: found.receiptId,
        userId,
        productId,
      },
    );
    const pkgSnap = await db
      .collection('coinPackages')
      .where('productId', '==', productId)
      .limit(1)
      .get();
    if (pkgSnap.empty) {
      return { ok: false, reason: 'unknown_product' };
    }
    const pkg = pkgSnap.docs[0].data();
    const coins = pkg.coins || 0;
    const bonus = pkg.bonusCoins || 0;
    totalCoins = coins + bonus;
    detailSuffix = `${coins} + ${bonus} bonus coins (${productId}, legacy fallback)`;
  }

  if (totalCoins <= 0) {
    return { ok: false, reason: 'zero_coins' };
  }

  const batch = db.batch();
  batch.update(db.doc(`users/${userId}`), { shyCoins: FieldValue.increment(-totalCoins) });
  batch.set(db.doc(`users/${userId}/transactions/${generateId()}`), {
    type: 'REFUND',
    amount: -totalCoins,
    currency: 'COINS',
    // Negative balance is acceptable here — the post-update balance is
    // not knowable inside a batch without an extra read, and surfacing a
    // misleading zero would be worse than omitting it. UI reads the
    // user's live `shyCoins` field anyway.
    balanceAfter: null,
    details: `Refund: ${detailSuffix}`,
    timestamp: now(),
    originOrderId: transaction.transactionId,
  });
  batch.set(dedupeRef, dedupePayload);
  await batch.commit();

  log.info('apple-notifications', 'Reversed coin-pack entitlement', {
    userId,
    productId,
    coinsRemoved: totalCoins,
  });
  return { ok: true };
}

/**
 * Reverse a subscription purchase atomically with the dedupe-row write.
 *
 * Reads `tierGranted` from the original receipt so the reversal matches
 * the tier the user actually purchased. If the receipt predates the
 * `tierGranted` schema, falls back to `SUBSCRIPTION_TIERS[productId]`
 * with a logged warning. If the productId is unknown to both, the
 * entitlement is **still cleared defensively** (we know it's a refund —
 * the safe action is to revoke even if we can't write a perfect
 * REFUND transaction details string), and an operator is paged.
 */
async function reverseSubscriptionEntitlement(found, transaction, dedupePayload, dedupeRef) {
  const { receipt, userId } = found;
  const productId = transaction.productId;

  let tier = receipt.tierGranted;
  if (!tier) {
    const sub = SUBSCRIPTION_TIERS[productId];
    if (sub) {
      tier = sub.tier;
      log.warn(
        'apple-notifications',
        'Legacy subscription receipt without tierGranted; using SUBSCRIPTION_TIERS',
        {
          receiptId: found.receiptId,
          userId,
          productId,
        },
      );
    } else {
      log.error(
        'apple-notifications',
        'Refund for subscription not in SUBSCRIPTION_TIERS — clearing defensively',
        {
          userId,
          productId,
          orderId: transaction.transactionId,
        },
      );
      tier = 'unknown';
    }
  }

  const batch = db.batch();
  batch.update(db.doc(`users/${userId}`), {
    isSuperShy: false,
    superShyExpiry: null,
    superShyTier: null,
  });
  batch.set(db.doc(`users/${userId}/transactions/${generateId()}`), {
    type: 'REFUND',
    amount: 0,
    currency: 'COINS',
    balanceAfter: null,
    details: `Subscription refund: Super Shy ${tier} (${productId})`,
    timestamp: now(),
    originOrderId: transaction.transactionId,
  });
  batch.set(dedupeRef, dedupePayload);
  await batch.commit();

  log.info('apple-notifications', 'Reversed subscription entitlement', { userId, productId, tier });
  return { ok: tier !== 'unknown', reason: tier === 'unknown' ? 'unknown_subscription' : null };
}

/**
 * Clear a subscription entitlement atomically with the dedupe-row write.
 * Used by EXPIRED / DID_FAIL_TO_RENEW / GRACE_PERIOD_EXPIRED — no REFUND
 * transaction is written because no money moved.
 */
async function clearSubscriptionAtomic(userId, dedupePayload, dedupeRef) {
  const batch = db.batch();
  batch.update(db.doc(`users/${userId}`), {
    isSuperShy: false,
    superShyExpiry: null,
    superShyTier: null,
  });
  batch.set(dedupeRef, dedupePayload);
  await batch.commit();
}

/**
 * Persist the dedupe row only — no side effect. Used for notification
 * types that we ack without entitlement changes (TEST, CONSUMPTION_REQUEST,
 * RESCIND_CONSENT, etc.) and for the early-return paths (orphan refund,
 * REFUND_REVERSED) where the side effect is delegated to a worklist
 * collection that ops resolves manually.
 */
async function writeDedupeOnly(dedupePayload, dedupeRef) {
  await dedupeRef.set(dedupePayload);
}

/**
 * Apply a notification's side effect. Switch on `notificationType`. Each
 * branch is responsible for committing its own dedupe row atomically with
 * any state mutation, so a mid-handler crash leaves nothing half-applied.
 *
 * Returns nothing on success; throws to let the caller return 500 (Apple
 * will retry).
 */
async function handleNotification(notification, transaction, dedupePayload, dedupeRef) {
  const { notificationType, notificationUUID } = notification;

  // Types that need a transaction to identify the affected user. If
  // absent, ack with a logged warning so Apple stops retrying — there's
  // nothing actionable.
  const needsTransaction = [
    'REFUND',
    'REVOKE',
    'REFUND_REVERSED',
    'EXPIRED',
    'DID_FAIL_TO_RENEW',
    'GRACE_PERIOD_EXPIRED',
  ].includes(notificationType);
  if (needsTransaction && !transaction) {
    log.warn('apple-notifications', 'Notification of impactful type missing transaction', {
      notificationType,
      notificationUUID,
    });
    await writeDedupeOnly(dedupePayload, dedupeRef);
    return;
  }

  switch (notificationType) {
    case 'REFUND':
    case 'REVOKE': {
      const found = await findUserAndReceipt(transaction);
      if (!found) {
        log.error('apple-notifications', 'Orphan refund — no purchaseReceipt matched', {
          orderId: transaction.transactionId,
          originalTransactionId: transaction.originalTransactionId,
          productId: transaction.productId,
          notificationUUID,
        });
        await db
          .collection('orphanRefunds')
          .doc(notificationUUID)
          .set({
            orderId: transaction.transactionId,
            originalTransactionId: transaction.originalTransactionId || null,
            productId: transaction.productId,
            notificationType,
            receivedAt: now(),
            resolved: false,
          });
        await alertManager.createAlert(
          'orphan_refund',
          'high',
          'Apple refund with no matching purchaseReceipt',
          `productId=${transaction.productId}, orderId=${transaction.transactionId}`,
          {
            orderId: transaction.transactionId,
            originalTransactionId: transaction.originalTransactionId || null,
            productId: transaction.productId,
            notificationUUID,
          },
        );
        await writeDedupeOnly(dedupePayload, dedupeRef);
        return;
      }
      let result;
      if (found.receipt.isSubscription) {
        result = await reverseSubscriptionEntitlement(found, transaction, dedupePayload, dedupeRef);
        if (!result.ok) {
          await alertManager.createAlert(
            'refund_unknown_subscription',
            'high',
            'Apple refund for subscription not in SUBSCRIPTION_TIERS',
            `productId=${transaction.productId}, userId=${found.userId}`,
            {
              productId: transaction.productId,
              userId: found.userId,
              orderId: transaction.transactionId,
              notificationUUID,
            },
          );
        }
      } else {
        result = await reverseCoinPackEntitlement(found, transaction, dedupePayload, dedupeRef);
        if (!result.ok) {
          // Coin-pack reverse couldn't determine totalCoins — write the
          // dedupe row so Apple stops retrying, then alert ops to handle
          // manually. Without the dedupe write, every retry would re-fail
          // and re-alert, drowning ops.
          await writeDedupeOnly(dedupePayload, dedupeRef);
          await alertManager.createAlert(
            'refund_coin_pack_failed',
            'high',
            'Apple coin-pack refund could not be reversed automatically',
            `reason=${result.reason}, productId=${transaction.productId}, userId=${found.userId}`,
            {
              reason: result.reason,
              productId: transaction.productId,
              userId: found.userId,
              receiptId: found.receiptId,
              orderId: transaction.transactionId,
              notificationUUID,
            },
          );
        }
      }
      return;
    }

    case 'REFUND_REVERSED': {
      // Apple un-refunded — the customer paid again. The entitlement
      // must be restored, but the safe re-grant path requires reading
      // the original receipt's granted amounts and re-applying them.
      // For correctness we delegate to ops via a worklist + alert
      // rather than risk a buggy auto-restore on a money-affecting
      // event. See B6.10c follow-up tracker.
      log.error(
        'apple-notifications',
        'REFUND_REVERSED received — manual entitlement restoration required',
        {
          orderId: transaction.transactionId,
          productId: transaction.productId,
          notificationUUID,
        },
      );
      await db.collection('pendingRefundReversals').doc(notificationUUID).set({
        orderId: transaction.transactionId,
        productId: transaction.productId,
        receivedAt: now(),
        resolved: false,
      });
      await alertManager.createAlert(
        'refund_reversed',
        'critical',
        'Apple refund reversed — manual entitlement restoration required',
        `productId=${transaction.productId}, orderId=${transaction.transactionId}`,
        {
          orderId: transaction.transactionId,
          productId: transaction.productId,
          notificationUUID,
        },
      );
      await writeDedupeOnly(dedupePayload, dedupeRef);
      return;
    }

    case 'EXPIRED':
    case 'DID_FAIL_TO_RENEW':
    case 'GRACE_PERIOD_EXPIRED': {
      const found = await findUserAndReceipt(transaction);
      if (!found) {
        log.warn('apple-notifications', 'Subscription expiry with no matching receipt', {
          notificationType,
          orderId: transaction.transactionId,
          originalTransactionId: transaction.originalTransactionId,
          productId: transaction.productId,
        });
        await writeDedupeOnly(dedupePayload, dedupeRef);
        return;
      }
      if (!found.receipt.isSubscription) {
        log.error(
          'apple-notifications',
          'Expiry notification for non-subscription receipt — data inconsistency',
          {
            receiptId: found.receiptId,
            userId: found.userId,
            productId: transaction.productId,
            notificationType,
          },
        );
        await writeDedupeOnly(dedupePayload, dedupeRef);
        return;
      }
      await clearSubscriptionAtomic(found.userId, dedupePayload, dedupeRef);
      log.info('apple-notifications', 'Subscription entitlement cleared', {
        userId: found.userId,
        productId: transaction.productId,
        notificationType,
      });
      return;
    }

    case 'CONSUMPTION_REQUEST':
      // Apple is asking us whether the user is owed a refund. We have 12h
      // to respond via the App Store Server API or Apple decides for us.
      // Auto-decline policy is not implemented yet; surface to ops so
      // they can respond manually for now.
      log.warn(
        'apple-notifications',
        'CONSUMPTION_REQUEST — must respond within 12h or Apple auto-decides',
        {
          notificationUUID,
          orderId: transaction ? transaction.transactionId : null,
          productId: transaction ? transaction.productId : null,
        },
      );
      await alertManager.createAlert(
        'consumption_request',
        'high',
        'Apple wants consumption decision (12h SLA)',
        `productId=${transaction ? transaction.productId : 'n/a'}, orderId=${transaction ? transaction.transactionId : 'n/a'}`,
        {
          notificationUUID,
          orderId: transaction ? transaction.transactionId : null,
          productId: transaction ? transaction.productId : null,
        },
      );
      await writeDedupeOnly(dedupePayload, dedupeRef);
      return;

    case 'TEST':
      log.info('apple-notifications', 'Received TEST notification', { notificationUUID });
      await writeDedupeOnly(dedupePayload, dedupeRef);
      return;

    default:
      // SUBSCRIBED / DID_RENEW / DID_CHANGE_RENEWAL_* / OFFER_REDEEMED /
      // PRICE_INCREASE / RENEWAL_EXTENDED / RENEWAL_EXTENSION /
      // EXTERNAL_PURCHASE_TOKEN / ONE_TIME_CHARGE / RESCIND_CONSENT /
      // REFUND_DECLINED — log and ack. Server-side grant on SUBSCRIBED /
      // DID_RENEW is currently the client's responsibility (StoreKit 2
      // Transaction.updates listener); follow-up tracked separately.
      log.info('apple-notifications', 'Acknowledged notification (no side effect)', {
        notificationType,
        notificationUUID,
      });
      await writeDedupeOnly(dedupePayload, dedupeRef);
  }
}

/**
 * Apple App Store Server Notifications V2 webhook.
 *
 * NOT auth-gated by Bearer token — the JWS signature IS the
 * authentication. We verify against Apple Root CA certs before doing
 * anything. The auth-middleware allow-list in `index.js` skips this
 * route for that reason.
 */
router.post('/apple-notifications/v2', async (req, res) => {
  let notificationUUID = null;
  let notificationType = null;
  try {
    const { signedPayload } = req.body || {};
    if (!signedPayload) {
      return res.status(400).json({ error: 'signedPayload required' });
    }

    let notification;
    try {
      notification = await verifyAppleNotification(signedPayload);
    } catch (e) {
      log.warn('apple-notifications', 'Notification signature verification failed', {
        error: e.message,
      });
      return res.status(400).json({ error: 'Invalid notification signature' });
    }

    notificationUUID = notification.notificationUUID;
    notificationType = notification.notificationType;
    if (!notificationUUID) {
      log.warn('apple-notifications', 'Notification missing notificationUUID');
      return res.status(400).json({ error: 'Notification missing notificationUUID' });
    }

    // Idempotency: Apple may retry. Skip if we've seen this UUID.
    const dedupeRef = db.collection('appleNotifications').doc(notificationUUID);
    const dedupeSnap = await dedupeRef.get();
    if (dedupeSnap.exists) {
      log.info('apple-notifications', 'Duplicate notification ignored', { notificationUUID });
      return res.status(200).json({ ok: true, deduped: true });
    }

    let transaction = null;
    if (notification.data && notification.data.signedTransactionInfo) {
      try {
        transaction = await verifyAppleSignedTransaction(notification.data.signedTransactionInfo);
      } catch (e) {
        log.warn('apple-notifications', 'Embedded transaction signature failed', {
          notificationUUID,
          error: e.message,
        });
        return res.status(400).json({ error: 'Invalid embedded transaction' });
      }
    }

    const dedupePayload = {
      notificationType,
      notificationUUID,
      orderId: transaction ? transaction.transactionId : null,
      receivedAt: now(),
    };

    // Each branch in handleNotification commits its own atomic batch
    // (state mutation + dedupe write together) so a mid-handler crash
    // leaves nothing half-applied. On Apple retry, the dedupe row check
    // above short-circuits.
    await handleNotification(notification, transaction, dedupePayload, dedupeRef);

    res.status(200).json({ ok: true });
  } catch (err) {
    // Defensive: protect against logger-throw paths so the response
    // always sends. Without this, a logger bug would hang the request
    // until Apple times out — invisible to ops.
    try {
      log.error('apple-notifications', 'Notification handler crashed', {
        error: err.message,
        stack: err.stack,
        notificationUUID,
        notificationType,
      });
    } catch {
      // eslint-disable-next-line no-console
      console.error('apple-notifications: log.error itself threw', err);
    }
    try {
      await alertManager.createAlert(
        'apple_notification_crash',
        'critical',
        'Apple notification handler crashed',
        err.message || 'unknown error',
        { notificationUUID, notificationType, stack: err.stack },
      );
    } catch {
      // Alert firing is best-effort — must not mask the original error.
    }
    // Return 500 so Apple retries — better to retry than to silently
    // drop. The atomic batch guarantees no partial side effect was
    // applied, so the retry is safe.
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
