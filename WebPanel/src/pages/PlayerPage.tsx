import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerConfig, PlaylistItem } from '../types';

declare global {
  interface Window {
    AndroidKiosk?: {
      getVersionCode: () => number;
      getVersionName: () => string;
      getDeviceId: () => string;
      isDeviceOwner: () => boolean;
      checkForUpdate: () => void;
      reloadPage: () => void;
      openSettings: () => void;
    };
  }
}

function resolveDeviceId(paramId?: string): string {
  if (paramId) return paramId;
  const qs = new URLSearchParams(window.location.search).get('deviceId');
  if (qs) return qs;
  try {
    const androidId = window.AndroidKiosk?.getDeviceId?.();
    if (androidId) return androidId;
  } catch {
    // ignore
  }
  const saved = localStorage.getItem('adtv_browser_device_id');
  if (saved) return saved;
  const generated = `tv-web-${Math.random().toString(36).slice(2, 7)}`;
  localStorage.setItem('adtv_browser_device_id', generated);
  return generated;
}

export function PlayerPage({ deviceIdParam }: { deviceIdParam?: string }) {
  const deviceId = useMemo(() => resolveDeviceId(deviceIdParam), [deviceIdParam]);
  const cacheKey = `adtv_cached_config_${deviceId}`;

  const [config, setConfig] = useState<PlayerConfig | null>(() => {
    try {
      const cached = localStorage.getItem(cacheKey);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [slideIndex, setSlideIndex] = useState(0);
  const [clock, setClock] = useState(() => new Date());
  const [sseStatus, setSseStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const currentSlideTitleRef = useRef('');

  const lastReloadAtRef = useRef<number>(0);
  const lastApkCheckAtRef = useRef<number>(0);
  const revisionRef = useRef<string>('');

  const fetchConfig = async () => {
    try {
      const res = await fetch(`/api/player/${encodeURIComponent(deviceId)}`);
      if (!res.ok) return;
      const data: PlayerConfig = await res.json();
      setConfig(data);
      revisionRef.current = data.playlist?.revision || '';
      if (data.device) {
        const d = data.device as unknown as { reload_at?: number; apk_check_at?: number };
        if (d.reload_at && lastReloadAtRef.current === 0) lastReloadAtRef.current = d.reload_at;
        if (d.apk_check_at && lastApkCheckAtRef.current === 0) lastApkCheckAtRef.current = d.apk_check_at;
      }
      localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch {
      // keep cached config when offline
    }
  };

  useEffect(() => {
    fetchConfig();
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/player/${encodeURIComponent(deviceId)}/revision`);
        if (!res.ok) return;
        const rev: { revision: string; reloadAt: number; apkCheckAt: number } = await res.json();
        if (rev.reloadAt && rev.reloadAt > lastReloadAtRef.current && lastReloadAtRef.current > 0) {
          window.location.reload();
          return;
        }
        if (rev.reloadAt) lastReloadAtRef.current = rev.reloadAt;

        if (rev.apkCheckAt && rev.apkCheckAt > lastApkCheckAtRef.current && lastApkCheckAtRef.current > 0) {
          lastApkCheckAtRef.current = rev.apkCheckAt;
          try {
            window.AndroidKiosk?.checkForUpdate?.();
          } catch {
            // ignore
          }
        } else if (rev.apkCheckAt) {
          lastApkCheckAtRef.current = rev.apkCheckAt;
        }

        if (rev.revision && rev.revision !== revisionRef.current) {
          fetchConfig();
        }
      } catch {
        // ignore offline poll
      }
    }, 4000);
    return () => clearInterval(poll);
  }, [deviceId]);

  // SSE instant updates
  useEffect(() => {
    const es = new EventSource(`/api/events?deviceId=${encodeURIComponent(deviceId)}`);
    es.addEventListener('connected', () => setSseStatus('live'));
    es.addEventListener('config-updated', () => {
      fetchConfig();
    });
    es.addEventListener('reload', () => {
      window.location.reload();
    });
    es.addEventListener('apk-update', () => {
      try {
        window.AndroidKiosk?.checkForUpdate?.();
      } catch {
        // ignore in browser
      }
    });
    es.onerror = () => setSseStatus('offline');
    return () => es.close();
  }, [deviceId]);

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const items: PlaylistItem[] = config?.playlist?.items || [];
  const safeIndex = items.length > 0 ? slideIndex % items.length : 0;
  const currentItem = items[safeIndex] || null;
  currentSlideTitleRef.current = currentItem?.title || '';

  // Slide timer
  useEffect(() => {
    if (items.length <= 1 || !currentItem) return;
    const ms = Math.max(2, currentItem.duration_sec || 10) * 1000;
    const timer = setTimeout(() => {
      setSlideIndex((i) => (i + 1) % items.length);
    }, ms);
    return () => clearTimeout(timer);
  }, [safeIndex, items.length, currentItem?.id, currentItem?.duration_sec]);

  // Heartbeat
  useEffect(() => {
    const sendHeartbeat = () => {
      let versionCode = 0;
      let versionName = 'web-browser';
      let isDeviceOwner = false;
      try {
        if (window.AndroidKiosk) {
          versionCode = window.AndroidKiosk.getVersionCode();
          versionName = window.AndroidKiosk.getVersionName();
          isDeviceOwner = window.AndroidKiosk.isDeviceOwner();
        }
      } catch {
        // ignore
      }
      fetch(`/api/devices/${encodeURIComponent(deviceId)}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          versionCode,
          versionName,
          isDeviceOwner,
          resolution: `${window.innerWidth}x${window.innerHeight}`,
          currentSlide: currentSlideTitleRef.current,
        }),
      }).catch(() => {});
    };

    sendHeartbeat();
    const hb = setInterval(sendHeartbeat, 20000);
    return () => clearInterval(hb);
  }, [deviceId]);

  const playlist = config?.playlist;
  const layout = playlist?.layout || 'fullscreen';
  const bgColor = playlist?.bg_color || '#09090b';
  const accentColor = playlist?.accent_color || '#6366f1';
  const tickerSpeed = Math.max(10, playlist?.ticker_speed || 35);

  const animClass =
    currentItem?.transition === 'slide'
      ? 'anim-slide'
      : currentItem?.transition === 'zoom'
        ? 'anim-zoom'
        : currentItem?.transition === 'none'
          ? 'anim-none'
          : 'anim-fade';

  const renderMedia = () => {
    if (!currentItem) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center bg-zinc-900 text-zinc-400">
          <div className="text-3xl font-bold text-white">No Active Media</div>
          <p className="mt-2 text-sm">Assign slides to this playlist in the Admin Panel ({deviceId})</p>
        </div>
      );
    }

    if (currentItem.type === 'video') {
      return (
        <video
          key={`${currentItem.id}-${safeIndex}`}
          src={currentItem.url}
          autoPlay
          playsInline
          muted={Boolean(currentItem.muted)}
          onEnded={() => {
            if (items.length > 1) setSlideIndex((i) => (i + 1) % items.length);
          }}
          className={`h-full w-full object-cover ${animClass}`}
        />
      );
    }

    if (currentItem.type === 'web') {
      return (
        <iframe
          key={`${currentItem.id}-${safeIndex}`}
          src={currentItem.url}
          title={currentItem.title}
          className={`h-full w-full border-0 bg-white ${animClass}`}
          allow="autoplay; fullscreen"
        />
      );
    }

    return (
      <img
        key={`${currentItem.id}-${safeIndex}`}
        src={currentItem.url}
        alt={currentItem.title}
        className={`h-full w-full object-cover ${animClass}`}
      />
    );
  };

  const formattedTime = clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const formattedDate = clock.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <div
      className="kiosk-screen relative flex h-screen w-screen flex-col overflow-hidden text-white"
      style={{ backgroundColor: bgColor }}
    >
      {/* Main Content Row */}
      <div className="flex min-h-0 flex-1">
        {/* Primary Media Zone */}
        <div className="relative h-full flex-1 overflow-hidden bg-black">
          {renderMedia()}

          {/* Fullscreen floating badge */}
          {layout === 'fullscreen' && (playlist?.show_clock || playlist?.show_branding) && (
            <div className="pointer-events-none absolute top-6 right-6 flex items-center gap-4 rounded-2xl bg-black/60 px-5 py-3 backdrop-blur-md">
              {playlist?.show_branding ? (
                <span className="text-sm font-semibold tracking-wide" style={{ color: accentColor }}>
                  {playlist.branding_title}
                </span>
              ) : null}
              {playlist?.show_clock ? (
                <span className="font-mono text-xl font-bold text-white">{formattedTime}</span>
              ) : null}
            </div>
          )}
        </div>

        {/* Right Sidebar for split & lbar */}
        {(layout === 'split' || layout === 'lbar') && (
          <aside className="flex w-80 shrink-0 flex-col justify-between border-l border-white/10 bg-zinc-950/90 p-7 xl:w-96">
            <div>
              {playlist?.show_branding ? (
                <div className="mb-6 flex items-center gap-2.5">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: accentColor }} />
                  <span className="text-lg font-bold tracking-tight text-white">
                    {playlist.branding_title}
                  </span>
                </div>
              ) : null}

              <h2 className="text-2xl font-bold leading-snug text-white">
                {playlist?.sidebar_title || 'Information'}
              </h2>
              <p className="mt-4 whitespace-pre-line text-base leading-relaxed text-zinc-300">
                {playlist?.sidebar_body}
              </p>
            </div>

            <div className="space-y-4 border-t border-white/10 pt-5">
              {playlist?.show_clock ? (
                <div>
                  <div className="font-mono text-4xl font-extrabold tracking-tight text-white">
                    {formattedTime}
                  </div>
                  <div className="mt-1 text-sm text-zinc-400">{formattedDate}</div>
                </div>
              ) : null}

              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span>ID: {deviceId}</span>
                <span className="flex items-center gap-1.5">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      sseStatus === 'live'
                        ? 'bg-emerald-400'
                        : sseStatus === 'connecting'
                          ? 'bg-amber-400'
                          : 'bg-rose-500'
                    }`}
                  />
                  {sseStatus === 'live' ? 'LIVE' : sseStatus.toUpperCase()}
                </span>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Bottom Ticker for lbar */}
      {layout === 'lbar' && playlist?.ticker_text ? (
        <footer
          className="flex h-14 shrink-0 items-center overflow-hidden border-t border-white/10"
          style={{ backgroundColor: accentColor }}
        >
          <div
            className="ticker-track text-lg font-semibold tracking-wide text-white"
            style={{ ['--ticker-duration' as string]: `${tickerSpeed}s` }}
          >
            <span className="px-8">{playlist.ticker_text}</span>
            <span className="px-8">{playlist.ticker_text}</span>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
