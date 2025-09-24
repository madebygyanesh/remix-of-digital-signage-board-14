export type MediaType = "image" | "video" | "web" | "presentation";

export type MediaItem = {
  id: string;
  type: MediaType;
  name: string;
  src: string; // data URL, http(s) URL, or iframe URL for web
  duration?: number; // seconds fallback (images/web)
  mute?: boolean;
  volume?: number; // 0-1 for videos
  loop?: boolean; // for videos to loop until manual advance
};

export type PlaylistItem = {
  id: string; // unique id for this playlist item
  mediaId: string;
  duration?: number; // override in seconds
  startSec?: number; // for video trim start in seconds
  endSec?: number; // for video trim end in seconds
};

export type Schedule = {
  days?: number[]; // 0-6 (Sun-Sat)
  start?: string; // "HH:MM" 24h
  end?: string;   // "HH:MM" 24h
};

export type Playlist = {
  id: string;
  name: string;
  items: PlaylistItem[];
  schedule?: Schedule; // optional schedule
};

export type DisplaySettings = {
  orientation: "landscape" | "portrait";
  brightness: number; // 0-100
  power: "on" | "off";
};

const MEDIA_KEY = "signage:media";
const PLAYLISTS_KEY = "signage:playlists";
const DISPLAY_KEY = "signage:display";

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

// Media
export function getMedia(): MediaItem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(MEDIA_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveMedia(list: MediaItem[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(MEDIA_KEY, JSON.stringify(list));
  } catch (e: any) {
    // Prevent app crash when storage quota is exceeded (e.g., large data URLs)
    // We swallow the error and log a warning to keep UI functional.
    // Consumers can decide to reduce items or switch to URL-based media.
    console.warn("[signage] Failed to persist media to localStorage:", e?.name || e);
  }
}

// Change: upload to server and return a URL; fallback to IndexedDB if API fails
export async function saveMediaBlob(key: string, blob: Blob, name?: string): Promise<string> {
  try {
    const fd = new FormData();
    fd.append("file", blob);
    fd.append("id", key);
    if (name) fd.append("name", name);
    const res = await fetch("/api/media/upload", { method: "POST", body: fd });
    if (res.ok) {
      const data = await res.json();
      if (data?.url) return data.url as string;
    }
    // fallthrough to fallback
  } catch (e) {
    console.warn("[signage] Server upload failed, falling back to IndexedDB:", e);
  }
  // Fallback: persist to IndexedDB and use local: scheme when available; else inline data URL
  try {
    const db = await getDb();
    await db.put('blobs', blob, `media-blob-${key}`);
    return `local:${key}`;
  } catch {
    // As a last resort, return a data URL so the media can still be used without IDB
    try {
      return await blobToDataURL(blob);
    } catch {
      return `local:${key}`;
    }
  }
}

// Enhanced: fetch blob from server when media src is a URL; fallback to IndexedDB by key
export async function getMediaBlob(key: string): Promise<Blob | undefined> {
  try {
    // Try resolve via media list mapping first
    const list = getMedia();
    const m = Array.isArray(list) ? list.find(x => x.id === key) : undefined;
    if (m && typeof m.src === 'string') {
      if (m.src.startsWith('/uploads/') || /^https?:\/\//i.test(m.src)) {
        const res = await fetch(m.src);
        if (res.ok) return await res.blob();
      }
      if (m.src.startsWith('data:')) {
        // Convert data URL to blob
        const resp = await fetch(m.src);
        return await resp.blob();
      }
    }
  } catch (e) {
    console.warn('[signage] Failed to fetch media via src mapping, falling back to IDB:', e);
  }
  // Fallback to IndexedDB by key
  try {
    const db = await getDb();
    return await db.get('blobs', `media-blob-${key}`);
  } catch {
    return undefined;
  }
}

// Delete by src (server) or key (IndexedDB) for backward compatibility
export async function deleteMediaBlob(keyOrSrc: string) {
  try {
    if (keyOrSrc.startsWith('/uploads/') || keyOrSrc.includes('/uploads/')) {
      await fetch('/api/media/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src: keyOrSrc }),
      });
      return;
    }
  } catch (e) {
    console.warn('[signage] Server delete failed or not applicable, falling back to IDB:', e);
  }
  const key = keyOrSrc.replace(/^local:/, '');
  try {
    const db = await getDb();
    await db.delete('blobs', `media-blob-${key}`);
  } catch {
    // ignore when IDB unavailable
  }
}

// Playlists
export function getPlaylists(): Playlist[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(PLAYLISTS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function savePlaylists(list: Playlist[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(list));
  } catch (e: any) {
    console.warn("[signage] Failed to persist playlists to localStorage:", e?.name || e);
  }
}

// Display
export function getDisplaySettings(): DisplaySettings {
  if (typeof window === "undefined") return { orientation: "landscape", brightness: 100, power: "on" };
  try {
    return (
      JSON.parse(localStorage.getItem(DISPLAY_KEY) || "null") || {
        orientation: "landscape",
        brightness: 100,
        power: "on",
      }
    );
  } catch {
    return { orientation: "landscape", brightness: 100, power: "on" };
  }
}

export function saveDisplaySettings(settings: DisplaySettings) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify(settings));
  } catch (e: any) {
    console.warn("[signage] Failed to persist display settings to localStorage:", e?.name || e);
  }
}

export function getCurrentPlay(): {playlistId: string, index: number} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("signage:currentPlay");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setCurrentPlay(playlistId: string, index: number) {
  if (typeof window === "undefined") return;
  try {
    const payload = {playlistId, index};
    localStorage.setItem("signage:currentPlay", JSON.stringify(payload));
    
    // Add this line to trigger immediate refresh in player via storage event
    localStorage.setItem("signage:tick", Date.now().toString());
    
    let bc: BroadcastChannel | null = null;
    try {
      // @ts-ignore
      if ("BroadcastChannel" in window) {
        bc = new BroadcastChannel("signage-control");
        bc.postMessage({type: "setCurrentPlay", ...payload});
      }
    } catch {}
    try { bc?.close(); } catch {}
  } catch (e: any) {
    console.warn("[signage] Failed to set current play:", e?.name || e);
  }
}

export function timeInRange(now: Date, start?: string, end?: string): boolean {
  if (!start && !end) return true;
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const n = now.getHours() * 60 + now.getMinutes();
  const s = start ? toMin(start) : 0;
  const e = end ? toMin(end) : 24 * 60;
  if (s <= e) return n >= s && n <= e;
  // overnight window (e.g., 22:00 - 06:00)
  return n >= s || n <= e;
}

export function scheduleMatches(schedule?: Schedule, now = new Date()): boolean {
  if (!schedule) return true;
  const day = now.getDay();
  const dayOk = !schedule.days || schedule.days.length === 0 || schedule.days.includes(day);
  const timeOk = timeInRange(now, schedule.start, schedule.end);
  return dayOk && timeOk;
}

export function getActivePlaylist(now = new Date()): Playlist | undefined {
  const manual = getCurrentPlay();
  if (manual) {
    const lists = getPlaylists();
    const pl = lists.find((p) => p.id === manual.playlistId);
    if (pl && pl.items.length > manual.index) {
      return pl;
    }
  }
  const lists = getPlaylists();
  // prefer first scheduled match, else first playlist
  const scheduled = lists.find((p) => scheduleMatches(p.schedule, now) && p.items.length > 0);
  return scheduled || lists.find((p) => p.items.length > 0);
}

// Lazy IndexedDB initialization to avoid SSR/prerender errors
let __dbPromise: Promise<any> | null = null;
async function getDb() {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB unavailable in this environment');
  }
  if (!__dbPromise) {
    const { openDB } = await import('idb');
    __dbPromise = openDB('signage-db', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('blobs')) {
          db.createObjectStore('blobs');
        }
      },
    });
  }
  return __dbPromise;
}

async function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => resolve(String(fr.result));
    fr.readAsDataURL(blob);
  });
}