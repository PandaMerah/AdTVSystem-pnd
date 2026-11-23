export type MediaType = 'image' | 'video' | 'web';
export type LayoutType = 'fullscreen' | 'split' | 'lbar';
export type TransitionType = 'fade' | 'slide' | 'zoom' | 'none';

export interface MediaItem {
  id: string;
  title: string;
  type: MediaType;
  url: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number;
  created_at: number;
}

export interface PlaylistItem {
  id: string;
  playlist_id: string;
  media_id: string;
  sort_order: number;
  duration_sec: number;
  transition: TransitionType;
  muted: number;
  title: string;
  type: MediaType;
  url: string;
  mime_type: string | null;
}

export interface Playlist {
  id: string;
  name: string;
  layout: LayoutType;
  ticker_text: string;
  ticker_speed: number;
  bg_color: string;
  accent_color: string;
  show_clock: number;
  show_branding: number;
  branding_title: string;
  sidebar_title: string;
  sidebar_body: string;
  revision: string;
  updated_at: number;
  items: PlaylistItem[];
}

export interface Device {
  id: string;
  name: string;
  location: string;
  playlist_id: string | null;
  version_code: number;
  version_name: string;
  is_device_owner: number;
  ip_address: string;
  resolution: string;
  current_slide: string;
  last_seen: number;
  online?: boolean;
  sseConnected?: boolean;
}

export interface ApkRelease {
  id: string;
  version_code: number;
  version_name: string;
  filename: string;
  download_url?: string | null;
  size_bytes: number;
  sha256: string;
  changelog: string;
  mandatory: number;
  created_at: number;
}

export interface PlayerConfig {
  device: Device;
  playlist: Playlist | null;
  serverTime: number;
}
