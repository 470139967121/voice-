---
name: add-route
description: Scaffold a new Express API route with auth middleware, rate limiting, and test file
disable-model-invocation: true
---

# Scaffold Express API Route

Create a new Express route following ShyTalk API conventions.

## Arguments

The user provides:
- **Route name** — e.g., `achievements` (becomes `/api/achievements`)
- **Admin only** — whether route needs admin guard (default: no)
- **Description** — what the route does

## Steps

### 1. Create Route File

Create `express-api/src/routes/{name}.js` following the project pattern:

```javascript
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { logger } = require('../utils/loggerInstance');

// GET /api/{name}
router.get('/', verifyToken, async (req, res) => {
  try {
    // TODO: Implement
    res.json({ success: true });
  } catch (error) {
    logger.error(`GET /api/{name} failed`, { error: error.message, uid: req.uid });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
```

If admin-only, add: `const { requireAdmin } = require('../middleware/auth');` and use `if (requireAdmin(req, res)) return;` at the start of each handler.

### 2. Mount the Route

Add to `express-api/src/index.js`:
```javascript
app.use('/api/{name}', require('./routes/{name}'));
```

### 3. Create Test File

Create `express-api/tests/routes/{name}.test.js` with test stubs covering:
- Auth required (401 without token)
- Success case (200 with valid data)
- Error handling (500 on failure)
- Admin guard if applicable (403 for non-admin)

### 4. Run Tests

```bash
cd express-api && npm test -- --testPathPattern="{name}"
```

### 5. Verify

- Route file follows existing patterns (check other routes for reference)
- Rate limiting added if publicly accessible
- Structured logging with `logger.*`
- Input validation on all user-provided data
