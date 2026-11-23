import express from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  db,
  UPLOADS_DIR,
  APK_DIR,
  bumpPlaylistRevision,
  getPlaylistWithItems,
  getPlayerConfigForDevice,
} from './db.mjs';
import { verifyCredentials, issueToken, requireAuth } from './auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT || 3001);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Static media uploads
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

// SSE clients map: deviceId -> Set<res>
const sseClients = new Map();

function broadcastSSE(event, data, targetDeviceId = null) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  if (targetDeviceId) {
    const clients = sseClients.get(targetDeviceId);
    if (clients) {
      for (const res of clients) {
        res.write(payload);
      }
    }
    return;
  }
  for (const clients of sseClients.values()) {
    for (const res of clients) {
      res.write(payload);
    }
  }
}

// Keep SSE alive behind Nginx/proxies
setInterval(() => {
  for (const clients of sseClients.values()) {
    for (const res of clients) {
      res.write(': ping\n\n');
    }
  }
}, 25000);

// Multer storage for media
const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '';
      cb(null, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

// Multer storage for APK releases
const apkUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, APK_DIR),
    filename: (_req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${safeName}`);
    },
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
});

// -------------------- AUTH --------------------
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!verifyCredentials(username, password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  return res.json({ token: issueToken(username), username });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ username: req.user.sub });
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
app.get('/api/player/:deviceId', (req, res) => {
  const config = getPlayerConfigForDevice(req.params.deviceId);
  res.json(config);
});

app.post('/api/devices/:deviceId/heartbeat', (req, res) => {
  const { deviceId } = req.params;
  const { versionCode = 0, versionName = 'web', isDeviceOwner = false, resolution = '', currentSlide = '' } = req.body || {};
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || '';
  const now = Date.now();

  const existing = db.prepare('SELECT id FROM devices WHERE id = ?').get(deviceId);
  if (!existing) {
    const fallback = db.prepare('SELECT id FROM playlists ORDER BY updated_at DESC LIMIT 1').get();
    db.prepare(
      `INSERT INTO devices (id, name, location, playlist_id, version_code, version_name, is_device_owner, ip_address, resolution, current_slide, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(deviceId, deviceId, 'Auto-Registered', fallback?.id || null, versionCode, versionName, isDeviceOwner ? 1 : 0, ip, resolution, currentSlide, now);
  } else {
    db.prepare(
      `UPDATE devices SET version_code = ?, version_name = ?, is_device_owner = ?, ip_address = ?, resolution = ?, current_slide = ?, last_seen = ?
       WHERE id = ?`
    ).run(versionCode, versionName, isDeviceOwner ? 1 : 0, ip, resolution, currentSlide, now, deviceId);
  }

  res.json({ ok: true, serverTime: now });
});

// -------------------- PUBLIC APK OTA APIs --------------------
app.get('/api/apk/latest', (req, res) => {
  const latest = db.prepare('SELECT * FROM apk_releases ORDER BY version_code DESC LIMIT 1').get();
  if (!latest) {
    return res.status(404).json({ error: 'No APK release published yet' });
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const baseUrl = `${proto}://${host}`;

  res.json({
    id: latest.id,
    versionCode: latest.version_code,
    versionName: latest.version_name,
    filename: latest.filename,
    sizeBytes: latest.size_bytes,
    sha256: latest.sha256,
    changelog: latest.changelog,
    mandatory: Boolean(latest.mandatory),
    downloadUrl: `${baseUrl}/api/apk/download/${encodeURIComponent(latest.filename)}`,
    createdAt: latest.created_at,
  });
});

app.get('/api/apk/download/:filename', (req, res) => {
  const safeFile = path.basename(req.params.filename);
  const fullPath = path.join(APK_DIR, safeFile);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'APK file not found' });
  }
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFile}"`);
  fs.createReadStream(fullPath).pipe(res);
});

// -------------------- ADMIN: MEDIA --------------------
app.get('/api/admin/media', requireAuth, (_req, res) => {
  const rows = db.prepare('SELECT * FROM media ORDER BY created_at DESC').all();
  res.json(rows);
});

app.post('/api/admin/media/upload', requireAuth, mediaUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const mime = req.file.mimetype || '';
  const type = mime.startsWith('video/') ? 'video' : 'image';
  const id = `media-${crypto.randomUUID().slice(0, 8)}`;
  const title = (req.body?.title || req.file.originalname).trim();
  const url = `/uploads/${req.file.filename}`;
  const now = Date.now();

  db.prepare(
    'INSERT INTO media (id, title, type, url, filename, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, title, type, url, req.file.filename, mime, req.file.size, now);

  const created = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
  res.status(201).json(created);
});

app.post('/api/admin/media/url', requireAuth, (req, res) => {
  const { title, url, type = 'web' } = req.body || {};
  if (!title || !url) return res.status(400).json({ error: 'title and url are required' });
  if (!['image', 'video', 'web'].includes(type)) {
    return res.status(400).json({ error: 'Invalid media type' });
  }
  const id = `media-${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();
  db.prepare(
    'INSERT INTO media (id, title, type, url, filename, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, NULL, NULL, 0, ?)'
  ).run(id, title.trim(), type, url.trim(), now);
  res.status(201).json(db.prepare('SELECT * FROM media WHERE id = ?').get(id));
});

app.delete('/api/admin/media/:id', requireAuth, (req, res) => {
  const media = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!media) return res.status(404).json({ error: 'Media not found' });

  const affectedPlaylists = db
    .prepare('SELECT DISTINCT playlist_id FROM playlist_items WHERE media_id = ?')
    .all(req.params.id);

  db.prepare('DELETE FROM media WHERE id = ?').run(req.params.id);

  if (media.filename) {
    const filePath = path.join(UPLOADS_DIR, media.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  for (const row of affectedPlaylists) {
    bumpPlaylistRevision(row.playlist_id);
  }
  broadcastSSE('config-updated', { reason: 'media-deleted', ts: Date.now() });
  res.json({ ok: true });
});

// -------------------- ADMIN: PLAYLISTS --------------------
app.get('/api/admin/playlists', requireAuth, (_req, res) => {
  const playlists = db.prepare('SELECT * FROM playlists ORDER BY updated_at DESC').all();
  const result = playlists.map((p) => getPlaylistWithItems(p.id));
  res.json(result);
});

app.post('/api/admin/playlists', requireAuth, (req, res) => {
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

  const id = `pl-${crypto.randomUUID().slice(0, 8)}`;
  const rev = crypto.randomUUID().slice(0, 8);
  const now = Date.now();

  db.prepare(
    `INSERT INTO playlists (id, name, layout, ticker_text, ticker_speed, bg_color, accent_color, show_clock, show_branding, branding_title, sidebar_title, sidebar_body, revision, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    name,
    layout,
    ticker_text,
    ticker_speed,
    bg_color,
    accent_color,
    show_clock ? 1 : 0,
    show_branding ? 1 : 0,
    branding_title,
    sidebar_title,
    sidebar_body,
    rev,
    now
  );

  res.status(201).json(getPlaylistWithItems(id));
});

app.put('/api/admin/playlists/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Playlist not found' });

  const b = req.body || {};
  const rev = crypto.randomUUID().slice(0, 8);
  const now = Date.now();

  db.prepare(
    `UPDATE playlists SET
      name = ?, layout = ?, ticker_text = ?, ticker_speed = ?,
      bg_color = ?, accent_color = ?, show_clock = ?, show_branding = ?,
      branding_title = ?, sidebar_title = ?, sidebar_body = ?,
      revision = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    b.name ?? existing.name,
    b.layout ?? existing.layout,
    b.ticker_text ?? existing.ticker_text,
    Number(b.ticker_speed ?? existing.ticker_speed),
    b.bg_color ?? existing.bg_color,
    b.accent_color ?? existing.accent_color,
    b.show_clock !== undefined ? (b.show_clock ? 1 : 0) : existing.show_clock,
    b.show_branding !== undefined ? (b.show_branding ? 1 : 0) : existing.show_branding,
    b.branding_title ?? existing.branding_title,
    b.sidebar_title ?? existing.sidebar_title,
    b.sidebar_body ?? existing.sidebar_body,
    rev,
    now,
    req.params.id
  );

  const updated = getPlaylistWithItems(req.params.id);
  broadcastSSE('config-updated', { playlistId: req.params.id, revision: rev, ts: now });
  res.json(updated);
});

app.put('/api/admin/playlists/:id/items', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT id FROM playlists WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Playlist not found' });

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(req.params.id);
    const ins = db.prepare(
      'INSERT INTO playlist_items (id, playlist_id, media_id, sort_order, duration_sec, transition, muted) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    items.forEach((item, idx) => {
      ins.run(
        item.id || `item-${crypto.randomUUID().slice(0, 8)}`,
        req.params.id,
        item.media_id,
        idx,
        Math.max(2, Number(item.duration_sec || 10)),
        ['fade', 'slide', 'zoom', 'none'].includes(item.transition) ? item.transition : 'fade',
        item.muted === false || item.muted === 0 ? 0 : 1
      );
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(400).json({ error: err.message });
  }

  const rev = bumpPlaylistRevision(req.params.id);
  const updated = getPlaylistWithItems(req.params.id);
  broadcastSSE('config-updated', { playlistId: req.params.id, revision: rev, ts: Date.now() });
  res.json(updated);
});

app.delete('/api/admin/playlists/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM playlists WHERE id = ?').run(req.params.id);
  broadcastSSE('config-updated', { reason: 'playlist-deleted', ts: Date.now() });
  res.json({ ok: true });
});

// -------------------- ADMIN: DEVICES --------------------
app.get('/api/admin/devices', requireAuth, (_req, res) => {
  const rows = db.prepare('SELECT * FROM devices ORDER BY last_seen DESC, name ASC').all();
  const now = Date.now();
  const enriched = rows.map((d) => ({
    ...d,
    online: d.last_seen > 0 && now - d.last_seen < 65000,
    sseConnected: Boolean(sseClients.get(d.id)?.size),
  }));
  res.json(enriched);
});

app.post('/api/admin/devices', requireAuth, (req, res) => {
  const { id, name, location = '', playlist_id = null } = req.body || {};
  const deviceId = (id || `tv-${crypto.randomUUID().slice(0, 6)}`).trim();
  db.prepare(
    'INSERT INTO devices (id, name, location, playlist_id) VALUES (?, ?, ?, ?)'
  ).run(deviceId, (name || deviceId).trim(), location.trim(), playlist_id);
  res.status(201).json(db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId));
});

app.put('/api/admin/devices/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Device not found' });
  const { name, location, playlist_id } = req.body || {};
  db.prepare('UPDATE devices SET name = ?, location = ?, playlist_id = ? WHERE id = ?').run(
    name ?? existing.name,
    location ?? existing.location,
    playlist_id !== undefined ? playlist_id : existing.playlist_id,
    req.params.id
  );
  broadcastSSE('config-updated', { deviceId: req.params.id, ts: Date.now() }, req.params.id);
  res.json(db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id));
});

app.delete('/api/admin/devices/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/admin/devices/:id/command', requireAuth, (req, res) => {
  const { command = 'reload' } = req.body || {};
  const target = req.params.id === 'all' ? null : req.params.id;
  if (command === 'reload') {
    broadcastSSE('reload', { ts: Date.now() }, target);
  } else if (command === 'apk-update') {
    broadcastSSE('apk-update', { ts: Date.now() }, target);
  } else {
    return res.status(400).json({ error: 'Unknown command' });
  }
  res.json({ ok: true, command, target: req.params.id });
});

// -------------------- ADMIN: APK RELEASES --------------------
app.get('/api/admin/apk', requireAuth, (_req, res) => {
  const rows = db.prepare('SELECT * FROM apk_releases ORDER BY version_code DESC').all();
  res.json(rows);
});

app.post('/api/admin/apk/upload', requireAuth, apkUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No APK file uploaded' });
  const versionCode = Number(req.body?.versionCode);
  const versionName = String(req.body?.versionName || '').trim();
  const changelog = String(req.body?.changelog || '').trim();
  const mandatory = req.body?.mandatory === 'true' || req.body?.mandatory === true ? 1 : 0;

  if (!Number.isInteger(versionCode) || versionCode < 1 || !versionName) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Valid integer versionCode and versionName are required' });
  }

  const fileBuf = fs.readFileSync(req.file.path);
  const sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');
  const id = `apk-${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();

  try {
    db.prepare(
      `INSERT INTO apk_releases (id, version_code, version_name, filename, size_bytes, sha256, changelog, mandatory, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, versionCode, versionName, req.file.filename, req.file.size, sha256, changelog, mandatory, now);
  } catch (err) {
    fs.unlinkSync(req.file.path);
    return res.status(409).json({ error: `Release error (duplicate versionCode?): ${err.message}` });
  }

  if (mandatory) {
    broadcastSSE('apk-update', { versionCode, versionName, ts: now });
  }

  res.status(201).json(db.prepare('SELECT * FROM apk_releases WHERE id = ?').get(id));
});

app.delete('/api/admin/apk/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM apk_releases WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'APK release not found' });
  db.prepare('DELETE FROM apk_releases WHERE id = ?').run(req.params.id);
  const fullPath = path.join(APK_DIR, row.filename);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  res.json({ ok: true });
});

// -------------------- FRONTEND SPA --------------------
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`AdTV WebPanel server running on http://localhost:${PORT}`);
});
