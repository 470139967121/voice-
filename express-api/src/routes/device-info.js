/**
 * Device info endpoint — accepts device info from mobile clients,
 * enriches with IP geolocation, stores in Firestore, checks bans.
 *
 * POST /api/device-info  → Submit device info
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const { now } = require('../utils/helpers');

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Check whether an IPv4 address falls within a CIDR range.
 */
function isIpInSubnet(ip, cidr) {
  try {
    const [subnet, bits] = cidr.split('/');
    const mask = ~(2 ** (32 - parseInt(bits)) - 1);
    const ipNum = ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct), 0);
    const subNum = subnet.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct), 0);
    return (ipNum & mask) === (subNum & mask);
  } catch { return false; }
}

/**
 * Fetch IP geolocation data from ip-api.com.
 * Returns { isp, asn, country, region } or empty object on failure.
 */
async function getIpGeo(ip) {
  try {
    const resp = await fetch(`http://ip-api.com/json/${ip}?fields=isp,as,country,regionName`);
    if (!resp.ok) return {};
    const data = await resp.json();
    return {
      isp: data.isp || null,
      asn: data.as ? data.as.split(' ')[0] : null,
      country: data.country || null,
      region: data.regionName || null,
    };
  } catch {
    return {};
  }
}

// ─── Route ───────────────────────────────────────────────────────

router.post('/device-info', async (req, res) => {
  try {
    const body = req.body;
    if (!body || !body.deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    const { deviceId } = body;

    // Extract client IP
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0].trim() : req.ip;

    // Enrich with IP geolocation
    const geo = await getIpGeo(ip);

    // Build device doc
    const timestamp = now();
    const deviceDoc = {
      deviceId,
      userId: req.auth.uid,
      manufacturer: body.manufacturer || null,
      model: body.model || null,
      osVersion: body.osVersion || null,
      screenResolution: body.screenResolution || null,
      screenDensity: body.screenDensity || null,
      totalRamMb: body.totalRamMb || null,
      appVersion: body.appVersion || null,
      buildNumber: body.buildNumber || null,
      locale: body.locale || null,
      networkType: body.networkType || null,
      carrierName: body.carrierName || null,
      firebaseInstallationId: body.firebaseInstallationId || null,
      lastIp: ip,
      isp: geo.isp || null,
      asn: geo.asn || null,
      country: geo.country || null,
      region: geo.region || null,
      lastSeen: timestamp,
    };

    // Check if doc already exists to set firstSeen/boundAt
    const docRef = db.doc(`deviceBindings/${deviceId}`);
    const existing = await docRef.get();
    if (!existing.exists) {
      deviceDoc.firstSeen = timestamp;
      deviceDoc.boundAt = timestamp;
    }

    // Write to Firestore
    await docRef.set(deviceDoc, { merge: true });

    // Check bans
    const banStatus = await checkBans(deviceId, ip, geo.asn);

    res.json({ success: true, banStatus });
  } catch (err) {
    console.error('POST /api/device-info error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Check device bans and network bans.
 * Returns { isBanned, banType, reason, expiresAt }.
 */
async function checkBans(deviceId, ip, asn) {
  const noBan = { isBanned: false, banType: null, reason: null, expiresAt: null };

  try {
    // Check device ban
    const deviceBanSnap = await db.doc(`deviceBans/${deviceId}`).get();
    if (deviceBanSnap.exists) {
      const ban = deviceBanSnap.data();
      if (!ban.expiresAt || ban.expiresAt > Date.now()) {
        return {
          isBanned: true,
          banType: 'device',
          reason: ban.reason || null,
          expiresAt: ban.expiresAt || null,
        };
      }
    }

    // Check network bans
    const networkBansSnap = await db.collection('networkBans').get();
    if (!networkBansSnap.empty) {
      for (const doc of networkBansSnap.docs) {
        const ban = doc.data();

        // Skip expired bans
        if (ban.expiresAt && ban.expiresAt <= Date.now()) continue;

        let matches = false;
        if (ban.type === 'ip' && ban.value === ip) {
          matches = true;
        } else if (ban.type === 'subnet' && isIpInSubnet(ip, ban.value)) {
          matches = true;
        } else if (ban.type === 'asn' && ban.value === asn) {
          matches = true;
        }

        if (matches) {
          return {
            isBanned: true,
            banType: `network_${ban.type}`,
            reason: ban.reason || null,
            expiresAt: ban.expiresAt || null,
          };
        }
      }
    }

    return noBan;
  } catch (err) {
    console.error('Ban check error:', err);
    return noBan;
  }
}

module.exports = router;
