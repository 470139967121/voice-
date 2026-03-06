/**
 * Firebase Auth middleware for Express.
 *
 * Uses Firebase Admin SDK to verify ID tokens (replaces 364 lines of
 * manual JWT verification, X.509 parsing, and signature caching).
 */

const { auth, db } = require('../utils/firebase');

// In-memory suspension cache: uid → { isSuspended, expiresAt }
const suspensionCache = new Map();
const SUSPENSION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function checkSuspension(uid) {
  const cached = suspensionCache.get(uid);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.isSuspended;
  }

  const snap = await db.doc(`users/${uid}`).get();
  const user = snap.data();
  const isSuspended = !!(user?.isSuspended || user?.is_suspended);

  suspensionCache.set(uid, { isSuspended, expiresAt: Date.now() + SUSPENSION_CACHE_TTL });
  if (suspensionCache.size > 500) {
    const firstKey = suspensionCache.keys().next().value;
    suspensionCache.delete(firstKey);
  }

  return isSuspended;
}

/**
 * Express middleware: verifies Firebase ID token from Authorization header.
 * Sets req.auth = { uid, token } on success.
 */
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const idToken = authHeader.slice(7);

  try {
    const decoded = await auth.verifyIdToken(idToken);
    const uid = decoded.uid;

    const isSuspended = await checkSuspension(uid);

    if (isSuspended) {
      const isSuspensionExempt = req.path === '/appeals'
        || req.path.startsWith('/users/me');
      if (!isSuspensionExempt) {
        return res.status(403).json({ error: 'Account suspended' });
      }
    }

    req.auth = { uid, token: decoded };
    next();
  } catch (err) {
    console.error('Auth error:', err.message);
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

/**
 * Optional auth: same as authMiddleware but doesn't fail on missing token.
 */
async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.auth = null;
    return next();
  }
  return authMiddleware(req, res, next);
}

/**
 * Admin guard — call at the top of admin route handlers.
 * Returns true if blocked (response already sent), false if admin.
 */
function requireAdmin(req, res) {
  if (!req.auth || !req.auth.token.admin) {
    res.status(403).json({ error: 'Admin access required' });
    return true;
  }
  return false;
}

module.exports = { authMiddleware, optionalAuth, requireAdmin };
