# AdTV-System — Digital Signage WebPanel + Android Kiosk APK

A two-part digital signage platform designed for **instant cloud UI/content updates** and **silent zero-touch APK OTA updates**.

## Architecture

1. **`WebPanel/` (Node.js 24 + Express + Firebase Firestore / SQLite + React + Tailwind)**
   - **Admin Panel (`/`)**: Manage TV screens, playlists, layouts (`fullscreen`, `split`, `lbar`), scrolling tickers, animations (`fade`, `slide`, `zoom`), media uploads, and signed `.apk` OTA releases.
   - **TV Player (`/player/:deviceId`)**: Fullscreen 16:9 web player with Server-Sent Events (`/api/events`) for sub-second live updates without reloading or updating the APK, plus `localStorage` offline caching and heartbeat reporting.
   - **APK OTA Endpoints**: `GET /api/apk/latest` and `GET /api/apk/download/:filename` with automatic SHA-256 verification.

2. **`TV APK/` (Android Kotlin Kiosk Wrapper)**
   - Fullscreen immersive `WebView` with `FLAG_KEEP_SCREEN_ON`, hardware-accelerated video autoplay, and auto-retry on network loss.
   - **Device Owner & Lock-Task Mode**: Locks the TV into the kiosk app (`startLockTask()`), disables back-button exit, and auto-launches on boot (`BootReceiver`).
   - **Silent Zero-Touch OTA (`ApkUpdater.kt` + `PackageReplacedReceiver.kt`)**: Periodically (every 15 min) or on SSE `apk-update` command, downloads the newer `.apk`, verifies SHA-256, silently installs via `PackageInstaller` (when provisioned as Device Owner), and auto-relaunches `MainActivity`.
   - **Hidden Settings Dialog**: Tap the top-left corner 5 times (or press `MENU`/`INFO` on a TV remote) to set the Server URL and Device ID.

---

## Quick Start: WebPanel

```bash
cd WebPanel
npm install
npm run build
npm start
```

- **Admin Panel**: `http://localhost:3001/` (default login: `admin` / `admin123`, configurable via `ADMIN_USERNAME` and `ADMIN_PASSWORD` env vars).
- **TV Player Preview**: `http://localhost:3001/player/tv-lobby-01`
- **Docker**: `cd WebPanel && docker compose up -d --build`
- **Nginx**: See `WebPanel/nginx.conf.example` (SSE buffering disabled on `/api/events`).
- **Vercel + Firebase Firestore**:
  1. In **Firebase Console** → **Project Settings** → **Service accounts**, click **Generate new private key** to download your service account JSON.
  2. Import the repo in **Vercel** and set **Root Directory** to `WebPanel`.
  3. Add **Environment Variables** in Vercel:
     - `FIREBASE_SERVICE_ACCOUNT_JSON`: paste the full JSON content of your Firebase service account key (or set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` individually).
     - `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `AUTH_SECRET`.
     - *(Optional)* `BLOB_READ_WRITE_TOKEN` (Vercel Blob) for direct media/APK uploads, or use the **External APK URL** / **Add URL** options in the Admin Panel.
  4. Deploy — `WebPanel/vercel.json` routes `/api/*` to the serverless Express handler (`api/index.mjs`) and serves the React SPA from `dist/`. TVs automatically poll `/api/player/:deviceId/revision` every 4 seconds for instant updates on Vercel.

---

## Building & Provisioning the Kiosk APK (`TV APK/`)

1. Open `TV APK/` in **Android Studio** (or build with Gradle + JDK 17 & Android SDK 34):
   ```bash
   ./gradlew assembleRelease
   ```
2. Install the signed APK on a factory-reset Android TV (no Google/user accounts signed in):
   ```bash
   adb install -r app-release.apk
   ```
3. Provision the app as **Device Owner** once via ADB:
   ```bash
   adb shell dpm set-device-owner com.adtv.kiosk/.KioskDeviceAdminReceiver
   ```
4. Open the app, tap top-left 5 times (or press `MENU` on remote), and set your server URL (e.g., `https://signage.yourdomain.com` or `http://192.168.1.100:3001`).
5. Future wrapper updates: upload the new signed `.apk` (with incremented `versionCode`) in the **Kiosk APK OTA** tab of the Admin Panel.
