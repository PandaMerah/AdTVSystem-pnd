import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR =
  process.env.DATA_DIR ||
  (IS_VERCEL ? path.join('/tmp', 'adtv-data') : path.join(__dirname, '..', 'data'));

export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const APK_DIR = path.join(DATA_DIR, 'apks');

const HAS_FIREBASE = Boolean(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY)
);

export const USE_FIREBASE = HAS_FIREBASE;

if (!USE_FIREBASE) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.mkdirSync(APK_DIR, { recursive: true });
} else if (!IS_VERCEL) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.mkdirSync(APK_DIR, { recursive: true });
}

let firestore = null;
let sqliteDb = null;

if (USE_FIREBASE) {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');

  if (getApps().length === 0) {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      : {
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        };
    initializeApp({ credential: cert(serviceAccount) });
  }
  firestore = getFirestore();
} else {
  const { DatabaseSync } = await import('node:sqlite');
  sqliteDb = new DatabaseSync(path.join(DATA_DIR, 'adtv.db'));
  sqliteDb.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
}

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

let initPromise = null;

export async function ensureDb() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!USE_FIREBASE) {
      sqliteDb.exec(`
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
          last_seen INTEGER DEFAULT 0,
          reload_at INTEGER DEFAULT 0,
          apk_check_at INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS apk_releases (
          id TEXT PRIMARY KEY,
          version_code INTEGER NOT NULL UNIQUE,
          version_name TEXT NOT NULL,
          filename TEXT NOT NULL,
          download_url TEXT,
          size_bytes INTEGER NOT NULL DEFAULT 0,
          sha256 TEXT NOT NULL DEFAULT '',
          changelog TEXT NOT NULL DEFAULT '',
          mandatory INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
      `);
      const cols = sqliteDb.prepare('PRAGMA table_info(devices)').all().map((c) => c.name);
      if (!cols.includes('reload_at')) sqliteDb.exec('ALTER TABLE devices ADD COLUMN reload_at INTEGER DEFAULT 0');
      if (!cols.includes('apk_check_at')) sqliteDb.exec('ALTER TABLE devices ADD COLUMN apk_check_at INTEGER DEFAULT 0');
      const apkCols = sqliteDb.prepare('PRAGMA table_info(apk_releases)').all().map((c) => c.name);
      if (!apkCols.includes('download_url')) sqliteDb.exec('ALTER TABLE apk_releases ADD COLUMN download_url TEXT');
    }

    const existingPlaylists = await listPlaylists();
    if (existingPlaylists.length > 0) return;

    const now = Date.now();
    const rev = crypto.randomUUID().slice(0, 8);
    const m1 = 'media-demo-1';
    const m2 = 'media-demo-2';
    const m3 = 'media-demo-3';
    const p1 = 'default-playlist';

    await createMedia({
      id: m1,
      title: 'Welcome Promo Banner',
      type: 'image',
      url: createDemoSvgDataUri('Instant Cloud Signage', '99% of UI, layout & playlist updates push live in <1s', '#312e81', '#0f172a'),
      filename: null,
      mime_type: 'image/svg+xml',
      size_bytes: 0,
      created_at: now,
    });
    await createMedia({
      id: m2,
      title: 'Flash Sale Highlight',
      type: 'image',
      url: createDemoSvgDataUri('Weekend Special — 30% Off', 'Edit this slide, duration, or animation from the Admin Panel', '#065f46', '#064e3b'),
      filename: null,
      mime_type: 'image/svg+xml',
      size_bytes: 0,
      created_at: now + 1,
    });
    await createMedia({
      id: m3,
      title: 'Zero-Touch Kiosk Ready',
      type: 'image',
      url: createDemoSvgDataUri('Android Device Owner Kiosk', 'Silent PackageInstaller OTA updates + auto-relaunch', '#7c2d12', '#1c1917'),
      filename: null,
      mime_type: 'image/svg+xml',
      size_bytes: 0,
      created_at: now + 2,
    });

    await createPlaylist({
      id: p1,
      name: 'Main Lobby Display',
      layout: 'lbar',
      ticker_text: 'WELCOME TO ADTV DIGITAL SIGNAGE  •  INSTANT CLOUD PLAYLIST UPDATES  •  ZERO APK REINSTALLS NEEDED  •  24/7 KIOSK MODE ACTIVE',
      ticker_speed: 35,
      bg_color: '#09090b',
      accent_color: '#6366f1',
      show_clock: 1,
      show_branding: 1,
      branding_title: 'AdTV Network',
      sidebar_title: 'Live Info Panel',
      sidebar_body: 'Changes made in the Web Admin Panel broadcast immediately to all connected TVs.',
      revision: rev,
      updated_at: now,
    });

    await replacePlaylistItems(p1, [
      { id: 'item-1', media_id: m1, duration_sec: 8, transition: 'fade', muted: 1 },
      { id: 'item-2', media_id: m2, duration_sec: 8, transition: 'slide', muted: 1 },
      { id: 'item-3', media_id: m3, duration_sec: 8, transition: 'zoom', muted: 1 },
    ]);

    await createDevice({
      id: 'tv-lobby-01',
      name: 'Lobby TV #1',
      location: 'Main Entrance',
      playlist_id: p1,
      version_code: 1,
      version_name: '1.0.0',
      is_device_owner: 1,
      ip_address: '127.0.0.1',
      resolution: '1920x1080',
      current_slide: 'Welcome Promo Banner',
      last_seen: 0,
      reload_at: 0,
      apk_check_at: 0,
    });
  })();
  return initPromise;
}

// -------------------- MEDIA --------------------
export async function listMedia() {
  if (USE_FIREBASE) {
    const snap = await firestore.collection('media').orderBy('created_at', 'desc').get();
    return snap.docs.map((d) => d.data());
  }
  return sqliteDb.prepare('SELECT * FROM media ORDER BY created_at DESC').all();
}

export async function getMedia(id) {
  if (USE_FIREBASE) {
    const doc = await firestore.collection('media').doc(id).get();
    return doc.exists ? doc.data() : null;
  }
  return sqliteDb.prepare('SELECT * FROM media WHERE id = ?').get(id) || null;
}

export async function createMedia(data) {
  if (USE_FIREBASE) {
    await firestore.collection('media').doc(data.id).set(data);
    return data;
  }
  sqliteDb
    .prepare(
      'INSERT INTO media (id, title, type, url, filename, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(data.id, data.title, data.type, data.url, data.filename, data.mime_type, data.size_bytes || 0, data.created_at);
  return getMedia(data.id);
}

export async function deleteMedia(id) {
  if (USE_FIREBASE) {
    await firestore.collection('media').doc(id).delete();
    const snap = await firestore.collection('playlists').get();
    const rev = crypto.randomUUID().slice(0, 8);
    const now = Date.now();
    for (const doc of snap.docs) {
      const p = doc.data();
      const items = Array.isArray(p.items) ? p.items : [];
      const filtered = items.filter((it) => it.media_id !== id);
      if (filtered.length !== items.length) {
        await doc.ref.update({ items: filtered, revision: rev, updated_at: now });
      }
    }
    return;
  }

  const affected = sqliteDb
    .prepare('SELECT DISTINCT playlist_id FROM playlist_items WHERE media_id = ?')
    .all(id);
  sqliteDb.prepare('DELETE FROM media WHERE id = ?').run(id);
  const rev = crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  for (const row of affected) {
    sqliteDb.prepare('UPDATE playlists SET revision = ?, updated_at = ? WHERE id = ?').run(rev, now, row.playlist_id);
  }
}

// -------------------- PLAYLISTS --------------------
export async function listPlaylists() {
  if (USE_FIREBASE) {
    const snap = await firestore.collection('playlists').orderBy('updated_at', 'desc').get();
    const mediaList = await listMedia();
    const mediaMap = new Map(mediaList.map((m) => [m.id, m]));
    return snap.docs.map((d) => hydratePlaylist(d.data(), mediaMap));
  }
  const rows = sqliteDb.prepare('SELECT id FROM playlists ORDER BY updated_at DESC').all();
  return Promise.all(rows.map((r) => getPlaylistWithItems(r.id)));
}

function hydratePlaylist(p, mediaMap) {
  const rawItems = Array.isArray(p.items) ? p.items : [];
  const items = rawItems
    .map((it, idx) => {
      const m = mediaMap.get(it.media_id);
      if (!m) return null;
      return {
        id: it.id,
        playlist_id: p.id,
        media_id: it.media_id,
        sort_order: idx,
        duration_sec: Number(it.duration_sec || 10),
        transition: it.transition || 'fade',
        muted: it.muted === 0 || it.muted === false ? 0 : 1,
        title: m.title,
        type: m.type,
        url: m.url,
        mime_type: m.mime_type || null,
      };
    })
    .filter(Boolean);
  return { ...p, items };
}

export async function getPlaylistWithItems(playlistId) {
  if (USE_FIREBASE) {
    const doc = await firestore.collection('playlists').doc(playlistId).get();
    if (!doc.exists) return null;
    const mediaList = await listMedia();
    const mediaMap = new Map(mediaList.map((m) => [m.id, m]));
    return hydratePlaylist(doc.data(), mediaMap);
  }
  const playlist = sqliteDb.prepare('SELECT * FROM playlists WHERE id = ?').get(playlistId);
  if (!playlist) return null;
  const items = sqliteDb
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

export async function createPlaylist(data) {
  if (USE_FIREBASE) {
    const docData = { ...data, items: [] };
    await firestore.collection('playlists').doc(data.id).set(docData);
    return docData;
  }
  sqliteDb
    .prepare(
      `INSERT INTO playlists (id, name, layout, ticker_text, ticker_speed, bg_color, accent_color, show_clock, show_branding, branding_title, sidebar_title, sidebar_body, revision, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.id,
      data.name,
      data.layout,
      data.ticker_text,
      data.ticker_speed,
      data.bg_color,
      data.accent_color,
      data.show_clock,
      data.show_branding,
      data.branding_title,
      data.sidebar_title,
      data.sidebar_body,
      data.revision,
      data.updated_at
    );
  return getPlaylistWithItems(data.id);
}

export async function updatePlaylist(id, patch) {
  const rev = crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  if (USE_FIREBASE) {
    const ref = firestore.collection('playlists').doc(id);
    const doc = await ref.get();
    if (!doc.exists) return null;
    const existing = doc.data();
    await ref.update({
      name: patch.name ?? existing.name,
      layout: patch.layout ?? existing.layout,
      ticker_text: patch.ticker_text ?? existing.ticker_text,
      ticker_speed: Number(patch.ticker_speed ?? existing.ticker_speed),
      bg_color: patch.bg_color ?? existing.bg_color,
      accent_color: patch.accent_color ?? existing.accent_color,
      show_clock: patch.show_clock !== undefined ? (patch.show_clock ? 1 : 0) : existing.show_clock,
      show_branding: patch.show_branding !== undefined ? (patch.show_branding ? 1 : 0) : existing.show_branding,
      branding_title: patch.branding_title ?? existing.branding_title,
      sidebar_title: patch.sidebar_title ?? existing.sidebar_title,
      sidebar_body: patch.sidebar_body ?? existing.sidebar_body,
      revision: rev,
      updated_at: now,
    });
    return getPlaylistWithItems(id);
  }

  const existing = sqliteDb.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
  if (!existing) return null;
  sqliteDb
    .prepare(
      `UPDATE playlists SET
        name = ?, layout = ?, ticker_text = ?, ticker_speed = ?,
        bg_color = ?, accent_color = ?, show_clock = ?, show_branding = ?,
        branding_title = ?, sidebar_title = ?, sidebar_body = ?,
        revision = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      patch.name ?? existing.name,
      patch.layout ?? existing.layout,
      patch.ticker_text ?? existing.ticker_text,
      Number(patch.ticker_speed ?? existing.ticker_speed),
      patch.bg_color ?? existing.bg_color,
      patch.accent_color ?? existing.accent_color,
      patch.show_clock !== undefined ? (patch.show_clock ? 1 : 0) : existing.show_clock,
      patch.show_branding !== undefined ? (patch.show_branding ? 1 : 0) : existing.show_branding,
      patch.branding_title ?? existing.branding_title,
      patch.sidebar_title ?? existing.sidebar_title,
      patch.sidebar_body ?? existing.sidebar_body,
      rev,
      now,
      id
    );
  return getPlaylistWithItems(id);
}

export async function replacePlaylistItems(playlistId, items) {
  const rev = crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  const normalized = items.map((item, idx) => ({
    id: item.id || `item-${crypto.randomUUID().slice(0, 8)}`,
    media_id: item.media_id,
    sort_order: idx,
    duration_sec: Math.max(2, Number(item.duration_sec || 10)),
    transition: ['fade', 'slide', 'zoom', 'none'].includes(item.transition) ? item.transition : 'fade',
    muted: item.muted === false || item.muted === 0 ? 0 : 1,
  }));

  if (USE_FIREBASE) {
    const ref = firestore.collection('playlists').doc(playlistId);
    const doc = await ref.get();
    if (!doc.exists) return null;
    await ref.update({ items: normalized, revision: rev, updated_at: now });
    return getPlaylistWithItems(playlistId);
  }

  const existing = sqliteDb.prepare('SELECT id FROM playlists WHERE id = ?').get(playlistId);
  if (!existing) return null;
  sqliteDb.exec('BEGIN');
  try {
    sqliteDb.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(playlistId);
    const ins = sqliteDb.prepare(
      'INSERT INTO playlist_items (id, playlist_id, media_id, sort_order, duration_sec, transition, muted) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const it of normalized) {
      ins.run(it.id, playlistId, it.media_id, it.sort_order, it.duration_sec, it.transition, it.muted);
    }
    sqliteDb.prepare('UPDATE playlists SET revision = ?, updated_at = ? WHERE id = ?').run(rev, now, playlistId);
    sqliteDb.exec('COMMIT');
  } catch (err) {
    sqliteDb.exec('ROLLBACK');
    throw err;
  }
  return getPlaylistWithItems(playlistId);
}

export async function deletePlaylist(id) {
  if (USE_FIREBASE) {
    await firestore.collection('playlists').doc(id).delete();
    return;
  }
  sqliteDb.prepare('DELETE FROM playlists WHERE id = ?').run(id);
}

// -------------------- DEVICES --------------------
export async function listDevices() {
  if (USE_FIREBASE) {
    const snap = await firestore.collection('devices').orderBy('last_seen', 'desc').get();
    return snap.docs.map((d) => d.data());
  }
  return sqliteDb.prepare('SELECT * FROM devices ORDER BY last_seen DESC, name ASC').all();
}

export async function getDevice(id) {
  if (USE_FIREBASE) {
    const doc = await firestore.collection('devices').doc(id).get();
    return doc.exists ? doc.data() : null;
  }
  return sqliteDb.prepare('SELECT * FROM devices WHERE id = ?').get(id) || null;
}

export async function createDevice(data) {
  if (USE_FIREBASE) {
    await firestore.collection('devices').doc(data.id).set(data);
    return data;
  }
  sqliteDb
    .prepare(
      `INSERT INTO devices (id, name, location, playlist_id, version_code, version_name, is_device_owner, ip_address, resolution, current_slide, last_seen, reload_at, apk_check_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.id,
      data.name,
      data.location || '',
      data.playlist_id || null,
      data.version_code || 0,
      data.version_name || 'unknown',
      data.is_device_owner ? 1 : 0,
      data.ip_address || '',
      data.resolution || '',
      data.current_slide || '',
      data.last_seen || 0,
      data.reload_at || 0,
      data.apk_check_at || 0
    );
  return getDevice(data.id);
}

export async function updateDevice(id, patch) {
  const existing = await getDevice(id);
  if (!existing) return null;
  const updated = {
    ...existing,
    name: patch.name ?? existing.name,
    location: patch.location ?? existing.location,
    playlist_id: patch.playlist_id !== undefined ? patch.playlist_id : existing.playlist_id,
  };
  if (USE_FIREBASE) {
    await firestore.collection('devices').doc(id).update({
      name: updated.name,
      location: updated.location,
      playlist_id: updated.playlist_id,
    });
    return updated;
  }
  sqliteDb
    .prepare('UPDATE devices SET name = ?, location = ?, playlist_id = ? WHERE id = ?')
    .run(updated.name, updated.location, updated.playlist_id, id);
  return getDevice(id);
}

export async function deleteDevice(id) {
  if (USE_FIREBASE) {
    await firestore.collection('devices').doc(id).delete();
    return;
  }
  sqliteDb.prepare('DELETE FROM devices WHERE id = ?').run(id);
}

export async function upsertDeviceHeartbeat(deviceId, data) {
  const now = Date.now();
  const existing = await getDevice(deviceId);
  if (!existing) {
    const allPlaylists = await listPlaylists();
    const fallbackId = allPlaylists[0]?.id || null;
    await createDevice({
      id: deviceId,
      name: deviceId,
      location: 'Auto-Registered',
      playlist_id: fallbackId,
      version_code: data.versionCode,
      version_name: data.versionName,
      is_device_owner: data.isDeviceOwner ? 1 : 0,
      ip_address: data.ip,
      resolution: data.resolution,
      current_slide: data.currentSlide,
      last_seen: now,
      reload_at: 0,
      apk_check_at: 0,
    });
    return now;
  }

  if (USE_FIREBASE) {
    await firestore.collection('devices').doc(deviceId).update({
      version_code: data.versionCode,
      version_name: data.versionName,
      is_device_owner: data.isDeviceOwner ? 1 : 0,
      ip_address: data.ip,
      resolution: data.resolution,
      current_slide: data.currentSlide,
      last_seen: now,
    });
    return now;
  }

  sqliteDb
    .prepare(
      `UPDATE devices SET version_code = ?, version_name = ?, is_device_owner = ?, ip_address = ?, resolution = ?, current_slide = ?, last_seen = ?
       WHERE id = ?`
    )
    .run(
      data.versionCode,
      data.versionName,
      data.isDeviceOwner ? 1 : 0,
      data.ip,
      data.resolution,
      data.currentSlide,
      now,
      deviceId
    );
  return now;
}

export async function setDeviceCommandTimestamp(targetDeviceIdOrNull, field, ts) {
  if (field !== 'reload_at' && field !== 'apk_check_at') return;
  if (USE_FIREBASE) {
    if (targetDeviceIdOrNull) {
      await firestore.collection('devices').doc(targetDeviceIdOrNull).set({ [field]: ts }, { merge: true });
    } else {
      const snap = await firestore.collection('devices').get();
      await Promise.all(snap.docs.map((d) => d.ref.update({ [field]: ts })));
    }
    return;
  }
  if (targetDeviceIdOrNull) {
    sqliteDb.prepare(`UPDATE devices SET ${field} = ? WHERE id = ?`).run(ts, targetDeviceIdOrNull);
  } else {
    sqliteDb.prepare(`UPDATE devices SET ${field} = ?`).run(ts);
  }
}

export async function getPlayerConfigForDevice(deviceId) {
  let device = await getDevice(deviceId);
  if (!device) {
    const all = await listPlaylists();
    device = await createDevice({
      id: deviceId,
      name: deviceId,
      location: 'Auto-Registered',
      playlist_id: all[0]?.id || null,
      last_seen: Date.now(),
      reload_at: 0,
      apk_check_at: 0,
    });
  }

  let playlist = device.playlist_id ? await getPlaylistWithItems(device.playlist_id) : null;
  if (!playlist) {
    const all = await listPlaylists();
    if (all[0]) playlist = all[0];
  }

  return { device, playlist, serverTime: Date.now() };
}

export async function getPlayerRevision(deviceId) {
  const device = await getDevice(deviceId);
  let playlist = device?.playlist_id ? await getPlaylistWithItems(device.playlist_id) : null;
  if (!playlist) {
    const all = await listPlaylists();
    playlist = all[0] || null;
  }
  return {
    playlistId: playlist?.id || null,
    revision: playlist?.revision || '',
    reloadAt: Number(device?.reload_at || 0),
    apkCheckAt: Number(device?.apk_check_at || 0),
  };
}

// -------------------- APK RELEASES --------------------
export async function listApkReleases() {
  if (USE_FIREBASE) {
    const snap = await firestore.collection('apk_releases').orderBy('version_code', 'desc').get();
    return snap.docs.map((d) => d.data());
  }
  return sqliteDb.prepare('SELECT * FROM apk_releases ORDER BY version_code DESC').all();
}

export async function getLatestApkRelease() {
  if (USE_FIREBASE) {
    const snap = await firestore.collection('apk_releases').orderBy('version_code', 'desc').limit(1).get();
    return snap.empty ? null : snap.docs[0].data();
  }
  return sqliteDb.prepare('SELECT * FROM apk_releases ORDER BY version_code DESC LIMIT 1').get() || null;
}

export async function getApkRelease(id) {
  if (USE_FIREBASE) {
    const doc = await firestore.collection('apk_releases').doc(id).get();
    return doc.exists ? doc.data() : null;
  }
  return sqliteDb.prepare('SELECT * FROM apk_releases WHERE id = ?').get(id) || null;
}

export async function createApkRelease(data) {
  if (USE_FIREBASE) {
    const existing = await firestore
      .collection('apk_releases')
      .where('version_code', '==', data.version_code)
      .limit(1)
      .get();
    if (!existing.empty) {
      throw new Error(`version_code ${data.version_code} already exists`);
    }
    await firestore.collection('apk_releases').doc(data.id).set(data);
    return data;
  }

  sqliteDb
    .prepare(
      `INSERT INTO apk_releases (id, version_code, version_name, filename, download_url, size_bytes, sha256, changelog, mandatory, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.id,
      data.version_code,
      data.version_name,
      data.filename,
      data.download_url,
      data.size_bytes,
      data.sha256,
      data.changelog,
      data.mandatory,
      data.created_at
    );
  return getApkRelease(data.id);
}

export async function deleteApkRelease(id) {
  if (USE_FIREBASE) {
    await firestore.collection('apk_releases').doc(id).delete();
    return;
  }
  sqliteDb.prepare('DELETE FROM apk_releases WHERE id = ?').run(id);
}
