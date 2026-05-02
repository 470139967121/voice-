/**
 * Single source of truth for the productId → subscription-tier map.
 *
 * Both `routes/economy.js` (purchase grant path) and
 * `routes/apple-notifications.js` (refund / expiry / revoke path) read
 * from this. Previously the same map was duplicated in both files; that
 * meant adding a new tier (e.g. a quarterly SKU or a localised
 * promotional offer) only on the purchase side would silently break the
 * refund side — the refund handler would log a warning, ack with 200,
 * and the user would keep their entitlement after a refund. Centralising
 * the map here makes that drift impossible.
 *
 * `tier` is the value persisted to `users.superShyTier`.
 * `days` is the entitlement length (`null` = lifetime / never expires).
 */
const SUBSCRIPTION_TIERS = Object.freeze({
  super_shy_monthly: { tier: 'monthly', days: 30 },
  super_shy_yearly: { tier: 'yearly', days: 365 },
  super_shy_lifetime: { tier: 'lifetime', days: null },
});

module.exports = { SUBSCRIPTION_TIERS };
