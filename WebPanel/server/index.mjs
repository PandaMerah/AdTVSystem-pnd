import express from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { put } from '@vercel/blob';
import {
  ensureDb,
  USE_FIREBASE,
  UPLOADS_DIR,
  APK_DIR,
  listMedia,
  getMedia,
  createMedia,
  deleteMedia,
  listPlaylists,
  getPlaylistWithItems,
  createPlaylist,
  updatePlaylist,
  replacePlaylistItems,
  deletePlaylist,
  listDevices,
  getDevice,
  createDevice,
  updateDevice,
  deleteDevice,
  upsertDeviceHeartbeat,
  setDeviceCommandTimestamp,
  getPlayerConfigForDevice,
  getPlayerRevision,
  listApkReleases,
  getLatestApkRelease,
  getApkRelease,
  createApkRelease,
  deleteApkRelease,
} from './db.mjs';
import { verifyCredentials, issueToken, requireAuth } from './auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT || 3001);
const USE_BLOB = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

export const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

if (!USE_BLOB) {
  app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));
}

app.get('/api/health', async (_req, res) => {
  try {
    await ensureDb();
    res.json({ ok: true, backend: USE_FIREBASE ? 'firebase-firestore' : 'sqlite', vercel: Boolean(process.env.VERCEL) });
  } catch (err) {
    res.status(500).json({
      ok: false,
      backend: USE_FIREBASE ? 'firebase-firestore' : 'sqlite',
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.use('/api', async (_req, _res, next) => {
  try {
    await ensureDb();
    next();
  } catch (err) {
    next(err);
  }
});

// SSE clients map: deviceId -> Set<res> (for persistent Node/Docker/Nginx deployments)
const sseClients = new Map();

function broadcastSSE(event, data, targetDeviceId = null) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  if (targetDeviceId) {
    const clients = sseClients.get(targetDeviceId);
    if (clients) {
      for (const res of clients) res.write(payload);
    }
    return;
  }
  for (const clients of sseClients.values()) {
    for (const res of clients) res.write(payload);
  }
}

if (!process.env.VERCEL) {
  setInterval(() => {
    for (const clients of sseClients.values()) {
      for (const res of clients) res.write(': ping\n\n');
    }
  }, 25000);
}

const uploadStorage = USE_BLOB
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || '';
        cb(null, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`);
      },
    });

const apkStorage = USE_BLOB
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, APK_DIR),
      filename: (_req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}-${safeName}`);
      },
    });

const mediaUpload = multer({ storage: uploadStorage, limits: { fileSize: 500 * 1024 * 1024 } });
const apkUpload = multer({ storage: apkStorage, limits: { fileSize: 300 * 1024 * 1024 } });

// -------------------- AUTH --------------------
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!verifyCredentials(username, password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  return res.json({ token: issueToken(username), username });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ username: req.user.sub, backend: USE_FIREBASE ? 'firebase-firestore' : 'sqlite' });
});

// -------------------- SSE STREAM --------------------
app.get('/api/events', (req, res) => {
  const deviceId = String(req.query.deviceId || 'default-tv');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  if (!sseClients.has(deviceId)) {
    sseClients.set(deviceId, new Set());
  }
  sseClients.get(deviceId).add(res);
  res.write(`event: connected\ndata: ${JSON.stringify({ deviceId, ts: Date.now() })}\n\n`);

  req.on('close', () => {
    const set = sseClients.get(deviceId);
    if (set) {
      set.delete(res);
      if (set.size === 0) sseClients.delete(deviceId);
    }
  });
});

// -------------------- PUBLIC PLAYER APIs --------------------
app.get('/api/player/:deviceId', async (req, res) => {
  const config = await getPlayerConfigForDevice(req.params.deviceId);
  res.json(config);
});

app.get('/api/player/:deviceId/revision', async (req, res) => {
  const rev = await getPlayerRevision(req.params.deviceId);
  res.json(rev);
});

app.post('/api/devices/:deviceId/heartbeat', async (req, res) => {
  const { deviceId } = req.params;
  const {
    versionCode = 0,
    versionName = 'web',
    isDeviceOwner = false,
    resolution = '',
    currentSlide = '',
  } = req.body || {};
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket?.remoteAddress || '';

  const now = await upsertDeviceHeartbeat(deviceId, {
    versionCode,
    versionName,
    isDeviceOwner,
    ip,
    resolution,
    currentSlide,
  });

  res.json({ ok: true, serverTime: now });
});

// -------------------- PUBLIC APK OTA APIs --------------------
app.get('/api/apk/latest', async (req, res) => {
  const latest = await getLatestApkRelease();
  if (!latest) {
    return res.status(404).json({ error: 'No APK release published yet' });
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const baseUrl = `${proto}://${host}`;

  res.json({
    id: latest.id,
    versionCode: Number(latest.version_code),
    versionName: latest.version_name,
    filename: latest.filename,
    sizeBytes: Number(latest.size_bytes),
    sha256: latest.sha256,
    changelog: latest.changelog,
    mandatory: Boolean(latest.mandatory),
    downloadUrl: latest.download_url || `${baseUrl}/api/apk/download/${encodeURIComponent(latest.filename)}`,
    createdAt: Number(latest.created_at),
  });
});

app.get('/api/apk/download/:filename', (req, res) => {
  const safeFile = path.basename(req.params.filename);
  const fullPath = path.join(APK_DIR, safeFile);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'APK file not found on local disk' });
  }
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFile}"`);
  fs.createReadStream(fullPath).pipe(res);
});

// -------------------- ADMIN: MEDIA --------------------
app.get('/api/admin/media', requireAuth, async (_req, res) => {
  res.json(await listMedia());
});

app.post('/api/admin/media/upload', requireAuth, mediaUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const mime = req.file.mimetype || '';
  const type = mime.startsWith('video/') ? 'video' : 'image';
  const id = `media-${crypto.randomUUID().slice(0, 8)}`;
  const title = (req.body?.title || req.file.originalname).trim();
  const now = Date.now();

  let url = '';
  let storedFilename = null;

  if (USE_BLOB) {
    const ext = path.extname(req.file.originalname) || '';
    const blob = await put(`media/${id}${ext}`, req.file.buffer, { access: 'public', contentType: mime });
    url = blob.url;
  } else {
    storedFilename = req.file.filename;
    url = `/uploads/${req.file.filename}`;
  }

  const created = await createMedia({
    id,
    title,
    type,
    url,
    filename: storedFilename,
    mime_type: mime,
    size_bytes: req.file.size,
    created_at: now,
  });

  res.status(201).json(created);
});

app.post('/api/admin/media/url', requireAuth, async (req, res) => {
  const { title, url, type = 'web' } = req.body || {};
  if (!title || !url) return res.status(400).json({ error: 'title and url are required' });
  if (!['image', 'video', 'web'].includes(type)) {
    return res.status(400).json({ error: 'Invalid media type' });
  }
  const id = `media-${crypto.randomUUID().slice(0, 8)}`;
  const created = await createMedia({
    id,
    title: title.trim(),
    type,
    url: url.trim(),
    filename: null,
    mime_type: null,
    size_bytes: 0,
    created_at: Date.now(),
  });
  res.status(201).json(created);
});

app.delete('/api/admin/media/:id', requireAuth, async (req, res) => {
  const media = await getMedia(req.params.id);
  if (!media) return res.status(404).json({ error: 'Media not found' });

  await deleteMedia(req.params.id);

  if (media.filename && !USE_BLOB) {
    const filePath = path.join(UPLOADS_DIR, media.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  broadcastSSE('config-updated', { reason: 'media-deleted', ts: Date.now() });
  res.json({ ok: true });
});

// -------------------- ADMIN: PLAYLISTS --------------------
app.get('/api/admin/playlists', requireAuth, async (_req, res) => {
  res.json(await listPlaylists());
});

app.post('/api/admin/playlists', requireAuth, async (req, res) => {
  const {
    name = 'New Playlist',
    layout = 'fullscreen',
    ticker_text = '',
    ticker_speed = 35,
    bg_color = '#09090b',
    accent_color = '#6366f1',
    show_clock = 1,
    show_branding = 1,
    branding_title = 'AdTV Signage',
    sidebar_title = 'Info Panel',
    sidebar_body = '',
  } = req.body || {};

  const created = await createPlaylist({
    id: `pl-${crypto.randomUUID().slice(0, 8)}`,
    name,
    layout,
    ticker_text,
    ticker_speed,
    bg_color,
    accent_color,
    show_clock: show_clock ? 1 : 0,
    show_branding: show_branding ? 1 : 0,
    branding_title,
    sidebar_title,
    sidebar_body,
    revision: crypto.randomUUID().slice(0, 8),
    updated_at: Date.now(),
  });

  res.status(201).json(created);
});

app.put('/api/admin/playlists/:id', requireAuth, async (req, res) => {
  const updated = await updatePlaylist(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Playlist not found' });
  broadcastSSE('config-updated', { playlistId: req.params.id, revision: updated.revision, ts: Date.now() });
  res.json(updated);
});

app.put('/api/admin/playlists/:id/items', requireAuth, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const updated = await replacePlaylistItems(req.params.id, items);
  if (!updated) return res.status(404).json({ error: 'Playlist not found' });
  broadcastSSE('config-updated', { playlistId: req.params.id, revision: updated.revision, ts: Date.now() });
  res.json(updated);
});

app.delete('/api/admin/playlists/:id', requireAuth, async (req, res) => {
  await deletePlaylist(req.params.id);
  broadcastSSE('config-updated', { reason: 'playlist-deleted', ts: Date.now() });
  res.json({ ok: true });
});

// -------------------- ADMIN: DEVICES --------------------
app.get('/api/admin/devices', requireAuth, async (_req, res) => {
  const rows = await listDevices();
  const now = Date.now();
  const enriched = rows.map((d) => ({
    ...d,
    last_seen: Number(d.last_seen || 0),
    online: Number(d.last_seen || 0) > 0 && now - Number(d.last_seen) < 65000,
    sseConnected: Boolean(sseClients.get(d.id)?.size),
  }));
  res.json(enriched);
});

app.post('/api/admin/devices', requireAuth, async (req, res) => {
  const { id, name, location = '', playlist_id = null } = req.body || {};
  const deviceId = (id || `tv-${crypto.randomUUID().slice(0, 6)}`).trim();
  const created = await createDevice({
    id: deviceId,
    name: (name || deviceId).trim(),
    location: location.trim(),
    playlist_id,
    version_code: 0,
    version_name: 'unknown',
    is_device_owner: 0,
    ip_address: '',
    resolution: '',
    current_slide: '',
    last_seen: 0,
    reload_at: 0,
    apk_check_at: 0,
  });
  res.status(201).json(created);
});

app.put('/api/admin/devices/:id', requireAuth, async (req, res) => {
  const updated = await updateDevice(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Device not found' });
  broadcastSSE('config-updated', { deviceId: req.params.id, ts: Date.now() }, req.params.id);
  res.json(updated);
});

app.delete('/api/admin/devices/:id', requireAuth, async (req, res) => {
  await deleteDevice(req.params.id);
  res.json({ ok: true });
});

app.post('/api/admin/devices/:id/command', requireAuth, async (req, res) => {
  const { command = 'reload' } = req.body || {};
  const target = req.params.id === 'all' ? null : req.params.id;
  const now = Date.now();

  if (command === 'reload') {
    await setDeviceCommandTimestamp(target, 'reload_at', now);
    broadcastSSE('reload', { ts: now }, target);
  } else if (command === 'apk-update') {
    await setDeviceCommandTimestamp(target, 'apk_check_at', now);
    broadcastSSE('apk-update', { ts: now }, target);
  } else {
    return res.status(400).json({ error: 'Unknown command' });
  }
  res.json({ ok: true, command, target: req.params.id });
});

// -------------------- ADMIN: APK RELEASES --------------------
app.get('/api/admin/apk', requireAuth, async (_req, res) => {
  res.json(await listApkReleases());
});

app.post('/api/admin/apk/upload', requireAuth, apkUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No APK file uploaded' });
  const versionCode = Number(req.body?.versionCode);
  const versionName = String(req.body?.versionName || '').trim();
  const changelog = String(req.body?.changelog || '').trim();
  const mandatory = req.body?.mandatory === 'true' || req.body?.mandatory === true ? 1 : 0;

  if (!Number.isInteger(versionCode) || versionCode < 1 || !versionName) {
    if (!USE_BLOB && req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Valid integer versionCode and versionName are required' });
  }

  const fileBuf = USE_BLOB ? req.file.buffer : fs.readFileSync(req.file.path);
  const sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');
  const id = `apk-${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();

  let downloadUrl = null;
  const storedFilename = req.file.filename || req.file.originalname;

  if (USE_BLOB) {
    const blob = await put(`apks/${Date.now()}-${req.file.originalname}`, fileBuf, {
      access: 'public',
      contentType: 'application/vnd.android.package-archive',
    });
    downloadUrl = blob.url;
  }

  try {
    const created = await createApkRelease({
      id,
      version_code: versionCode,
      version_name: versionName,
      filename: storedFilename,
      download_url: downloadUrl,
      size_bytes: req.file.size,
      sha256,
      changelog,
      mandatory,
      created_at: now,
    });

    if (mandatory) {
      await setDeviceCommandTimestamp(null, 'apk_check_at', now);
      broadcastSSE('apk-update', { versionCode, versionName, ts: now });
    }

    res.status(201).json(created);
  } catch (err) {
    if (!USE_BLOB && req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(409).json({ error: `Release error (duplicate versionCode?): ${err.message}` });
  }
});

app.post('/api/admin/apk/url', requireAuth, async (req, res) => {
  const versionCode = Number(req.body?.versionCode);
  const versionName = String(req.body?.versionName || '').trim();
  const downloadUrl = String(req.body?.downloadUrl || '').trim();
  const sha256 = String(req.body?.sha256 || '').trim().toLowerCase();
  const changelog = String(req.body?.changelog || '').trim();
  const mandatory = req.body?.mandatory ? 1 : 0;

  if (!Number.isInteger(versionCode) || versionCode < 1 || !versionName || !downloadUrl) {
    return res.status(400).json({ error: 'versionCode, versionName, and downloadUrl are required' });
  }

  const id = `apk-${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();
  const filename = path.basename(downloadUrl.split('?')[0]) || `adtv-kiosk-${versionName}.apk`;

  try {
    const created = await createApkRelease({
      id,
      version_code: versionCode,
      version_name: versionName,
      filename,
      download_url: downloadUrl,
      size_bytes: 0,
      sha256,
      changelog,
      mandatory,
      created_at: now,
    });

    if (mandatory) {
      await setDeviceCommandTimestamp(null, 'apk_check_at', now);
      broadcastSSE('apk-update', { versionCode, versionName, ts: now });
    }

    res.status(201).json(created);
  } catch (err) {
    return res.status(409).json({ error: `Release error (duplicate versionCode?): ${err.message}` });
  }
});

app.delete('/api/admin/apk/:id', requireAuth, async (req, res) => {
  const row = await getApkRelease(req.params.id);
  if (!row) return res.status(404).json({ error: 'APK release not found' });
  await deleteApkRelease(req.params.id);
  if (!row.download_url && !USE_BLOB) {
    const fullPath = path.join(APK_DIR, row.filename);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  }
  res.json({ ok: true });
});

// -------------------- ERROR HANDLER --------------------
app.use((err, _req, res, _next) => {
  console.error('API Error:', err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Internal Server Error' });
});

// -------------------- FRONTEND SPA (Local / Docker) --------------------
if (!process.env.VERCEL && fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`AdTV WebPanel server running on http://localhost:${PORT} (DB: ${USE_FIREBASE ? 'Firebase Firestore' : 'SQLite'})`);
  });
}

export default app;
