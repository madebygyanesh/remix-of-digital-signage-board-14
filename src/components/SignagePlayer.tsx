"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { getActivePlaylist, getCurrentPlay, getDisplaySettings, getMedia, MediaItem, PlaylistItem, Playlist, getPlaylists, saveMedia, savePlaylists, setCurrentPlay, uid, getMediaBlob } from "@/lib/signage";
import JSZip from "jszip";

function useInterval(callback: () => void, delay: number | null) {
  const savedRef = useRef(callback);
  useEffect(() => {
    savedRef.current = callback;
  }, [callback]);
  useEffect(() => {
    if (delay === null) return;
    const id = setInterval(() => savedRef.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

export default function SignagePlayer() {
  const [mediaMap, setMediaMap] = useState<Map<string, MediaItem>>(new Map());
  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [index, setIndex] = useState(0);
  const [display, setDisplay] = useState(getDisplaySettings());
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hideTimer = useRef<number | null>(null);
  const nowPlayingBcRef = useRef<BroadcastChannel | null>(null);
  const controlBcRef = useRef<BroadcastChannel | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  // Ref to hold current media name for watermark updates without TDZ
  const currentMediaNameRef = useRef<string>("");

  // Add states for presentation
  const [slides, setSlides] = useState<string[]>([]);
  const [pptxIndex, setPptxIndex] = useState(0);
  const [numSlides, setNumSlides] = useState(0);

  const [blobUrlCache, setBlobUrlCache] = useState<Map<string, string>>(new Map());
  const [currentEffectiveSrc, setCurrentEffectiveSrc] = useState('');

  // Add video progress state
  const [videoProgress, setVideoProgress] = useState({ current: 0, duration: 0 });

  // Mount guard for portal rendering
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Watermark (small, light, image-based, rotates lines every few minutes)
  const WATERMARK_LINES = useMemo(
    () => [
      "madeby.gyanesh AO5K",
      "Ayaan AO5K",
      "IBaad AO5K",
      "Huzaifa AO5K",
      "engineered by Us",
      "Under The Guidance Of Muslim Rangwala (MIR)",
    ],
    []
  );
  const [wmIndex, setWmIndex] = useState(0);
  const [wmUrl, setWmUrl] = useState("");
  const makeWatermarkDataUrl = useCallback((text: string) => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns='http://www.w3.org/2000/svg' width='320' height='64'>
  <rect width='100%' height='100%' fill='none'/>
  <g font-family='Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial' font-size='18'>
    <text x='50%' y='50%' text-anchor='middle' dominant-baseline='middle' fill='black' fill-opacity='0.25'>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>
    <text x='50%' y='50%' text-anchor='middle' dominant-baseline='middle' fill='white' fill-opacity='0.6' dy='-0.6'>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>
  </g>
</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }, []);
  // Initialize and rotate watermark lines every few minutes
  useEffect(() => {
    setWmUrl(makeWatermarkDataUrl(WATERMARK_LINES[wmIndex]));
  }, [makeWatermarkDataUrl, WATERMARK_LINES, wmIndex]);
  useInterval(() => {
    setWmIndex((i) => (i + 1) % WATERMARK_LINES.length);
  }, 5000);

  // Device ID + heartbeat (persistent per-browser tab)
  useEffect(() => {
    try {
      // Ensure persistent device id
      let deviceId = localStorage.getItem("signage:deviceId");
      // If a deviceId is present in the URL and we don't have one yet, adopt it
      try {
        const qs = new URLSearchParams(window.location.search);
        const qId = qs.get("deviceId");
        if (!deviceId && qId) {
          deviceId = qId;
          localStorage.setItem("signage:deviceId", deviceId);
        }
      } catch {}
      if (!deviceId) {
        deviceId = uid("device");
        localStorage.setItem("signage:deviceId", deviceId);
      }
      deviceIdRef.current = deviceId;

      const upsertDevice = (override?: Partial<any>) => {
        const raw = localStorage.getItem("signage:devices");
        const list: any[] = raw ? JSON.parse(raw) : [];
        const idx = list.findIndex((d) => d.id === deviceId);
        const base = {
          id: deviceId,
          name: (override?.name as string) || (localStorage.getItem("signage:deviceName") || "Unnamed Player"),
          userAgent: navigator.userAgent,
          createdAt: Date.now(),
          url: window.location.origin + "/player?deviceId=" + deviceId,
          lastSeen: Date.now(),
          nowPlaying: null as any,
        };
        const nowPlayingRaw = localStorage.getItem("signage:nowPlaying");
        const nowPlaying = nowPlayingRaw ? JSON.parse(nowPlayingRaw) : null;
        const updated = { ...(idx >= 0 ? list[idx] : base), ...override, lastSeen: Date.now(), nowPlaying };
        if (idx >= 0) list[idx] = updated; else list.push(updated);
        localStorage.setItem("signage:devices", JSON.stringify(list));
      };

      // Initial upsert
      upsertDevice();

      // Heartbeat every 5s
      const hb = window.setInterval(() => {
        upsertDevice();
      }, 5000);

      // On unload, update lastSeen one more time
      const onUnload = () => {
        upsertDevice();
      };
      window.addEventListener("beforeunload", onUnload);

      return () => {
        window.clearInterval(hb);
        window.removeEventListener("beforeunload", onUnload);
      };
    } catch {}
  }, []);

  // Main setup effect - removed 100ms polling to prevent unnecessary re-renders and fluctuating
  useEffect(() => {
    const m = new Map(getMedia().map((x) => [x.id, x] as const));
    setMediaMap(m);
    const active = getActivePlaylist();
    const manual = getCurrentPlay();
    setItems(active?.items || []);
    setDisplay(getDisplaySettings());

    // Set initial index based on manual play
    if (manual && active && active.id === manual.playlistId && manual.index >= 0 && manual.index < active.items.length) {
      setIndex(manual.index);
    } else {
      setIndex(0);
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith("signage:")) {
        setTick((t) => t + 1);
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Separate effect for control BroadcastChannel listener
  useEffect(() => {
    let controlBc: BroadcastChannel | null = null;
    try {
      // @ts-ignore
      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        controlBc = new BroadcastChannel("signage-control");
        controlBc.onmessage = (e) => {
          const msg = e.data || {};
          // Targeting: if targetId provided and doesn't match, ignore
          const myId = deviceIdRef.current || localStorage.getItem("signage:deviceId");
          if (msg.targetId && msg.targetId !== myId) return;

          if (msg.type === "setCurrentPlay") {
            const pl = getPlaylists().find(p => p.id === msg.playlistId);
            if (pl && msg.index >= 0 && msg.index < pl.items.length) {
              setItems(pl.items);
              setIndex(msg.index);
              setPaused(false);
              setMediaMap(new Map(getMedia().map((x) => [x.id, x] as const)));

              const currentItem = pl.items[msg.index];
              const freshMedia = getMedia();
              const m = freshMedia.find(x => x.id === currentItem.mediaId);
              if (m) {
                const payload = { id: m.id, name: m.name, type: m.type, src: m.src, at: Date.now() };
                try { localStorage.setItem("signage:nowPlaying", JSON.stringify(payload)); } catch {}
                try { nowPlayingBcRef.current?.postMessage(payload); } catch {}
              }
            }
          }

          if (msg.type === "pause") {
            setPaused(true);
          }
          if (msg.type === "play") {
            setPaused(false);
            // attempt to play video if applicable
            try { if (videoRef.current && videoRef.current.paused) videoRef.current.play().catch(() => {}); } catch {}
          }
          if (msg.type === "next") {
            setPaused(false);
            setIndex((i) => (i + 1) % Math.max(playlistItems.length || 1, 1));
          }
          if (msg.type === "prev") {
            setPaused(false);
            setIndex((i) => (i - 1 + Math.max(playlistItems.length || 1, 1)) % Math.max(playlistItems.length || 1, 1));
          }

          // NEW: persist rename from Admin
          if (msg.type === "rename" && typeof msg.name === "string") {
            try { localStorage.setItem("signage:deviceName", msg.name); } catch {}
            try {
              const raw = localStorage.getItem("signage:devices");
              const list: any[] = raw ? JSON.parse(raw) : [];
              const id = myId;
              const idx = list.findIndex((d) => d.id === id);
              if (idx >= 0) {
                list[idx] = { ...list[idx], name: msg.name };
                localStorage.setItem("signage:devices", JSON.stringify(list));
              }
            } catch {}
          }
        };
      }
    } catch {}

    return () => {
      try { controlBc?.close(); } catch {}
    };
  }, []);

  // Refresh effect: Update items and index based on current state
  useEffect(() => {
    const active = getActivePlaylist();
    const manual = getCurrentPlay();
    setItems(active?.items || []);
    setDisplay(getDisplaySettings());
    setMediaMap(new Map(getMedia().map((x) => [x.id, x] as const)));

    // Set index based on manual play if valid, else 0
    if (manual && active && active.id === manual.playlistId && manual.index >= 0 && manual.index < active.items.length) {
      setIndex(manual.index);
    } else {
      setIndex(0);
    }

    // Normalize index if out of bounds
    if (items.length > 0 && index >= items.length) {
      setIndex(0);
    }
  }, [tick]);

  // Build a fallback list from all media when there is no active playlist
  const playlistItems: PlaylistItem[] = useMemo(() => {
    if (items.length > 0) return items;
    if (mediaMap.size === 0) return [];
    return Array.from(mediaMap.values()).map((m) => ({
      id: `fallback_${m.id}`,
      mediaId: m.id,
      duration: m.duration,
    }));
  }, [items, mediaMap]);

  // Select the first playable item (skip entries whose media is missing)
  const playlistLen = playlistItems.length;
  const { currentIndex, current, currentMedia } = useMemo(() => {
    if (playlistLen === 0) return { currentIndex: 0, current: undefined, currentMedia: undefined as MediaItem | undefined };
    let i = index % Math.max(playlistLen || 1, 1);
    let attempts = 0;
    while (attempts < playlistLen) {
      const c = playlistItems[i];
      const m = mediaMap.get(c.mediaId);
      if (m) return { currentIndex: i, current: c, currentMedia: m };
      i = (i + 1) % playlistLen;
      attempts++;
    }
    return { currentIndex: 0, current: undefined, currentMedia: undefined as MediaItem | undefined };
  }, [index, playlistItems, mediaMap, playlistLen]);

  // After currentMedia is computed, sync its name to ref and update watermark
  useEffect(() => {
    currentMediaNameRef.current = currentMedia?.name || "";
  }, [currentMedia?.name]);

  // If our computed currentIndex differs (due to skipped invalid items), align state index
  useEffect(() => {
    if (playlistLen > 0 && current && currentIndex !== index) {
      setIndex(currentIndex);
    }
  }, [currentIndex, index, playlistLen, current]);

  const explicitDuration = current?.duration ?? currentMedia?.duration;
  // For videos: only use explicit duration if provided; otherwise no default (play full length)
  // For non-video: fallback to 8s default
  const duration = explicitDuration ?? (currentMedia?.type === "video" ? undefined : 8);
  const src = currentMedia?.src || '';

  // Derived type helpers
  const isPresentation = currentMedia?.type === "presentation";
  const isPdf = currentMedia?.type === "web" && /\.pdf($|\?)/i.test(src);
  const isOfficeDoc = currentMedia?.type === "web" && /\.(docx?|xlsx?)($|\?)/i.test(src);
  const isHttpUrl = /^https?:\/\//i.test(src);

  // goNext callback
  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % Math.max(playlistItems.length || 1, 1));
  }, [playlistItems.length]);

  // handleLoopOrTrim useCallback - defined early with proper parens for ?? and logical operators
  const handleLoopOrTrim = useCallback(() => {
    if (!videoRef.current || !current || !currentMedia) return () => {};
    const video = videoRef.current;
    const seekTo = (current.startSec ?? 0);
    const hasTrim = current.endSec !== undefined && current.endSec > seekTo;
    const shouldLoop = Boolean((currentMedia.loop ?? false));
    const startSec = seekTo;
    const endSec = (current.endSec ?? (video.duration || Infinity));

    const handleTimeUpdate = () => {
      const currentTime = video.currentTime;
      if (hasTrim && currentTime >= endSec) {
        if (shouldLoop) {
          video.currentTime = startSec;
          video.play().catch(() => {});
        } else {
          goNext();
        }
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => video.removeEventListener('timeupdate', handleTimeUpdate);
  }, [current, currentMedia, goNext]);

  // Update progress for video
  useEffect(() => {
    if (!videoRef.current || currentMedia?.type !== "video") return;

    const video = videoRef.current;
    const updateProgress = () => {
      const start = current?.startSec ?? 0;
      const end = (current?.endSec ?? video.duration);
      const effectiveDuration = end - start;
      const effectiveCurrent = Math.max(0, video.currentTime - start);
      setVideoProgress({
        current: effectiveCurrent,
        duration: effectiveDuration
      });
    };

    video.addEventListener('timeupdate', updateProgress);
    video.addEventListener('loadedmetadata', () => {
      setVideoProgress({ current: 0, duration: video.duration || 0 });
    });

    return () => {
      video.removeEventListener('timeupdate', updateProgress);
      video.removeEventListener('loadedmetadata', updateProgress);
    };
  }, [currentMedia, current]);

  // Load slides for presentation
  useEffect(() => {
    if (!isPresentation || !src) {
      setSlides([]);
      setNumSlides(0);
      setPptxIndex(0);
      return;
    }
    getMediaBlob(currentMedia.id).then(blob => {
      if (!blob) {
        setSlides(['Error: No media blob']);
        setNumSlides(1);
        return;
      }
      JSZip.loadAsync(blob).then(zip => {
        const slideFiles = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
        const slidePromises = slideFiles.map(async (name) => {
          const xmlStr = await zip.file(name)!.async('string');
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(xmlStr, 'text/xml');
          const textNodes = xmlDoc.querySelectorAll('a\\:t, t'); // a:t for text
          let slideText = Array.from(textNodes).map(t => t.textContent || '').filter(Boolean).join('\n');
          slideText = slideText.replace(/\n\s*\n/g, '<br><br>').replace(/\n/g, ' ');
          return slideText || 'No content on this slide';
        });
        Promise.all(slidePromises).then(textSlides => {
          setSlides(textSlides);
          setNumSlides(textSlides.length);
          setPptxIndex(0);
        }).catch(err => {
          console.error('Failed to parse slides:', err);
          setSlides(['Error loading presentation']);
          setNumSlides(1);
        });
      }).catch(err => {
        console.error('Failed to load PPTX:', err);
        setSlides(['Error loading presentation']);
        setNumSlides(1);
      });
    }).catch(err => {
      console.error('Failed to load media blob:', err);
      setSlides(['Error loading presentation']);
      setNumSlides(1);
    });
  }, [currentMedia?.id, src]);

  // Advance slides for presentation
  useInterval(() => {
    if (!isPresentation || numSlides === 0 || paused) return;
    const perSlideMs = ((current?.duration ?? 15) / numSlides) * 1000;
    setPptxIndex(i => (i + 1) % numSlides);
  }, isPresentation ? ((current?.duration ?? 15) / numSlides) * 1000 : null);

  // Reset index on media change
  useEffect(() => {
    if (isPresentation) setPptxIndex(0);
  }, [currentMedia?.id, isPresentation]);

  // Broadcast now playing when media changes
  useEffect(() => {
    let payloadName = currentMedia?.name || '';
    if (isPresentation && numSlides > 0) {
      payloadName += ` - Slide ${pptxIndex + 1}/${numSlides}`;
    }
    const payload = currentMedia
      ? { id: currentMedia.id, name: payloadName, type: currentMedia.type, src: src, at: Date.now() }
      : null;
    try {
      localStorage.setItem("signage:nowPlaying", JSON.stringify(payload));
    } catch {}
    try {
      nowPlayingBcRef.current?.postMessage(payload);
    } catch {}
  }, [currentMedia?.id, isPresentation, pptxIndex, numSlides, src]);

  // Update the useEffect for currentEffectiveSrc
  useEffect(() => {
    if (!currentMedia) {
      setCurrentEffectiveSrc('');
      return;
    }
    if (!currentMedia.src.startsWith('local:')) {
      setCurrentEffectiveSrc(currentMedia.src);
      return;
    }
    // local async
    const loadLocalSrc = async () => {
      // Do not set to empty to avoid flicker; keep previous until ready
      let url = blobUrlCache.get(currentMedia.id);
      if (!url) {
        const blob = await getMediaBlob(currentMedia.id);
        if (!blob) {
          // Failed load, advance to next
          setTimeout(() => goNext(), 1000);
          setCurrentEffectiveSrc(''); // Set empty only on failure
          return;
        }
        const createdUrl = URL.createObjectURL(blob);
        url = createdUrl;
        setBlobUrlCache(prev => {
          const newMap = new Map(prev);
          newMap.set(currentMedia.id, createdUrl);
          return newMap;
        });
      }
      setCurrentEffectiveSrc(url || '');
    };
    loadLocalSrc();
  }, [currentMedia?.id, blobUrlCache]);

  // Sync video element volume/mute and ensure play on load - now can safely call handleLoopOrTrim
  useEffect(() => {
    if (!currentMedia || currentMedia.type !== "video" || !videoRef.current) return;
    const video = videoRef.current;
    video.volume = (currentMedia.volume ?? 1);
    video.muted = Boolean((currentMedia.mute ?? false));

    if (currentEffectiveSrc && video.src !== currentEffectiveSrc) {
      video.src = currentEffectiveSrc;
    }

    const seekTo = (current?.startSec ?? 0);
    const hasTrim = current?.endSec !== undefined && current.endSec > seekTo;
    const startSec = seekTo;
    const endSec = (current?.endSec ?? (video.duration || Infinity));

    const handleLoadedMetadata = () => {
      video.currentTime = Math.min(seekTo, video.duration || Infinity);
      if (!paused) {
        video.play().catch(() => {});
      }
    };

    const handleCanPlay = () => {
      if (!paused && video.paused) {
        video.play().catch((e) => console.warn("Play attempt failed:", e));
      }
    };

    const forceAutoplayAndTrim = () => {
      if (video.readyState >= 2) {
        video.currentTime = seekTo;
        if (!paused && video.paused) {
          video.play();
        }
      }
    };

    const loopCleanup = handleLoopOrTrim();

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener('loadeddata', forceAutoplayAndTrim);
    video.addEventListener("loadstart", () => (video.currentTime = seekTo));
    video.loop = (!hasTrim && Boolean((currentMedia.loop ?? false)));

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener('loadeddata', forceAutoplayAndTrim);
      video.removeEventListener("loadstart", () => {});
      loopCleanup();
      if (video.loop) video.loop = false;
    };
  }, [currentMedia, current, paused, currentEffectiveSrc, handleLoopOrTrim, goNext]);

  // Update auto-advance to always run for all media types
  // - For videos without explicit duration: do not auto-advance on a timer; rely on onEnded or trim handler
  // - For videos with explicit duration: honor it
  // - For non-videos: use duration (default 8s)
  const autoAdvanceMs = currentMedia
    ? (currentMedia.type === "video"
        ? (typeof (explicitDuration) === "number" ? explicitDuration * 1000 : null)
        : ((duration ?? 8) * 1000))
    : null;

  useInterval(
    () => {
      if (!currentMedia || paused) return;
      setIndex((i) => (i + 1) % Math.max(playlistItems.length || 1, 1));
    },
    autoAdvanceMs
  );

  useEffect(() => {
    if (playlistItems.length > 0 && index >= playlistItems.length) {
      setIndex(0);
    }
  }, [playlistItems.length]);

  // controls visibility on mouse move/touch
  const bumpControls = () => {
    setShowControls(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setShowControls(false), 2000);
  };

  useEffect(() => {
    bumpControls();
  }, [currentMedia?.id]);

  const wrapperStyle: React.CSSProperties = useMemo(() => {
    const bright = Math.max(0, Math.min(100, display.brightness)) / 100;
    const base: React.CSSProperties = {
      width: "100vw",
      height: "100vh",
      overflow: "hidden",
      backgroundColor: "black",
      filter: `brightness(${bright})`,
      position: "relative",
    };
    if (display.orientation === "portrait") {
      return {
        ...base,
        transform: "rotate(90deg)",
        transformOrigin: "center",
      };
    }
    return base;
  }, [display]);

  const powerOffOverlay: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "black",
    zIndex: 50,
    display: display.power === "off" ? "block" : "none",
  };

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + Math.max(playlistItems.length || 1, 1)) % Math.max(playlistItems.length || 1, 1));
  }, [playlistItems.length]);

  const togglePause = () => setPaused((p) => !p);
  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
  };

  // At the end, before return, add cleanup
  useEffect(() => {
    return () => {
      blobUrlCache.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  return (
    <div
      style={wrapperStyle}
      className="bg-black"
      onMouseMove={bumpControls}
      onTouchStart={bumpControls}
    >
      {!currentMedia ? (
        <div className="w-full h-full text-white flex items-center justify-center">
          No active playlist or media.
        </div>
      ) : currentMedia.src.startsWith('local:') && !currentEffectiveSrc ? (
        <div className="w-full h-full bg-black flex items-center justify-center text-white text-lg">
          Loading {currentMedia.name}...
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          {currentMedia.type === "image" && (
            <img src={currentEffectiveSrc} alt={currentMedia.name} className="w-full h-full object-contain" />
          )}

          {/* Web pages or PDFs/Docs via iframe */}
          {currentMedia.type === "web" && !isPdf && !isOfficeDoc && (
            <iframe src={currentEffectiveSrc} className="w-full h-full" title={currentMedia.name} />
          )}

          {/* PDF support */}
          {isPdf && (
            <iframe src={currentEffectiveSrc} className="w-full h-full" title={currentMedia.name || "PDF"} />
          )}

          {/* Office Docs (DOCX/XLSX) via online viewers when possible */}
          {isOfficeDoc && !isPresentation && (
            currentMedia.src.startsWith('http') ? (
              <iframe
                src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(currentEffectiveSrc)}`}
                className="w-full h-full"
                title={currentMedia.name || "Document"}
              />
            ) : (
              <div className="w-full h-full text-white flex items-center justify-center p-6 text-center">
                This document requires a public URL (DOCX/XLSX). PPTX is rendered locally above.
              </div>
            )
          )}

          {isPresentation && numSlides > 0 ? (
            <div className="w-full h-full flex items-center justify-center p-6 bg-black">
              <div className="max-w-4xl mx-auto text-center text-white text-2xl leading-relaxed" dangerouslySetInnerHTML={{ __html: slides[pptxIndex] }} />
            </div>
          ) : isPresentation ? (
            <div className="w-full h-full bg-black flex items-center justify-center text-white">
              Loading presentation slides...
            </div>
          ) : null}

          {currentMedia.type === "video" && (
            <video
              ref={videoRef}
              src={currentEffectiveSrc}
              className="w-full h-full object-contain"
              autoPlay={!!currentEffectiveSrc}
              preload={currentMedia.src.startsWith("http") ? "auto" : "metadata"}
              playsInline
              muted={!!currentMedia.mute}
              controls={false}
              crossOrigin={currentMedia.src.startsWith("http") ? "anonymous" : undefined}
              onCanPlay={() => {
                if (videoRef.current && !paused && videoRef.current.paused) {
                  videoRef.current.play().catch((e) => console.warn("Autoplay failed:", e));
                }
              }}
              onEnded={() => {
                // If loop segment, handled in timeupdate; if native loop, onEnded won't fire
                const shouldLoop = Boolean((currentMedia.loop ?? false));
                const hasTrim = current?.endSec !== undefined && current.endSec > (current?.startSec ?? 0);
                if (!shouldLoop && !hasTrim) {
                  goNext();
                }
              }}
              onError={(e) => {
                console.error("Video load error:", e);
                setTimeout(() => goNext(), 2000);
              }}
            />
          )}
        </div>
      )}

      {/* Watermark overlay via portal (top-right, above filters/iframes) */}
      {mounted && currentMedia && wmUrl
        ? createPortal(
            <img
              src={wmUrl}
              alt="watermark"
              className="pointer-events-none select-none fixed top-3 right-3 w-96 max-w-[45vw] opacity-25 z-[2147483647] drop-shadow-sm"
              draggable={false}
            />,
            document.body
          )
        : null}

      <div style={powerOffOverlay} />
    </div>
  );
}