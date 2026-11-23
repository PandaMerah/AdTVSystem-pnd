import { useState } from 'react';
import { Upload, Link as LinkIcon, Trash2, Image as ImageIcon, Film, Globe } from 'lucide-react';
import { apiFetch } from '../api';
import type { MediaItem, MediaType } from '../types';

interface Props {
  media: MediaItem[];
  onRefresh: () => void;
}

export function MediaTab({ media, onRefresh }: Props) {
  const [uploading, setUploading] = useState(false);
  const [urlTitle, setUrlTitle] = useState('');
  const [urlValue, setUrlValue] = useState('');
  const [urlType, setUrlType] = useState<MediaType>('web');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('title', file.name.replace(/\.[^.]+$/, ''));
        await apiFetch('/api/admin/media/upload', { method: 'POST', body: fd });
      }
      onRefresh();
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleAddUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlTitle || !urlValue) return;
    await apiFetch('/api/admin/media/url', {
      method: 'POST',
      body: JSON.stringify({ title: urlTitle, url: urlValue, type: urlType }),
    });
    setUrlTitle('');
    setUrlValue('');
    onRefresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this media item? It will also be removed from playlists.')) return;
    await apiFetch(`/api/admin/media/${id}`, { method: 'DELETE' });
    onRefresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Media Library</h2>
          <p className="text-sm text-zinc-400">Upload images/videos or register external web/HTML5 signage URLs.</p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
          <Upload className="h-4 w-4" />
          {uploading ? 'Uploading...' : 'Upload Image / Video'}
          <input type="file" multiple accept="image/*,video/*" className="hidden" onChange={handleFileUpload} disabled={uploading} />
        </label>
      </div>

      <form onSubmit={handleAddUrl} className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:grid-cols-4">
        <input
          value={urlTitle}
          onChange={(e) => setUrlTitle(e.target.value)}
          placeholder="Title (e.g. Live Weather Widget)"
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder-zinc-500"
        />
        <input
          value={urlValue}
          onChange={(e) => setUrlValue(e.target.value)}
          placeholder="https://..."
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder-zinc-500"
        />
        <select
          value={urlType}
          onChange={(e) => setUrlType(e.target.value as MediaType)}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
        >
          <option value="web">Web Page (iframe)</option>
          <option value="image">Remote Image URL</option>
          <option value="video">Remote Video URL</option>
        </select>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-white"
        >
          <LinkIcon className="h-4 w-4" />
          Add URL
        </button>
      </form>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {media.map((m) => (
          <div key={m.id} className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/70">
            <div className="relative aspect-video bg-zinc-950">
              {m.type === 'image' ? (
                <img src={m.url} alt={m.title} className="h-full w-full object-cover" />
              ) : m.type === 'video' ? (
                <video src={m.url} className="h-full w-full object-cover" muted />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-zinc-400">
                  <Globe className="h-8 w-8 text-indigo-400" />
                  <span className="max-w-[85%] truncate text-xs">{m.url}</span>
                </div>
              )}
              <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/75 px-2 py-0.5 text-xs font-medium text-zinc-200">
                {m.type === 'image' ? <ImageIcon className="h-3 w-3" /> : m.type === 'video' ? <Film className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
                {m.type}
              </span>
            </div>
            <div className="flex items-center justify-between p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white">{m.title}</div>
                <div className="text-xs text-zinc-500">
                  {m.size_bytes > 0 ? `${(m.size_bytes / 1024 / 1024).toFixed(2)} MB` : 'External / Built-in'}
                </div>
              </div>
              <button
                onClick={() => handleDelete(m.id)}
                className="rounded-lg p-1.5 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-400"
                title="Delete media"
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
