/**
 * LiveKit token generation — replaces generateLiveKitToken Cloud Function.
 *
 * POST /api/livekit/token  -> Generate a LiveKit access token
 */

const router = require('express').Router();
const { AccessToken } = require('livekit-server-sdk');

router.post('/livekit/token', async (req, res) => {
  try {
    const { roomName, identity } = req.body || {};

    if (!roomName || !identity) {
      return res.status(400).json({ error: 'roomName and identity are required' });
    }

    const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity,
      ttl: '24h',
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();
    return res.json({ token });
  } catch (err) {
    console.error('Error generating LiveKit token:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
