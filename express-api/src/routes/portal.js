const router = require('express').Router();
const { authMiddlewareStrict } = require('../middleware/auth');

// All portal routes use authMiddlewareStrict except totp-recovery (unauthenticated)
// Individual endpoints will be added in subsequent tasks

// Stub for now — returns 501
router.get('/portal/me', authMiddlewareStrict, (req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

module.exports = router;
