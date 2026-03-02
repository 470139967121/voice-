/**
 * Firebase Realtime Database REST API utility.
 *
 * Uses the shared OAuth2 token from fcm.js (which now includes the
 * firebase.database scope) to read/write RTDB via its REST API.
 *
 * RTDB URL pattern:
 *   https://{projectId}-default-rtdb.firebaseio.com/{path}.json
 */

const { getAccessToken } = require('./fcm');

/**
 * Write (PUT) data to an RTDB path. Overwrites the node.
 *
 * @param {object} env - Worker env bindings
 * @param {string} path - RTDB path (e.g. "rooms/abc123/events/lastEvent")
 * @param {object} data - JSON-serializable data to write
 */
async function writeRtdb(env, path, data) {
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    console.error('FIREBASE_PROJECT_ID not configured — skipping RTDB write');
    return;
  }

  const accessToken = await getAccessToken(env);
  const url = `https://${projectId}-default-rtdb.firebaseio.com/${path}.json`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`RTDB write failed at ${path}: ${response.status} ${text}`);
  }
}

/**
 * Delete an RTDB node.
 *
 * @param {object} env - Worker env bindings
 * @param {string} path - RTDB path to delete
 */
async function deleteRtdb(env, path) {
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    console.error('FIREBASE_PROJECT_ID not configured — skipping RTDB delete');
    return;
  }

  const accessToken = await getAccessToken(env);
  const url = `https://${projectId}-default-rtdb.firebaseio.com/${path}.json`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`RTDB delete failed at ${path}: ${response.status} ${text}`);
  }
}

module.exports = { writeRtdb, deleteRtdb };
