import { useState } from 'react';
import { Monitor, RefreshCw, Download, Plus, Trash2, ExternalLink, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../api';
import type { Device, Playlist } from '../types';

interface Props {
  devices: Device[];
  playlists: Playlist[];
  onRefresh: () => void;
}

export function ScreensTab({ devices, playlists, onRefresh }: Props) {
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/admin/devices', {
      method: 'POST',
      body: JSON.stringify({
        id: newId || undefined,
        name: newName || newId || 'New TV Screen',
        location: newLocation,
        playlist_id: playlists[0]?.id || null,
      }),
    });
    setNewId('');
    setNewName('');
    setNewLocation('');
    onRefresh();
  };

  const assignPlaylist = async (deviceId: string, playlistId: string) => {
    await apiFetch(`/api/admin/devices/${encodeURIComponent(deviceId)}`, {
      method: 'PUT',
      body: JSON.stringify({ playlist_id: playlistId || null }),
    });
    onRefresh();
  };

  const sendCommand = async (deviceId: string, command: 'reload' | 'apk-update') => {
    setBusyId(`${deviceId}-${command}`);
    try {
      await apiFetch(`/api/admin/devices/${encodeURIComponent(deviceId)}/command`, {
        method: 'POST',
        body: JSON.stringify({ command }),
      });
    } finally {
      setTimeout(() => setBusyId(null), 600);
    }
  };

  const deleteDevice = async (deviceId: string) => {
    if (!confirm(`Remove screen "${deviceId}"?`)) return;
    await apiFetch(`/api/admin/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
    onRefresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">TV Screens & Kiosk Devices</h2>
          <p className="text-sm text-zinc-400">
            TVs auto-register on first connection or can be pre-created below.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => sendCommand('all', 'reload')}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            <RefreshCw className="h-4 w-4" />
            Reload All TVs
          </button>
          <button
            onClick={() => sendCommand('all', 'apk-update')}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
          >
            <Download className="h-4 w-4" />
            Push APK Check All
          </button>
        </div>
      </div>

      <form onSubmit={handleAdd} className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:grid-cols-4">
        <input
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          placeholder="Device ID (e.g. tv-lobby-02)"
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder-zinc-500"
        />
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Display Name"
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder-zinc-500"
        />
        <input
          value={newLocation}
          onChange={(e) => setNewLocation(e.target.value)}
          placeholder="Location (e.g. Reception)"
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder-zinc-500"
        />
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-white"
        >
          <Plus className="h-4 w-4" />
          Add Screen
        </button>
      </form>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {devices.map((d) => (
          <div key={d.id} className="flex flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-900/70 p-5">
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className={`rounded-lg p-2.5 ${d.online ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-400'}`}>
                    <Monitor className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-semibold text-white">{d.name}</div>
                    <div className="font-mono text-xs text-zinc-400">{d.id}</div>
                  </div>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    d.online ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${d.online ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
                  {d.online ? 'Online' : 'Offline'}
                </span>
              </div>

              <div className="mt-4 space-y-1.5 text-xs text-zinc-400">
                <div>Location: <span className="text-zinc-200">{d.location || '—'}</span></div>
                <div>Resolution: <span className="text-zinc-200">{d.resolution || '—'}</span></div>
                <div>Current Slide: <span className="text-zinc-200">{d.current_slide || '—'}</span></div>
                <div className="flex items-center gap-2">
                  <span>APK: <span className="font-mono text-zinc-200">v{d.version_name} ({d.version_code})</span></span>
                  {d.is_device_owner ? (
                    <span className="inline-flex items-center gap-1 rounded bg-indigo-500/15 px-1.5 py-0.5 text-[11px] text-indigo-300">
                      <ShieldCheck className="h-3 w-3" /> Device Owner
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-xs font-medium text-zinc-400">Assigned Playlist</label>
                <select
                  value={d.playlist_id || ''}
                  onChange={(e) => assignPlaylist(d.id, e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
                >
                  <option value="">— Unassigned —</option>
                  {playlists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.layout})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 pt-4">
              <div className="flex gap-2">
                <button
                  onClick={() => sendCommand(d.id, 'reload')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${busyId === `${d.id}-reload` ? 'animate-spin' : ''}`} />
                  Reload
                </button>
                <button
                  onClick={() => sendCommand(d.id, 'apk-update')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  OTA
                </button>
                <a
                  href={`/player/${encodeURIComponent(d.id)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-indigo-300 hover:bg-zinc-800"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Preview
                </a>
              </div>
              <button
                onClick={() => deleteDevice(d.id)}
                className="rounded-lg p-1.5 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-400"
                title="Delete device"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
