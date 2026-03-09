const express = require('express');
const request = require('supertest');

// ─── LiveKit SDK mock ────────────────────────────────────────────

const mockToJwt = jest.fn().mockResolvedValue('mock-jwt-token');
const mockAddGrant = jest.fn();

jest.mock('livekit-server-sdk', () => ({
  AccessToken: jest.fn().mockImplementation(() => ({
    addGrant: mockAddGrant,
    toJwt: mockToJwt,
  })),
}));

const { AccessToken } = require('livekit-server-sdk');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.LIVEKIT_API_KEY = 'test-key';
  process.env.LIVEKIT_API_SECRET = 'test-secret';
});

// ─── App setup ───────────────────────────────────────────────────

const livekitRouter = require('../../src/routes/livekit');

function createApp(uid = 'user-A') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid };
    next();
  });
  app.use('/api', livekitRouter);
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('POST /api/livekit/token', () => {
  test('returns 400 when roomName is missing', async () => {
    const app = createApp();
    await request(app)
      .post('/api/livekit/token')
      .send({})
      .expect(400);
  });

  test('generates token with authenticated uid as identity', async () => {
    const app = createApp('real-user-123');
    const res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'test-room' })
      .expect(200);

    expect(res.body.token).toBe('mock-jwt-token');

    // Verify AccessToken was called with the authenticated user's identity
    expect(AccessToken).toHaveBeenCalledWith(
      'test-key',
      'test-secret',
      expect.objectContaining({ identity: 'real-user-123' })
    );
  });

  test('ignores identity from request body (prevents impersonation)', async () => {
    const app = createApp('real-user-123');
    const res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'test-room', identity: 'impersonated-user' })
      .expect(200);

    // Should use the authenticated user's uid, not the body identity
    expect(AccessToken).toHaveBeenCalledWith(
      'test-key',
      'test-secret',
      expect.objectContaining({ identity: 'real-user-123' })
    );
  });

  test('grants correct room permissions', async () => {
    const app = createApp();
    await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'my-room' })
      .expect(200);

    expect(mockAddGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        roomJoin: true,
        room: 'my-room',
        canPublish: true,
        canSubscribe: true,
      })
    );
  });
});
