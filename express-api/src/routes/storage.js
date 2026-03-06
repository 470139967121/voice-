/**
 * Storage routes — upload and delete files via R2.
 *
 * Converted from the standalone Cloudflare Worker storage proxy (worker/index.js)
 * into an Express route with multer for multipart file uploads.
 *
 * POST   /api/storage/upload  → Upload a file to R2, return public URL
 * DELETE /api/storage/delete  → Delete a file from R2 (owner-only)
 */

const express = require('express');
const multer = require('multer');
const r2 = require('../utils/r2');
const { getExtension } = require('../utils/helpers');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/storage/upload
router.post('/storage/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const path = req.body.path;
    const uid = req.auth.uid;

    if (!file || !path) return res.status(400).json({ error: 'Missing file or path' });

    const contentType = file.mimetype || 'image/jpeg';
    const extension = getExtension(contentType);
    const key = `${path}/${uid}/${Date.now()}.${extension}`;

    const url = await r2.putObject(key, file.buffer, contentType);
    res.json({ url });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// DELETE /api/storage/delete
router.delete('/storage/delete', async (req, res) => {
  try {
    const key = req.query.key;
    const uid = req.auth.uid;

    if (!key) return res.status(400).json({ error: 'Missing key' });
    if (!key.includes(`/${uid}/`)) return res.status(403).json({ error: 'Forbidden' });

    await r2.deleteObject(key);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;
