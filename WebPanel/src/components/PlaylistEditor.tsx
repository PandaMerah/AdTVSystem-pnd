import { useEffect, useState } from 'react';
import { Save, Plus, Trash2, ArrowUp, ArrowDown, Sparkles } from 'lucide-react';
import { apiFetch } from '../api';
import type { LayoutType, MediaItem, Playlist, TransitionType } from '../types';

interface Props {
  playlists: Playlist[];
  media: MediaItem[];
  onRefresh: () => void;
}

interface DraftItem {
  media_id: string;
  duration_sec: number;
  transition: TransitionType;
  muted: boolean;
}

export function PlaylistEditor({ playlists, media, onRefresh }: Props) {
  const [selectedId, setSelectedId] = useState<string>(playlists[0]?.id || '');
  const active = playlists.find((p) => p.id === selectedId) || playlists[0];

  const [name, setName] = useState('');
  const [layout, setLayout] = useState<LayoutType>('lbar');
  const [tickerText, setTickerText] = useState('');
  const [tickerSpeed, setTickerSpeed] = useState(35);
  const [bgColor, setBgColor] = useState('#09090b');
  const [accentColor, setAccentColor] = useState('#6366f1');
  const [showClock, setShowClock] = useState(true);
  const [showBranding, setShowBranding] = useState(true);
  const [brandingTitle, setBrandingTitle] = useState('');
  const [sidebarTitle, setSidebarTitle] = useState('');
  const [sidebarBody, setSidebarBody] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    if (!active) return;
    setSelectedId(active.id);
    setName(active.name);
    setLayout(active.layout);
    setTickerText(active.ticker_text);
    setTickerSpeed(active.ticker_speed);
    setBgColor(active.bg_color);
    setAccentColor(active.accent_color);
    setShowClock(Boolean(active.show_clock));
    setShowBranding(Boolean(active.show_branding));
    setBrandingTitle(active.branding_title);
    setSidebarTitle(active.sidebar_title);
    setSidebarBody(active.sidebar_body);
    setItems(
      active.items.map((it) => ({
        media_id: it.media_id,
        duration_sec: it.duration_sec,
        transition: it.transition,
        muted: Boolean(it.muted),
      }))
    );
  }, [active?.id, active?.revision]);

  const createPlaylist = async () => {
    const created = await apiFetch<Playlist>('/api/admin/playlists', {
      method: 'POST',
      body: JSON.stringify({ name: `Playlist ${playlists.length + 1}`, layout: 'lbar' }),
    });
    setSelectedId(created.id);
    onRefresh();
  };

  const deletePlaylist = async () => {
    if (!active || playlists.length <= 1) return;
    if (!confirm(`Delete playlist "${active.name}"?`)) return;
    await apiFetch(`/api/admin/playlists/${active.id}`, { method: 'DELETE' });
    setSelectedId('');
    onRefresh();
  };

  const saveAll = async () => {
    if (!active) return;
    setSaving(true);
    try {
      await apiFetch(`/api/admin/playlists/${active.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name,
          layout,
          ticker_text: tickerText,
          ticker_speed: tickerSpeed,
          bg_color: bgColor,
          accent_color: accentColor,
          show_clock: showClock,
          show_branding: showBranding,
          branding_title: brandingTitle,
          sidebar_title: sidebarTitle,
          sidebar_body: sidebarBody,
        }),
      });
      await apiFetch(`/api/admin/playlists/${active.id}/items`, {
        method: 'PUT',
        body: JSON.stringify({ items }),
      });
      setSavedMsg('Pushed live to TVs!');
      setTimeout(() => setSavedMsg(''), 2500);
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const addSlide = (mediaId: string) => {
    setItems((prev) => [...prev, { media_id: mediaId, duration_sec: 10, transition: 'fade', muted: true }]);
  };

  const moveSlide = (idx: number, dir: -1 | 1) => {
    const next = [...items];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setItems(next);
  };

  const removeSlide = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <select
            value={active?.id || ''}
            onChange={(e) => setSelectedId(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-sm font-semibold text-white"
          >
            {playlists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            onClick={createPlaylist}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            <Plus className="h-4 w-4" /> New Playlist
          </button>
          {playlists.length > 1 && (
            <button
              onClick={deletePlaylist}
              className="rounded-lg p-2 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-400"
              title="Delete playlist"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {savedMsg && (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-400">
              <Sparkles className="h-4 w-4" /> {savedMsg}
            </span>
          )}
          <button
            onClick={saveAll}
            disabled={saving || !active}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Publishing...' : 'Save & Push Live'}
          </button>
        </div>
      </div>

      {active && (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Layout & Theme Settings */}
          <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/70 p-5 lg:col-span-5">
            <h3 className="text-base font-bold text-white">Layout & Signage Theme</h3>

            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Playlist Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Screen Layout</label>
              <div className="grid grid-cols-3 gap-2">
                {(['fullscreen', 'split', 'lbar'] as LayoutType[]).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLayout(l)}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold capitalize ${
                      layout === l
                        ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                        : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {l === 'lbar' ? 'L-Bar + Ticker' : l}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Background Color</label>
                <input
                  type="color"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  className="h-9 w-full cursor-pointer rounded border border-zinc-700 bg-zinc-950"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Accent / Ticker Color</label>
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="h-9 w-full cursor-pointer rounded border border-zinc-700 bg-zinc-950"
                />
              </div>
            </div>

            <div className="flex gap-6 pt-1">
              <label className="flex items-center gap-2 text-sm text-zinc-200">
                <input type="checkbox" checked={showClock} onChange={(e) => setShowClock(e.target.checked)} />
                Show Clock
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-200">
                <input type="checkbox" checked={showBranding} onChange={(e) => setShowBranding(e.target.checked)} />
                Show Branding
              </label>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Branding Title</label>
              <input
                value={brandingTitle}
                onChange={(e) => setBrandingTitle(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
              />
            </div>

            {layout !== 'fullscreen' && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-400">Sidebar Title</label>
                  <input
                    value={sidebarTitle}
                    onChange={(e) => setSidebarTitle(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-400">Sidebar Message</label>
                  <textarea
                    rows={3}
                    value={sidebarBody}
                    onChange={(e) => setSidebarBody(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
                  />
                </div>
              </>
            )}

            {layout === 'lbar' && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-400">Scrolling Ticker Text</label>
                  <input
                    value={tickerText}
                    onChange={(e) => setTickerText(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-400">
                    Ticker Cycle Duration ({tickerSpeed}s — lower is faster)
                  </label>
                  <input
                    type="range"
                    min={10}
                    max={90}
                    value={tickerSpeed}
                    onChange={(e) => setTickerSpeed(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Slides Queue */}
          <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/70 p-5 lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-bold text-white">Playlist Slides ({items.length})</h3>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) addSlide(e.target.value);
                }}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-indigo-300"
              >
                <option value="">+ Add Media Slide...</option>
                {media.map((m) => (
                  <option key={m.id} value={m.id}>
                    [{m.type}] {m.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2.5">
              {items.length === 0 && (
                <div className="rounded-lg border border-dashed border-zinc-700 p-8 text-center text-sm text-zinc-500">
                  No slides in this playlist. Use "+ Add Media Slide" above.
                </div>
              )}
              {items.map((item, idx) => {
                const m = media.find((x) => x.id === item.media_id);
                return (
                  <div
                    key={`${item.media_id}-${idx}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="font-mono text-xs text-zinc-500">#{idx + 1}</span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">{m?.title || item.media_id}</div>
                        <div className="text-xs text-zinc-500 uppercase">{m?.type || 'media'}</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-1 text-xs text-zinc-400">
                        Sec:
                        <input
                          type="number"
                          min={2}
                          max={3600}
                          value={item.duration_sec}
                          onChange={(e) => {
                            const next = [...items];
                            next[idx] = { ...next[idx], duration_sec: Number(e.target.value) };
                            setItems(next);
                          }}
                          className="w-16 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white"
                        />
                      </label>

                      <select
                        value={item.transition}
                        onChange={(e) => {
                          const next = [...items];
                          next[idx] = { ...next[idx], transition: e.target.value as TransitionType };
                          setItems(next);
                        }}
                        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white"
                      >
                        <option value="fade">Fade</option>
                        <option value="slide">Slide</option>
                        <option value="zoom">Zoom</option>
                        <option value="none">None</option>
                      </select>

                      {m?.type === 'video' && (
                        <label className="flex items-center gap-1 text-xs text-zinc-400">
                          <input
                            type="checkbox"
                            checked={item.muted}
                            onChange={(e) => {
                              const next = [...items];
                              next[idx] = { ...next[idx], muted: e.target.checked };
                              setItems(next);
                            }}
                          />
                          Mute
                        </label>
                      )}

                      <button
                        onClick={() => moveSlide(idx, -1)}
                        disabled={idx === 0}
                        className="rounded p-1 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => moveSlide(idx, 1)}
                        disabled={idx === items.length - 1}
                        className="rounded p-1 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => removeSlide(idx)}
                        className="rounded p-1 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
