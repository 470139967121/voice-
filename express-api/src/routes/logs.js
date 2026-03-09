/**
 * Client log ingestion routes — accepts structured log entries from mobile clients.
 *
 * POST /api/logs       → Submit one or a batch of log entries
 * GET  /api/logs/stats → Return daily quota statistics
 */

const log = require('../utils/log');

const VALID_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
const MAX_BATCH_SIZE = 50;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_SOURCE_LENGTH = 100;

function createLogsRouter(logger) {
  const router = require('express').Router();
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
        if (!entry.source || typeof entry.source !== 'string') {
          return res.status(400).json({ error: 'Missing required field: source' });
        }
        if (!entry.message || typeof entry.message !== 'string') {
          return res.status(400).json({ error: 'Missing required field: message' });
        }
        // Truncate oversized fields to prevent log bloat
        entry.source = entry.source.slice(0, MAX_SOURCE_LENGTH);
        entry.message = entry.message.slice(0, MAX_MESSAGE_LENGTH);
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
      log.error('logs', 'Error ingesting logs', { error: err.message });
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
