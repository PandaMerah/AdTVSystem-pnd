import { useState } from 'react';
import { Upload, Trash2, Shield, Terminal, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '../api';
import type { ApkRelease } from '../types';

interface Props {
  releases: ApkRelease[];
  onRefresh: () => void;
}

export function ApkReleasesTab({ releases, onRefresh }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [versionCode, setVersionCode] = useState('2');
  const [versionName, setVersionName] = useState('1.0.1');
  const [changelog, setChangelog] = useState('');
  const [mandatory, setMandatory] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('versionCode', versionCode);
      fd.append('versionName', versionName);
      fd.append('changelog', changelog);
      fd.append('mandatory', String(mandatory));
      await apiFetch('/api/admin/apk/upload', { method: 'POST', body: fd });
      setFile(null);
      setChangelog('');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this APK release?')) return;
    await apiFetch(`/api/admin/apk/${id}`, { method: 'DELETE' });
    onRefresh();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Silent Zero-Touch APK OTA Releases</h2>
        <p className="text-sm text-zinc-400">
          Upload signed Kiosk APK builds here. Provisioned Device Owner TVs verify the SHA-256 checksum and silently install + relaunch via Android PackageInstaller.
        </p>
      </div>

      <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-4 text-sm text-indigo-200">
        <div className="flex items-center gap-2 font-semibold text-indigo-300">
          <Terminal className="h-4 w-4" /> One-Time ADB Device Owner Provisioning
        </div>
        <p className="mt-1 text-xs text-indigo-200/80">
          Run once on a fresh Android TV (with no Google/user accounts signed in) after installing the Kiosk APK:
        </p>
        <code className="mt-2 block rounded-lg bg-zinc-950 px-3 py-2 font-mono text-xs text-emerald-300">
          adb shell dpm set-device-owner com.adtv.kiosk/.KioskDeviceAdminReceiver
        </code>
      </div>

      <form onSubmit={handleUpload} className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/70 p-5">
        <h3 className="text-base font-bold text-white">Publish New APK Release</h3>
        {error && <div className="rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-300">{error}</div>}
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Version Code (integer)</label>
            <input
              type="number"
              min={1}
              required
              value={versionCode}
              onChange={(e) => setVersionCode(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Version Name</label>
            <input
              required
              value={versionName}
              onChange={(e) => setVersionName(e.target.value)}
              placeholder="1.0.1"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Signed APK File (.apk)</label>
            <input
              type="file"
              accept=".apk"
              required
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-300"
            />
          </div>
        </div>
        <input
          value={changelog}
          onChange={(e) => setChangelog(e.target.value)}
          placeholder="Changelog / release notes..."
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-200">
            <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
            Push immediate silent OTA check to all connected TVs
          </label>
          <button
            type="submit"
            disabled={uploading || !file}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {uploading ? 'Uploading & Hashing...' : 'Publish APK'}
          </button>
        </div>
      </form>

      <div className="space-y-3">
        {releases.length === 0 && (
          <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
            No APK releases published yet. Endpoint <code className="text-zinc-300">GET /api/apk/latest</code> will serve the highest versionCode once uploaded.
          </div>
        )}
        {releases.map((r, i) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-white">v{r.version_name}</span>
                <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-300">
                  code {r.version_code}
                </span>
                {i === 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" /> Latest
                  </span>
                )}
                {r.mandatory ? (
                  <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                    <Shield className="h-3 w-3" /> Mandatory
                  </span>
                ) : null}
              </div>
              <div className="text-xs text-zinc-400">{r.changelog || 'No changelog'}</div>
              <div className="font-mono text-[11px] text-zinc-500">
                SHA-256: {r.sha256} • {(r.size_bytes / 1024 / 1024).toFixed(2)} MB
              </div>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`/api/apk/download/${encodeURIComponent(r.filename)}`}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
              >
                Download
              </a>
              <button
                onClick={() => handleDelete(r.id)}
                className="rounded-lg p-1.5 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-400"
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
