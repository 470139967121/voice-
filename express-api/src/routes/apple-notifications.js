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
 * Idempotency: Apple may retry up to 5 times. Dedupe by `notificationUUID`
 * stored in `appleNotifications/<uuid>`. Repeated POSTs of the same
 * notification return 200 immediately without re-applying the side effect.
 */

const express = require('express');
const router = express.Router();
const { db, FieldValue } = require('../utils/firebase');
const log = require('../utils/log');
const { generateId, now } = require('../utils/helpers');
const { verifyAppleNotification, verifyAppleSignedTransaction } = require('../utils/appleStore');

// Subscription productId → tier mapping (mirrors economy.js purchase grant logic).
const SUBSCRIPTION_TIERS = {
  super_shy_monthly: { tier: 'monthly', days: 30 },
  super_shy_yearly: { tier: 'yearly', days: 365 },
  super_shy_lifetime: { tier: 'lifetime', days: null },
};

/**
 * Look up the user that originally received the entitlement for a given
 * Apple transaction, by joining on `purchaseReceipts.orderId` (which we
 * record at /economy/purchase time as `transaction.transactionId`).
 *
 * Apple notifications can carry `originalTransactionId` (the ID of the
 * first purchase in a subscription chain) plus a fresh `transactionId`
 * for the renewal event — try both so renewal/refund notifications find
 * the right user even when the receipt was recorded under the original.
 */
async function findUserAndReceipt(transaction) {
  const candidateOrderIds = [transaction.transactionId, transaction.originalTransactionId].filter(
    Boolean,
  );
  for (const orderId of candidateOrderIds) {
    const snap = await db
      .collection('purchaseReceipts')
      .where('orderId', '==', orderId)
      .limit(1)
      .get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      return { receiptId: doc.id, receipt: doc.data(), userId: doc.data().userId };
    }
  }
  return null;
}

/**
 * Reverse a coin-pack purchase. Decrement coins, write a REFUND
 * transaction. Coins go negative if the user has already spent them —
 * the in-arrears state is intentional (we can't claw back spent coins,
 * but the negative balance prevents further spending until topped up).
 */
async function reverseCoinPackEntitlement(receipt, transaction) {
  const userId = receipt.userId;
  const productId = transaction.productId;

  const pkgSnap = await db
    .collection('coinPackages')
    .where('productId', '==', productId)
    .limit(1)
    .get();
  if (pkgSnap.empty) {
    log.warn('apple-notifications', 'Refund for unknown coin package', { productId, userId });
    return;
  }
  const pkg = pkgSnap.docs[0].data();
  const totalCoins = (pkg.coins || 0) + (pkg.bonusCoins || 0);

  await db.doc(`users/${userId}`).update({
    shyCoins: FieldValue.increment(-totalCoins),
  });

  const userSnap = await db.doc(`users/${userId}`).get();
  const balanceAfter = userSnap.exists ? userSnap.data().shyCoins || 0 : 0;

  await db.doc(`users/${userId}/transactions/${generateId()}`).set({
    type: 'REFUND',
    amount: -totalCoins,
    currency: 'COINS',
    balanceAfter,
    details: `Refund: ${pkg.coins} + ${pkg.bonusCoins || 0} bonus coins (${productId})`,
    timestamp: now(),
    originOrderId: transaction.transactionId,
  });

  log.info('apple-notifications', 'Reversed coin-pack entitlement', {
    userId,
    productId,
    coinsRemoved: totalCoins,
    balanceAfter,
  });
}

/**
 * Reverse a subscription purchase. Clear isSuperShy / superShyExpiry /
 * superShyTier and write a REFUND transaction. Refunds for subscriptions
 * always end the entitlement immediately regardless of expiry date —
 * matches Apple's UX where the user gets the money back AND loses access.
 */
async function reverseSubscriptionEntitlement(receipt, transaction) {
  const userId = receipt.userId;
  const productId = transaction.productId;
  const sub = SUBSCRIPTION_TIERS[productId];
  if (!sub) {
    log.warn('apple-notifications', 'Refund for unknown subscription', { productId, userId });
    return;
  }

  await db.doc(`users/${userId}`).update({
    isSuperShy: false,
    superShyExpiry: null,
    superShyTier: null,
  });

  await db.doc(`users/${userId}/transactions/${generateId()}`).set({
    type: 'REFUND',
    amount: 0,
    currency: 'COINS',
    balanceAfter: 0,
    details: `Subscription refund: Super Shy ${sub.tier} (${productId})`,
    timestamp: now(),
    originOrderId: transaction.transactionId,
  });

  log.info('apple-notifications', 'Reversed subscription entitlement', {
    userId,
    productId,
    tier: sub.tier,
  });
}

/**
 * Apply a notification's side effect. Switch on `notificationType`.
 * Unknown types are logged and acknowledged — Apple expects 200 so it
 * doesn't keep retrying.
 */
async function handleNotification(notification, transaction) {
  const { notificationType } = notification;

  // REFUND/REVOKE/REFUND_REVERSED/EXPIRED/DID_FAIL_TO_RENEW all need a
  // transaction to identify the affected user. If absent, ack and log so
  // Apple stops retrying — there's nothing actionable.
  const needsTransaction = [
    'REFUND',
    'REVOKE',
    'REFUND_REVERSED',
    'EXPIRED',
    'DID_FAIL_TO_RENEW',
  ].includes(notificationType);
  if (needsTransaction && !transaction) {
    log.warn('apple-notifications', 'Notification of impactful type missing transaction', {
      notificationType,
      notificationUUID: notification.notificationUUID,
    });
    return;
  }

  switch (notificationType) {
    case 'REFUND':
    case 'REVOKE': {
      const found = await findUserAndReceipt(transaction);
      if (!found) {
        log.warn('apple-notifications', 'No purchaseReceipt found for refund/revoke', {
          orderId: transaction.transactionId,
          originalTransactionId: transaction.originalTransactionId,
          productId: transaction.productId,
        });
        return;
      }
      if (found.receipt.isSubscription) {
        await reverseSubscriptionEntitlement(found.receipt, transaction);
      } else {
        await reverseCoinPackEntitlement(found.receipt, transaction);
      }
      break;
    }

    case 'REFUND_REVERSED':
      // Apple un-refunded — the entitlement should be restored. Re-running
      // the original grant is the cleanest path; leaving as TODO for now
      // since this is rare and needs careful idempotency design.
      log.warn('apple-notifications', 'REFUND_REVERSED received — manual restoration needed', {
        orderId: transaction.transactionId,
        productId: transaction.productId,
      });
      break;

    case 'EXPIRED':
    case 'DID_FAIL_TO_RENEW': {
      const found = await findUserAndReceipt(transaction);
      if (found && found.receipt.isSubscription) {
        await db.doc(`users/${found.userId}`).update({
          isSuperShy: false,
          superShyExpiry: null,
          superShyTier: null,
        });
        log.info('apple-notifications', 'Subscription expired', {
          userId: found.userId,
          productId: transaction.productId,
        });
      }
      break;
    }

    case 'TEST':
      log.info('apple-notifications', 'Received TEST notification', {
        notificationUUID: notification.notificationUUID,
      });
      break;

    default:
      // SUBSCRIBED / DID_RENEW / DID_CHANGE_RENEWAL_* / OFFER_REDEEMED /
      // GRACE_PERIOD_EXPIRED / PRICE_INCREASE / CONSUMPTION_REQUEST /
      // RENEWAL_EXTENDED / RENEWAL_EXTENSION / EXTERNAL_PURCHASE_TOKEN /
      // ONE_TIME_CHARGE / RESCIND_CONSENT / REFUND_DECLINED — log and ack.
      // SUBSCRIBED + DID_RENEW could grant/extend the subscription server-side
      // (currently the client-side purchase flow handles that path); follow-up
      // work tracked in roadmap B6.10c follow-up.
      log.info('apple-notifications', 'Acknowledged notification (no side effect)', {
        notificationType,
        notificationUUID: notification.notificationUUID,
      });
  }
}

/**
 * Apple App Store Server Notifications V2 webhook.
 *
 * NOT auth-gated — the JWS signature IS the authentication. We verify
 * the signature against Apple Root CA certs before doing anything.
 */
router.post('/apple-notifications/v2', async (req, res) => {
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

    const { notificationUUID } = notification;
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

    // Always call the handler — some notification types (TEST,
    // EXTERNAL_PURCHASE_TOKEN, RESCIND_CONSENT, summary-only renewal-
    // extension responses) legitimately have no embedded transaction.
    // The handler logs + acks for those.
    await handleNotification(notification, transaction);

    // Record after handler completes so a handler crash doesn't write a
    // dedupe row that prevents retry. If `set` itself fails, Apple will
    // retry and we'll attempt the handler again — idempotency is then
    // up to each handler (e.g., reverseCoinPackEntitlement uses
    // FieldValue.increment which would double-deduct on retry — that's
    // a known limitation tracked separately).
    await dedupeRef.set({
      notificationType: notification.notificationType,
      notificationUUID,
      orderId: transaction ? transaction.transactionId : null,
      receivedAt: now(),
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    log.error('apple-notifications', 'Notification handler crashed', { error: err.message });
    // Return 500 so Apple retries — better to double-process than to
    // silently drop a refund notification.
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
