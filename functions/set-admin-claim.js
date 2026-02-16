/**
 * One-time script to set the admin custom claim on a Firebase Auth user.
 *
 * Usage:
 *   1. Download a service account key JSON from Firebase Console
 *      (Project Settings > Service Accounts > Generate New Private Key)
 *   2. Set the env variable:
 *        export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
 *   3. Run:
 *        node set-admin-claim.js <UID>
 */

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const uid = process.argv[2];
if (!uid) {
  console.error("Usage: node set-admin-claim.js <UID>");
  process.exit(1);
}

initializeApp({ credential: applicationDefault() });

(async () => {
  try {
    await getAuth().setCustomUserClaims(uid, { admin: true });
    console.log(`Successfully set admin claim for UID: ${uid}`);

    // Verify
    const user = await getAuth().getUser(uid);
    console.log("Custom claims:", user.customClaims);
  } catch (err) {
    console.error("Error setting admin claim:", err);
    process.exit(1);
  }
})();
