const router = require('express').Router();

const VALID_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
const MAX_BATCH_SIZE = 50;

function createLogsRouter(logger) {
  // POST /logs — Accept log entries from clients
  router.post('/logs', async (req, res) => {
    try {
      const { batch } = req.body;
      let entries;

      if (Array.isArray(batch)) {
        if (batch.length > MAX_BATCH_SIZE) {
          return res.status(400).json({
            error: `Batch size ${batch.length} exceeds maximum of ${MAX_BATCH_SIZE}`,
          });
        }
        entries = batch;
      } else {
        // Single entry — the body itself is the entry
        entries = [req.body];
      }

      // Validate all entries
      for (const entry of entries) {
        if (!entry.level || !VALID_LEVELS.includes(entry.level)) {
          return res.status(400).json({
            error: `Invalid level: ${entry.level}. Must be one of: ${VALID_LEVELS.join(', ')}`,
          });
        }
        if (!entry.source) {
          return res.status(400).json({ error: 'Missing required field: source' });
        }
        if (!entry.message) {
          return res.status(400).json({ error: 'Missing required field: message' });
        }
      }

      // Enrich and log each entry
      const userId = req.auth?.uid || null;
      const traceId = req.requestTraceId || null;

      for (const entry of entries) {
        await logger.log({
          ...entry,
          userId,
          traceId,
        });
      }

      res.status(202).json({ accepted: entries.length });
    } catch (err) {
      console.error('Error ingesting logs:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /logs/stats — Return quota stats
  router.get('/logs/stats', (req, res) => {
    const stats = logger.getDailyStats();
    res.json(stats);
  });

  return router;
}

module.exports = { createLogsRouter };
