import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const APK_DIR = path.join(DATA_DIR, 'apks');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(APK_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, 'adtv.db');
export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('image', 'video', 'web')),
    url TEXT NOT NULL,
    filename TEXT,
    mime_type TEXT,
    size_bytes INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    layout TEXT NOT NULL DEFAULT 'lbar' CHECK(layout IN ('fullscreen', 'split', 'lbar')),
    ticker_text TEXT NOT NULL DEFAULT '',
    ticker_speed INTEGER NOT NULL DEFAULT 35,
    bg_color TEXT NOT NULL DEFAULT '#09090b',
    accent_color TEXT NOT NULL DEFAULT '#6366f1',
    show_clock INTEGER NOT NULL DEFAULT 1,
    show_branding INTEGER NOT NULL DEFAULT 1,
    branding_title TEXT NOT NULL DEFAULT 'AdTV Signage',
    sidebar_title TEXT NOT NULL DEFAULT 'Today''s Highlights',
    sidebar_body TEXT NOT NULL DEFAULT 'Welcome! Content updates appear here instantaneously without any APK reinstall.',
    revision TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS playlist_items (
    id TEXT PRIMARY KEY,
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    duration_sec INTEGER NOT NULL DEFAULT 10,
    transition TEXT NOT NULL DEFAULT 'fade' CHECK(transition IN ('fade', 'slide', 'zoom', 'none')),
    muted INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    playlist_id TEXT REFERENCES playlists(id) ON DELETE SET NULL,
    version_code INTEGER DEFAULT 0,
    version_name TEXT DEFAULT 'unknown',
    is_device_owner INTEGER DEFAULT 0,
    ip_address TEXT DEFAULT '',
    resolution TEXT DEFAULT '',
    current_slide TEXT DEFAULT '',
    last_seen INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS apk_releases (
    id TEXT PRIMARY KEY,
    version_code INTEGER NOT NULL UNIQUE,
    version_name TEXT NOT NULL,
    filename TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    changelog TEXT NOT NULL DEFAULT '',
    mandatory INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
`);

function createDemoSvgDataUri(title, subtitle, gradStart, gradEnd) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${gradStart}"/>
      <stop offset="100%" stop-color="${gradEnd}"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#g)"/>
  <circle cx="1580" cy="240" r="320" fill="rgba(255,255,255,0.08)"/>
  <circle cx="320" cy="860" r="260" fill="rgba(255,255,255,0.06)"/>
  <text x="140" y="470" font-family="system-ui, -apple-system, sans-serif" font-size="96" font-weight="800" fill="#ffffff">${title}</text>
  <text x="140" y="575" font-family="system-ui, -apple-system, sans-serif" font-size="42" font-weight="400" fill="rgba(255,255,255,0.85)">${subtitle}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM playlists').get().c;
  if (count > 0) return;

  const now = Date.now();
  const rev = crypto.randomUUID().slice(0, 8);

  const m1 = 'media-demo-1';
  const m2 = 'media-demo-2';
  const m3 = 'media-demo-3';
  const p1 = 'default-playlist';

  const insertMedia = db.prepare(
    'INSERT INTO media (id, title, type, url, filename, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insertMedia.run(
    m1,
    'Welcome Promo Banner',
    'image',
    createDemoSvgDataUri('Instant Cloud Signage', '99% of UI, layout & playlist updates push live in <1s', '#312e81', '#0f172a'),
    null,
    'image/svg+xml',
    0,
    now
  );
  insertMedia.run(
    m2,
    'Flash Sale Highlight',
    'image',
    createDemoSvgDataUri('Weekend Special — 30% Off', 'Edit this slide, duration, or animation from the Admin Panel', '#065f46', '#064e3b'),
    null,
    'image/svg+xml',
    0,
    now
  );
  insertMedia.run(
    m3,
    'Zero-Touch Kiosk Ready',
    'image',
    createDemoSvgDataUri('Android Device Owner Kiosk', 'Silent PackageInstaller OTA updates + auto-relaunch', '#7c2d12', '#1c1917'),
    null,
    'image/svg+xml',
    0,
    now
  );

  db.prepare(
    `INSERT INTO playlists (id, name, layout, ticker_text, ticker_speed, bg_color, accent_color, show_clock, show_branding, branding_title, sidebar_title, sidebar_body, revision, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    p1,
    'Main Lobby Display',
    'lbar',
    'WELCOME TO ADTV DIGITAL SIGNAGE  •  INSTANT CLOUD PLAYLIST UPDATES  •  ZERO APK REINSTALLS NEEDED  •  24/7 KIOSK MODE ACTIVE',
    35,
    '#09090b',
    '#6366f1',
    1,
    1,
    'AdTV Network',
    'Live Info Panel',
    'Changes made in the Web Admin Panel broadcast immediately via Server-Sent Events (SSE) to all connected TVs.',
    rev,
    now
  );

  const insertItem = db.prepare(
    'INSERT INTO playlist_items (id, playlist_id, media_id, sort_order, duration_sec, transition, muted) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  insertItem.run('item-1', p1, m1, 0, 8, 'fade', 1);
  insertItem.run('item-2', p1, m2, 1, 8, 'slide', 1);
  insertItem.run('item-3', p1, m3, 2, 8, 'zoom', 1);

  db.prepare(
    `INSERT INTO devices (id, name, location, playlist_id, version_code, version_name, is_device_owner, ip_address, resolution, current_slide, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('tv-lobby-01', 'Lobby TV #1', 'Main Entrance', p1, 1, '1.0.0', 1, '127.0.0.1', '1920x1080', 'Welcome Promo Banner', 0);
}

seedIfEmpty();

export function bumpPlaylistRevision(playlistId) {
  const rev = crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  db.prepare('UPDATE playlists SET revision = ?, updated_at = ? WHERE id = ?').run(rev, now, playlistId);
  return rev;
}

export function getPlaylistWithItems(playlistId) {
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(playlistId);
  if (!playlist) return null;
  const items = db
    .prepare(
      `SELECT pi.id, pi.playlist_id, pi.media_id, pi.sort_order, pi.duration_sec, pi.transition, pi.muted,
              m.title, m.type, m.url, m.mime_type
       FROM playlist_items pi
       JOIN media m ON m.id = pi.media_id
       WHERE pi.playlist_id = ?
       ORDER BY pi.sort_order ASC`
    )
    .all(playlistId);
  return { ...playlist, items };
}

export function getPlayerConfigForDevice(deviceId) {
  let device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  if (!device) {
    const defaultPlaylist = db.prepare('SELECT id FROM playlists ORDER BY updated_at DESC LIMIT 1').get();
    device = {
      id: deviceId,
      name: deviceId,
      location: 'Auto-Registered',
      playlist_id: defaultPlaylist ? defaultPlaylist.id : null,
    };
    db.prepare(
      'INSERT INTO devices (id, name, location, playlist_id, last_seen) VALUES (?, ?, ?, ?, ?)'
    ).run(device.id, device.name, device.location, device.playlist_id, Date.now());
  }

  let playlist = device.playlist_id ? getPlaylistWithItems(device.playlist_id) : null;
  if (!playlist) {
    const fallback = db.prepare('SELECT id FROM playlists ORDER BY updated_at DESC LIMIT 1').get();
    if (fallback) playlist = getPlaylistWithItems(fallback.id);
  }

  return {
    device,
    playlist,
    serverTime: Date.now(),
  };
}
