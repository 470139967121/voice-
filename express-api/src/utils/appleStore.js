/**
 * Apple App Store StoreKit 2 receipt verification.
 *
 * iOS clients send `Transaction.jwsRepresentation` (a signed JWS payload)
 * as the `purchaseToken`. Server-side we use the official Apple library
 * `@apple/app-store-server-library` to verify the JWS signature against
 * Apple's root CA certificates, decode the transaction, and validate
 * bundleId / productId / revocationReason. Mirrors the role of
 * `playStore.js` for Google Play.
 *
 * **Required environment variables (production):**
 * - `APPLE_ROOT_CERTS_DIR` — directory containing Apple Root CA certs
 *   (`AppleRootCA-G3.cer`, `AppleRootCA-G2.cer`, plus the legacy
 *   `AppleIncRootCertificate.cer` and `AppleComputerRootCertificate.cer`).
 *   Download from {@link https://www.apple.com/certificateauthority/}.
 * - `APPLE_APP_STORE_ENV` — `production` or `sandbox` (defaults to
 *   `sandbox` so a misconfigured prod deploy fails closed instead of
 *   accepting sandbox-signed transactions as real purchases).
 * - `APPLE_APP_STORE_APP_ID` — numeric Apple App ID from App Store Connect
 *   (App Information → "Apple ID"). **Required when `APPLE_APP_STORE_ENV=production`** —
 *   Apple's `SignedDataVerifier` constructor throws without it in PRODUCTION
 *   mode, and the notification verifier needs it to bind the JWS to our
 *   specific app identity (defence-in-depth against cross-app payload reuse).
 *
 * Note: This module verifies signed transactions the client passes in.
 * For server-side App Store Server Notifications (refund webhooks,
 * subscription renewals), use `AppStoreServerAPIClient` separately —
 * that path also needs `APPLE_APP_STORE_KEY_ID`, `APPLE_APP_STORE_ISSUER_ID`,
 * `APPLE_APP_STORE_PRIVATE_KEY` (the P8 private key downloaded from
 * App Store Connect → Users and Access → Integrations → In-App Purchase).
 */

const fs = require('node:fs');
const path = require('node:path');
const { SignedDataVerifier, Environment } = require('@apple/app-store-server-library');
const log = require('./log');

const BUNDLE_ID = 'com.shyden.shytalk';

let verifier = null;

function getVerifier() {
  if (verifier) return verifier;

  const certsDir = process.env.APPLE_ROOT_CERTS_DIR;
  if (!certsDir) {
    throw new Error(
      'APPLE_ROOT_CERTS_DIR environment variable is required — set to a directory ' +
        'containing the Apple Root CA certificates (downloadable from ' +
        'https://www.apple.com/certificateauthority/). Defence-in-depth fail-closed ' +
        'so a misconfigured prod deploy never accepts unverified Apple receipts.',
    );
  }

  const certFiles = fs
    .readdirSync(certsDir)
    .filter((f) => f.endsWith('.cer') || f.endsWith('.pem'));

  if (certFiles.length === 0) {
    throw new Error(
      `APPLE_ROOT_CERTS_DIR (${certsDir}) contains no .cer or .pem files — ` +
        'cannot construct SignedDataVerifier without Apple root certs.',
    );
  }

  const rootCerts = certFiles.map((f) => fs.readFileSync(path.join(certsDir, f)));

  // Default to SANDBOX so a misconfigured prod environment that forgot the
  // env var doesn't accept real-money purchases without verification —
  // sandbox-signed JWS payloads will fail the signature check against
  // production root certs.
  const environment =
    process.env.APPLE_APP_STORE_ENV === 'production' ? Environment.PRODUCTION : Environment.SANDBOX;

  // Apple's SignedDataVerifier constructor THROWS if environment is
  // PRODUCTION and appAppleId is undefined. The notification verifier
  // also uses appAppleId to bind the JWS to our specific app identity.
  // Sandbox doesn't require it (and passing undefined there is fine —
  // the library validates the requirement only in PRODUCTION).
  let appAppleId;
  if (environment === Environment.PRODUCTION) {
    const raw = process.env.APPLE_APP_STORE_APP_ID;
    if (!raw) {
      throw new Error(
        'APPLE_APP_STORE_APP_ID environment variable is required when ' +
          'APPLE_APP_STORE_ENV=production. Find it in App Store Connect → ' +
          'App Information → "Apple ID" (numeric).',
      );
    }
    appAppleId = Number(raw);
    if (!Number.isFinite(appAppleId)) {
      throw new Error(
        `APPLE_APP_STORE_APP_ID must be numeric (got "${raw}"). Take the ` +
          'value from App Store Connect → App Information → "Apple ID".',
      );
    }
  }

  // SignedDataVerifier(rootCerts, performOnlineRevocationChecking, environment, bundleId, appAppleId?)
  verifier = new SignedDataVerifier(rootCerts, true, environment, BUNDLE_ID, appAppleId);
  return verifier;
}

/**
 * Verify an Apple StoreKit 2 signed transaction and return normalised data.
 *
 * @param {string} expectedProductId - Product ID the client claimed to purchase
 * @param {string} signedTransactionInfo - JWS from `Transaction.jwsRepresentation`
 * @param {boolean} isSubscription - Whether this is a subscription product
 * @returns {Promise<{orderId: string, productId: string, purchaseDate: number, expiresDate?: number}>}
 * @throws {Error} If JWS signature is invalid, productId/bundleId mismatch, transaction revoked, or subscription expired
 */
async function verifyApplePurchase(expectedProductId, signedTransactionInfo, isSubscription) {
  const v = getVerifier();
  const transaction = await v.verifyAndDecodeTransaction(signedTransactionInfo);

  // The library already enforces bundleId at the SignedDataVerifier level, but
  // re-check here so a future library version that loosens this contract still
  // fails closed at our layer.
  if (transaction.bundleId !== BUNDLE_ID) {
    log.warn('appleStore', 'bundleId mismatch in verified transaction', {
      expectedBundleId: BUNDLE_ID,
      actualBundleId: transaction.bundleId,
      productId: transaction.productId,
    });
    throw new Error(
      `Apple transaction bundleId mismatch: expected ${BUNDLE_ID}, got ${transaction.bundleId}`,
    );
  }

  if (transaction.productId !== expectedProductId) {
    log.warn('appleStore', 'productId mismatch in verified transaction', {
      expectedProductId,
      actualProductId: transaction.productId,
      orderId: transaction.transactionId,
    });
    throw new Error(
      `Apple transaction productId mismatch: expected ${expectedProductId}, got ${transaction.productId}`,
    );
  }

  // Reject refunds and family-share revokes — `revocationReason` is a number
  // (1 = refund, 2 = family-share revoke, etc.) per Apple's docs. Both `null`
  // and `undefined` mean "not revoked".
  if (transaction.revocationReason !== undefined && transaction.revocationReason !== null) {
    log.warn('appleStore', 'transaction revoked', {
      productId: transaction.productId,
      orderId: transaction.transactionId,
      revocationReason: transaction.revocationReason,
    });
    throw new Error(
      `Apple transaction revoked (reason=${transaction.revocationReason}, ` +
        `orderId=${transaction.transactionId})`,
    );
  }

  // For subscriptions, refuse expired tokens at validation time. The client
  // shouldn't send expired tokens, but this is the server-side guarantee the
  // grant logic relies on.
  if (isSubscription && transaction.expiresDate) {
    const now = Date.now();
    if (transaction.expiresDate < now) {
      log.warn('appleStore', 'subscription transaction expired', {
        productId: transaction.productId,
        orderId: transaction.transactionId,
        expiresDate: transaction.expiresDate,
        now,
      });
      throw new Error(`Apple subscription expired at ${transaction.expiresDate} (now=${now})`);
    }
  }

  return {
    orderId: transaction.transactionId,
    productId: transaction.productId,
    purchaseDate: transaction.purchaseDate,
    expiresDate: transaction.expiresDate,
  };
}

/**
 * Verify an App Store Server Notifications V2 signed payload and return
 * the decoded notification body. Used by the
 * `/api/apple-notifications/v2` webhook to handle refunds, renewals,
 * revokes, etc. Reuses the same `SignedDataVerifier` instance as
 * `verifyApplePurchase`.
 */
async function verifyAppleNotification(signedPayload) {
  return getVerifier().verifyAndDecodeNotification(signedPayload);
}

/**
 * Verify a standalone signed transaction payload (e.g.
 * `data.signedTransactionInfo` from an App Store Server Notification)
 * and return the decoded transaction. Convenience wrapper for
 * notification handlers that need the embedded transaction without
 * the productId / bundleId / revocation enforcement that
 * `verifyApplePurchase` runs (those are caller-controlled here).
 */
async function verifyAppleSignedTransaction(signedTransactionInfo) {
  return getVerifier().verifyAndDecodeTransaction(signedTransactionInfo);
}

// Exposed for testing — allows resetting the cached verifier instance
function _resetVerifier() {
  verifier = null;
}

module.exports = {
  verifyApplePurchase,
  verifyAppleNotification,
  verifyAppleSignedTransaction,
  _resetVerifier,
};
