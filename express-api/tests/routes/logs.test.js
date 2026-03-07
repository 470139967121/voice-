const express = require('express');
const request = require('supertest');
const { createLogsRouter } = require('../../src/routes/logs');

// Mock logger
const mockLogger = {
  log: jest.fn().mockResolvedValue(undefined),
  getDailyStats: jest.fn(() => ({ count: 100, hardCap: 15000 })),
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.auth = { uid: 'user1' };
    req.requestTraceId = 'trace-123';
    next();
  });
  app.use('/api', createLogsRouter(mockLogger));
  return app;
}

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = createApp();
});

describe('POST /api/logs', () => {
  test('accepts valid single log entry (202)', async () => {
    const res = await request(app)
      .post('/api/logs')
      .send({ level: 'INFO', source: 'app', message: 'Hello' });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 1 });
    expect(mockLogger.log).toHaveBeenCalledTimes(1);
  });

  test('accepts valid batch of log entries (202)', async () => {
    const batch = [
      { level: 'INFO', source: 'app', message: 'Entry 1' },
      { level: 'WARN', source: 'app', message: 'Entry 2' },
      { level: 'ERROR', source: 'app', message: 'Entry 3' },
    ];

    const res = await request(app)
      .post('/api/logs')
      .send({ batch });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 3 });
    expect(mockLogger.log).toHaveBeenCalledTimes(3);
  });

  test('rejects invalid level (400)', async () => {
    const res = await request(app)
      .post('/api/logs')
      .send({ level: 'TRACE', source: 'app', message: 'Hello' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid level/);
    expect(mockLogger.log).not.toHaveBeenCalled();
  });

  test('rejects missing source (400)', async () => {
    const res = await request(app)
      .post('/api/logs')
      .send({ level: 'INFO', message: 'Hello' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/source/);
    expect(mockLogger.log).not.toHaveBeenCalled();
  });

  test('rejects missing message (400)', async () => {
    const res = await request(app)
      .post('/api/logs')
      .send({ level: 'INFO', source: 'app' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message/);
    expect(mockLogger.log).not.toHaveBeenCalled();
  });

  test('rejects oversized batch >50 (400)', async () => {
    const batch = Array.from({ length: 51 }, (_, i) => ({
      level: 'INFO',
      source: 'app',
      message: `Entry ${i}`,
    }));

    const res = await request(app)
      .post('/api/logs')
      .send({ batch });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds maximum/);
    expect(mockLogger.log).not.toHaveBeenCalled();
  });

  test('enriches with userId from req.auth', async () => {
    await request(app)
      .post('/api/logs')
      .send({ level: 'INFO', source: 'app', message: 'Hello' });

    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user1',
        traceId: 'trace-123',
        level: 'INFO',
        source: 'app',
        message: 'Hello',
      })
    );
  });
});

describe('GET /api/logs/stats', () => {
  test('returns quota stats from getDailyStats', async () => {
    const res = await request(app).get('/api/logs/stats');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 100, hardCap: 15000 });
    expect(mockLogger.getDailyStats).toHaveBeenCalledTimes(1);
  });
});
