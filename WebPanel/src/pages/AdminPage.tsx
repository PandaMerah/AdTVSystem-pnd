import { useEffect, useState } from 'react';
import { Monitor, Layers, Image, Package, LogOut, Tv, ExternalLink } from 'lucide-react';
import { apiFetch, clearToken } from '../api';
import type { ApkRelease, Device, MediaItem, Playlist } from '../types';
import { ScreensTab } from '../components/ScreensTab';
import { PlaylistEditor } from '../components/PlaylistEditor';
import { MediaTab } from '../components/MediaTab';
import { ApkReleasesTab } from '../components/ApkReleasesTab';

type Tab = 'screens' | 'playlists' | 'media' | 'apk';

export function AdminPage({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('screens');
  const [devices, setDevices] = useState<Device[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [apks, setApks] = useState<ApkRelease[]>([]);

  const loadAll = async () => {
    try {
      const [d, p, m, a] = await Promise.all([
        apiFetch<Device[]>('/api/admin/devices'),
        apiFetch<Playlist[]>('/api/admin/playlists'),
        apiFetch<MediaItem[]>('/api/admin/media'),
        apiFetch<ApkRelease[]>('/api/admin/apk'),
      ]);
      setDevices(d);
      setPlaylists(p);
      setMedia(m);
      setApks(a);
    } catch (err) {
      if (err instanceof Error && err.message === 'Unauthorized') {
        onLogout();
      }
    }
  };

  useEffect(() => {
    loadAll();
    const timer = setInterval(loadAll, 15000);
    return () => clearInterval(timer);
  }, []);

  const navItems: { id: Tab; label: string; icon: typeof Monitor; count?: number }[] = [
    { id: 'screens', label: 'TV Screens', icon: Monitor, count: devices.length },
    { id: 'playlists', label: 'Playlists & Layouts', icon: Layers, count: playlists.length },
    { id: 'media', label: 'Media Library', icon: Image, count: media.length },
    { id: 'apk', label: 'Kiosk APK OTA', icon: Package, count: apks.length },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-indigo-600/20 p-2 text-indigo-400">
              <Tv className="h-5 w-5" />
            </div>
            <div>
              <span className="font-bold text-white">AdTV Signage</span>
              <span className="ml-2 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">Admin</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="/player"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-indigo-300 hover:bg-zinc-900"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open TV Player
            </a>
            <button
              onClick={() => {
                clearToken();
                onLogout();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-900 hover:text-white"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </button>
          </div>
        </div>

        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition ${
                  active
                    ? 'border-indigo-500 text-white'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
                {item.count !== undefined && (
                  <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">{item.count}</span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {tab === 'screens' && <ScreensTab devices={devices} playlists={playlists} onRefresh={loadAll} />}
        {tab === 'playlists' && <PlaylistEditor playlists={playlists} media={media} onRefresh={loadAll} />}
        {tab === 'media' && <MediaTab media={media} onRefresh={loadAll} />}
        {tab === 'apk' && <ApkReleasesTab releases={apks} onRefresh={loadAll} />}
      </main>
    </div>
  );
}
