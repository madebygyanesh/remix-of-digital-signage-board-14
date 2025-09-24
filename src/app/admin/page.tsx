"use client";

export const dynamic = "force-dynamic";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableCaption } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getDisplaySettings, getMedia, getPlaylists, MediaItem, Playlist, saveDisplaySettings, saveMedia, savePlaylists, uid, setCurrentPlay, saveMediaBlob, deleteMediaBlob, getMediaBlob } from "@/lib/signage";
import { toast } from "sonner";
import { Volume, VolumeX, X, Menu, LayoutGrid, List as ListIcon, Play, Trash2, Info, Upload, Plus, Settings, Calendar as CalendarIcon, ChevronLeft, ChevronRight, Power } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

function useLocal<T>(getter: () => T, setter: (val: T) => void) {
  const [state, setState] = useState<T>(getter());
  useEffect(() => {
    setter(state);
  }, [state]);
  return [state, setState] as const;
}

export default function AdminPage() {
  const [media, setMedia] = useLocal<MediaItem[]>(getMedia, saveMedia);
  const [playlists, setPlaylists] = useLocal<Playlist[]>(getPlaylists, savePlaylists);
  const [display, setDisplay] = useLocal(getDisplaySettings, saveDisplaySettings);
  const [dragActive, setDragActive] = useState(false);
  // Persisted UI state
  const [showNowPlaying, setShowNowPlaying] = useState<boolean>(() => {
    try { return (localStorage.getItem("admin:showNowPlaying") ?? "1") !== "0"; } catch { return true; }
  });
  // New UI state
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("admin:sidebarCollapsed") === "1"; } catch { return false; }
  });
  const [activeSection, setActiveSection] = useState<"library"|"playlists"|"schedule"|"display"|"devices">(() => {
    try { return (localStorage.getItem("admin:activeSection") as any) || "library"; } catch { return "library"; }
  });
  const [mediaView, setMediaView] = useState<"grid"|"list">(() => {
    try { return (localStorage.getItem("admin:mediaView") as any) || "list"; } catch { return "list"; }
  });
  const [confirmRemoveMedia, setConfirmRemoveMedia] = useState<MediaItem | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [scheduleView, setScheduleView] = useState<"weekly" | "daily">(() => {
    try { return (localStorage.getItem("admin:scheduleView") as any) || "daily"; } catch { return "daily"; }
  });
  const [compact, setCompact] = useState<boolean>(() => {
    try { return (localStorage.getItem("admin:compact") ?? "1") === "1"; } catch { return true; }
  });
  // Rename device dialog state
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Persist UI prefs whenever they change
  useEffect(() => {
    try {
      localStorage.setItem("admin:showNowPlaying", showNowPlaying ? "1" : "0");
      localStorage.setItem("admin:sidebarCollapsed", sidebarCollapsed ? "1" : "0");
      localStorage.setItem("admin:mediaView", mediaView);
      localStorage.setItem("admin:scheduleView", scheduleView);
      localStorage.setItem("admin:compact", compact ? "1" : "0");
      localStorage.setItem("admin:activeSection", activeSection);
    } catch {}
  }, [showNowPlaying, sidebarCollapsed, mediaView, scheduleView, compact, activeSection]);

  // Swipe navigation (mobile)
  const swipeContainerRef = useRef<HTMLDivElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const el = swipeContainerRef.current;
    if (!el) return;
    const onTouchStart = (e: TouchEvent) => {
      if (window.innerWidth >= 640) return; // only on mobile
      const t = e.touches[0];
      touchStartRef.current = { x: t.clientX, y: t.clientY };
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (window.innerWidth >= 640) return;
      if (!touchStartRef.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStartRef.current.x;
      const dy = t.clientY - touchStartRef.current.y;
      touchStartRef.current = null;
      // ignore mostly vertical swipes
      if (Math.abs(dy) > Math.abs(dx)) return;
      const threshold = 60;
      if (Math.abs(dx) < threshold) return;
      const order = ["library","playlists","schedule","display","devices"] as const;
      const idx = order.indexOf(activeSection as any);
      let nextIdx = idx;
      if (dx < 0 && idx < order.length - 1) nextIdx = idx + 1; // swipe left → next
      if (dx > 0 && idx > 0) nextIdx = idx - 1; // swipe right → prev
      if (nextIdx !== idx) {
        const next = order[nextIdx] as typeof order[number];
        setActiveSection(next as any);
        const el = document.getElementById(`section-${next}`);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
        // subtle haptic feedback on successful swipe
        try { (navigator as any)?.vibrate?.(8); } catch {}
      }
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart as any);
      el.removeEventListener("touchend", onTouchEnd as any);
    };
  }, [activeSection]);

  // Auto-highlight sidebar tab based on scroll position (desktop & mobile)
  useEffect(() => {
    const ids = ["library", "playlists", "schedule", "display", "devices"];
    const targets = ids
      .map((id) => document.getElementById(`section-${id}`))
      .filter(Boolean) as HTMLElement[];
    if (!targets.length) return;

    let ticking = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (ticking) return;
        ticking = true;
        // Pick the top-most visible section
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (a.target as HTMLElement).offsetTop - (b.target as HTMLElement).offsetTop);
        if (visible[0]) {
          const id = (visible[0].target as HTMLElement).id.replace("section-", "");
          setActiveSection(id as any);
        }
        requestAnimationFrame(() => (ticking = false));
      },
      { root: null, rootMargin: "-40% 0px -50% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, []);

  // Devices registry (from localStorage written by players)
  const [devices, setDevices] = useState<any[]>([]);
  useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem("signage:devices");
        const list: any[] = raw ? JSON.parse(raw) : [];
        list.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
        setDevices(list);
      } catch {
        setDevices([]);
      }
    };
    read();

    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.startsWith("signage:")) read();
    };
    window.addEventListener("storage", onStorage);

    const iv = window.setInterval(read, 5000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(iv);
    };
  }, []);

  // alias to ensure stable reference in JSX
  const crm = confirmRemoveMedia;

  // Now Playing widget state (sync with Player)
  const [nowPlaying, setNowPlaying] = useState<{
    id: string;
    name: string;
    type: string;
    src: string;
    at: number;
  } | null>(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem("signage:nowPlaying") : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.name && parsed.name.includes("Big Buck Bunny")) {
          localStorage.removeItem("signage:nowPlaying");
          return null;
        }
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  });
  const [npPos, setNpPos] = useState<{ x: number; y: number }>(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem("admin:np:pos") : null;
      return raw ? JSON.parse(raw) : { x: 16, y: 16 };
    } catch {
      return { x: 16, y: 16 };
    }
  });
  const [draggingNP, setDraggingNP] = useState(false);
  const dragNPRef = useRef({ dx: 0, dy: 0 });

  useEffect(() => {
    // Polling for robust sync (ensures updates in same tab)
    const pollInterval = setInterval(() => {
      try {
        const raw = localStorage.getItem("signage:nowPlaying");
        setNowPlaying(raw ? JSON.parse(raw) : null);
      } catch {}
    }, 500);

    return () => clearInterval(pollInterval);
  }, []);

  useEffect(() => {
    // Subscribe to BroadcastChannel from Player
    let bc: BroadcastChannel | null = null;
    try {
      // @ts-ignore BroadcastChannel support check
      bc = typeof window !== "undefined" && "BroadcastChannel" in window ? new BroadcastChannel("signage-now-playing") : null;
      if (bc) bc.onmessage = (ev) => setNowPlaying(ev.data || null);
    } catch {}

    // Fallback via storage events
    const onStorage = (e: StorageEvent) => {
      if (e.key === "signage:nowPlaying") {
        try {
          setNowPlaying(e.newValue ? JSON.parse(e.newValue) : null);
        } catch {}
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      try { bc?.close(); } catch {}
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("admin:np:pos", JSON.stringify(npPos));
    } catch {}
  }, [npPos]);

  useEffect(() => {
    if (!draggingNP) return;
    const onMouseMove = (e: MouseEvent) => {
      setNpPos({ x: Math.max(0, e.clientX - dragNPRef.current.dx), y: Math.max(0, e.clientY - dragNPRef.current.dy) });
    };
    const onMouseUp = () => setDraggingNP(false);
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      setNpPos({ x: Math.max(0, t.clientX - dragNPRef.current.dx), y: Math.max(0, t.clientY - dragNPRef.current.dy) });
    };
    const onTouchEnd = () => setDraggingNP(false);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [draggingNP]);

  const startDragNP = (clientX: number, clientY: number) => {
    dragNPRef.current.dx = clientX - npPos.x;
    dragNPRef.current.dy = clientY - npPos.y;
    setDraggingNP(true);
  };

  // Auth gate
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [showChangePass, setShowChangePass] = useState(false);
  const [currentPassInput, setCurrentPassInput] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  useEffect(() => {
    setAuthed(typeof window !== "undefined" && sessionStorage.getItem("admin:authed") === "1");
  }, []);
  const handleLogin = () => {
    const MAGIC_PASSWORD = "AIAKRP@1234";
    const currentStored = typeof window !== "undefined" ? localStorage.getItem("admin:password") || "admin" : "admin";
    if (password === MAGIC_PASSWORD) {
      localStorage.setItem("admin:password", "admin");
      toast.success("Default password has been reset to 'admin'");
      sessionStorage.setItem("admin:authed", "1");
      setAuthed(true);
      setPassword("");
    } else if (password === currentStored) {
      sessionStorage.setItem("admin:authed", "1");
      setAuthed(true);
    } else {
      toast.error("Invalid password");
    }
  };

  // Add this useEffect after the auth useEffect and handleLogin
  useEffect(() => {
    if (authed && nowPlaying && nowPlaying.name.includes("Big Buck Bunny")) {
      setNowPlaying(null);
      localStorage.removeItem("signage:nowPlaying");
      toast.info("Cleared sample video from now playing.");
    }
  }, [nowPlaying, authed]);

  // MEDIA
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files);
    const newItems: MediaItem[] = [];
    let skippedOffice = 0;
    let skippedLarge = 0;
    const MAX_FILE_SIZE = 300 * 1024 * 1024; // 300MB limit
    for (const f of arr) {
      // simulate progressive upload indicator
      setUploadProgress((p) => ({ ...p, [f.name]: 10 }));
      if (f.size > MAX_FILE_SIZE) {
        skippedLarge++;
        setUploadProgress((p) => ({ ...p, [f.name]: 100 }));
        continue;
      }
      const isImage = f.type.startsWith("image");
      const isVideo = f.type.startsWith("video");
      const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
      const officeMimes = new Set([
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
      ]);
      const isOffice = officeMimes.has(f.type) || /\.(pptx?|docx?|xlsx?)$/i.test(f.name);
      const isPptx = /\.(?:pptx|ppt)$/i.test(f.name) || (officeMimes.has(f.type) && f.type.includes('presentationml'));

      const id = uid("media");
      try {
        const uploadedSrc = await saveMediaBlob(id, f, f.name);
        setUploadProgress((p) => ({ ...p, [f.name]: 70 }));
        if (isPptx) {
          newItems.push({ id, type: "presentation", name: f.name, src: uploadedSrc, duration: 15 });
        } else if (isOffice) {
          skippedOffice++;
          await deleteMediaBlob(uploadedSrc); // cleanup uploaded server file
        } else if (isVideo) {
          newItems.push({ id, type: "video", name: f.name, src: uploadedSrc, mute: true, volume: 1, loop: false });
        } else if (isImage) {
          newItems.push({ id, type: "image", name: f.name, src: uploadedSrc, duration: 8 });
        } else if (isPdf) {
          newItems.push({ id, type: "web", name: f.name, src: uploadedSrc, duration: 15 });
        } else {
          newItems.push({ id, type: "web", name: f.name, src: uploadedSrc, duration: 15 });
        }
      } catch (e) {
        console.warn("Failed to store media blob:", e);
        skippedLarge++;
      }
      setUploadProgress((p) => ({ ...p, [f.name]: 100 }));
    }

    if (skippedOffice > 0) {
      toast.warning(`${skippedOffice} non-PPTX Office document${skippedOffice > 1 ? "s" : ""} skipped. Only PPTX supported locally; others need public URL.`);
    }

    if (skippedLarge > 0) {
      toast.warning(`${skippedLarge} large file${skippedLarge > 1 ? 's' : ''} skipped (>300MB).`);
    }

    if (newItems.length) {
      setMedia([...media, ...newItems]);
      toast.success(`Added ${newItems.length} item${newItems.length > 1 ? "s" : ""}`);
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
    // clear progress after a short delay
    setTimeout(() => setUploadProgress({}), 600);
  };

  const addWebContent = (url: string) => {
    if (!url) return;
    try {
      let processedUrl = url;
      // Detect and convert YouTube watch URLs to embed for proper iframe support
      const youtubeMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
      if (youtubeMatch) {
        const videoId = youtubeMatch[1];
        processedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=0&playsinline=1&rel=0`;
      }
      const u = new URL(processedUrl);
      const item: MediaItem = { id: uid("media"), type: "web", name: u.hostname, src: processedUrl, duration: 15 };
      setMedia([...media, item]);
      toast.success(`Added ${u.hostname}/content`);
    } catch {
      toast.error("Invalid URL");
    }
  };

  const removeMedia = async (id: string) => {
    const m = media.find((m) => m.id === id);
    if (m && m.src) {
      try {
        await deleteMediaBlob(m.src);
      } catch (e) {
        console.warn("Failed to delete media blob:", e);
      }
    }
    setMedia(media.filter((m) => m.id !== id));
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer?.files?.length) {
      addFiles(e.dataTransfer.files);
    }
  };

  // PLAYLISTS
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const createPlaylist = () => {
    if (!newPlaylistName.trim()) return;
    const p: Playlist = { id: uid("pl"), name: newPlaylistName.trim(), items: [] };
    setPlaylists([...playlists, p]);
    setNewPlaylistName("");
  };

  const addToPlaylist = (playlistId: string, mediaId: string) => {
    setPlaylists(
      playlists.map((p) =>
        p.id === playlistId
          ? { ...p, items: [...p.items, { id: uid("pli"), mediaId }] }
          : p
      )
    );
  };

  const removeFromPlaylist = (playlistId: string, itemId: string) => {
    setPlaylists(
      playlists.map((p) => (p.id === playlistId ? { ...p, items: p.items.filter((i) => i.id !== itemId) } : p))
    );
  };

  const updatePlaylistSchedule = (playlistId: string, field: "days" | "start" | "end", value: any) => {
    setPlaylists(
      playlists.map((p) =>
        p.id === playlistId
          ? { ...p, schedule: { ...(p.schedule || {}), [field]: value } }
          : p
      )
    );
  };

  const deletePlaylist = (playlistId: string) => setPlaylists(playlists.filter((p) => p.id !== playlistId));

  const movePlaylistItem = (playlistId: string, itemId: string, direction: "up" | "down") => {
    setPlaylists(
      playlists.map((p) => {
        if (p.id !== playlistId) return p;
        const idx = p.items.findIndex((it) => it.id === itemId);
        if (idx === -1) return p;
        const newItems = [...p.items];
        const swapWith = direction === "up" ? idx - 1 : idx + 1;
        if (swapWith < 0 || swapWith >= newItems.length) return p;
        [newItems[idx], newItems[swapWith]] = [newItems[swapWith], newItems[idx]];
        return { ...p, items: newItems };
      })
    );
  };

  const handlePlayItem = (playlistId: string, itemId: string) => {
    const p = playlists.find(p => p.id === playlistId);
    if (!p) return;
    const idx = p.items.findIndex(i => i.id === itemId);
    if (idx === -1) return;
    setCurrentPlay(playlistId, idx);
    const m = media.find(m => m.id === p.items[idx].mediaId);
    toast.success(`Now playing: ${m?.name || 'Unknown item'}`);
    if (m) {
      const payload = { 
        id: m.id, 
        name: m.name, 
        type: m.type, 
        src: m.src, 
        at: Date.now() 
      };
      try {
        localStorage.setItem("signage:nowPlaying", JSON.stringify(payload));
      } catch {}
    }
  };

  const quickPlay = (m: MediaItem) => {
    const tempId = uid(`temp_pl_${m.id}`);
    const tempItemId = uid("pli");
    const tempPl: Playlist = {
      id: tempId,
      name: `Quick Play: ${m.name}`,
      items: [{ id: tempItemId, mediaId: m.id }]
    };
    
    // Immediate persist for cross-tab sync
    const currentPlaylists = getPlaylists();
    savePlaylists([...currentPlaylists, tempPl]);
    setPlaylists([...playlists, tempPl]); // Update local state
    
    // Set current play immediately
    setCurrentPlay(tempId, 0);
    
    // Update now playing
    const payload = { 
      id: m.id, 
      name: m.name, 
      type: m.type, 
      src: m.src, 
      at: Date.now() 
    };
    try {
      localStorage.setItem("signage:nowPlaying", JSON.stringify(payload));
    } catch {}
    
    toast.success(`Now playing: ${m.name} (opening player...)`);
    
    // Longer delay to allow full sync
    setTimeout(() => {
      window.open('/player', '_blank', 'noopener,noreferrer');
    }, 1500);
  };

  // DISPLAY
  const togglePower = () => setDisplay({ ...display, power: display.power === "on" ? "off" : "on" });

  // Resolve media src (handles local: keys -> object URLs)
  function useResolvedSrc(src?: string, key?: string) {
    const [url, setUrl] = useState<string | undefined>(src);
    useEffect(() => {
      let toRevoke: string | null = null;
      let cancelled = false;
      (async () => {
        if (!src) {
          setUrl(undefined);
          return;
        }
        if (src.startsWith("local:") && key) {
          try {
            const blob = await getMediaBlob(key);
            if (!cancelled && blob) {
              const u = URL.createObjectURL(blob);
              toRevoke = u;
              setUrl(u);
              return;
            }
          } catch {}
        }
        if (!cancelled) setUrl(src);
      })();
      return () => {
        cancelled = true;
        if (toRevoke) URL.revokeObjectURL(toRevoke);
      };
    }, [src, key]);
    return url;
  }

  const ImageThumb: React.FC<{ m: MediaItem; className?: string; alt?: string }> = ({ m, className, alt }) => {
    const resolved = useResolvedSrc(m.src, m.id);
    return <img src={resolved || ""} alt={alt ?? m.name} className={className} />;
  };

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Admin Login</CardTitle>
            <CardDescription>Enter password to manage signage.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="admin-pass">Password</Label>
              <Input
                id="admin-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLogin();
                }}
                placeholder="Enter password"
                autoComplete="off"
              />
            </div>
            <Button className="w-full" onClick={handleLogin}>Login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className={`${sidebarCollapsed ? "w-14" : "w-64"} border-r bg-sidebar text-sidebar-foreground transition-all duration-200 sticky top-0 h-screen hidden sm:flex flex-col`}>
        <div className="flex items-center justify-between px-3 h-14 border-b">
          <span className={`font-semibold ${sidebarCollapsed ? "sr-only" : "block"}`}>Admin</span>
          <Button variant="ghost" size="icon" onClick={() => setSidebarCollapsed((v) => !v)} aria-label="Toggle sidebar">
            <Menu className="h-5 w-5" />
          </Button>
        </div>
        <nav className="p-2 space-y-1">
          {[
            { id: "library", label: "Library" },
            { id: "playlists", label: "Playlists" },
            { id: "schedule", label: "Schedule" },
            { id: "display", label: "Display Settings" },
            { id: "devices", label: "Devices" },
          ].map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setActiveSection(s.id as any);
                const el = document.getElementById(`section-${s.id}`);
                el?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className={`w-full text-left flex items-center gap-2 rounded-md px-3 py-2 hover:bg-sidebar-accent ${activeSection===s.id?"bg-sidebar-accent/60": ""}`}
            >
              {s.id === "library" && <LayoutGrid className="h-4 w-4" />}
              {s.id === "playlists" && <ListIcon className="h-4 w-4" />}
              {s.id === "schedule" && <CalendarIcon className="h-4 w-4" />}
              {s.id === "display" && <Settings className="h-4 w-4" />}
              {s.id === "devices" && <Power className="h-4 w-4" />}
              <span className={`${sidebarCollapsed ? "sr-only" : ""}`}>{s.label}</span>
            </button>
          ))}
        </nav>
      </aside>
      {/* Main */}
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <div className="h-14 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30 px-4 flex items-center justify-between">
          <div className="font-semibold">Digital Signage Admin</div>
          <div className="hidden sm:flex items-center gap-2">
            <Button
              variant={compact ? "default" : "outline"}
              size="sm"
              onClick={() => setCompact((v) => !v)}
              title="Toggle compact mode"
            >
              {compact ? "Compact On" : "Compact Off"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" /> Upload
            </Button>
            <Button variant="outline" size="sm" onClick={() => { const name = `Playlist ${playlists.length+1}`; setNewPlaylistName(name); setTimeout(() => createPlaylist(), 0); setActiveSection("playlists"); document.getElementById("section-playlists")?.scrollIntoView({ behavior: "smooth"}); }}>
              <Plus className="h-4 w-4 mr-2" /> Add Playlist
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setActiveSection("display"); document.getElementById("section-display")?.scrollIntoView({ behavior: "smooth"}); }}>
              <Settings className="h-4 w-4 mr-2" /> Settings
            </Button>
            <Button onClick={() => window.open('/player', '_blank', 'noopener,noreferrer')} variant="default" size="sm">
              <Play className="h-4 w-4 mr-2" /> Open Player
            </Button>
          </div>
        </div>
        {/* Mobile quick nav */}
        <div className="sm:hidden sticky top-14 z-20 bg-background/95 backdrop-blur border-b px-2 py-2">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {[
              { id: "library", label: "Library" },
              { id: "playlists", label: "Playlists" },
              { id: "schedule", label: "Schedule" },
              { id: "display", label: "Display" },
              { id: "devices", label: "Devices" },
            ].map((s) => (
              <Button
                key={s.id}
                size="sm"
                variant={activeSection===s.id?"default":"outline"}
                className="shrink-0"
                onClick={() => {
                  setActiveSection(s.id as any);
                  document.getElementById(`section-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                {s.label}
              </Button>
            ))}
          </div>
        </div>
        {/* Mobile Upload FAB */}
        <Button
          onClick={() => fileInputRef.current?.click()}
          size="icon"
          aria-label="Upload"
          className="sm:hidden fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] h-14 w-14 rounded-full shadow-lg z-40"
        >
          <Upload className="h-6 w-6" />
        </Button>
        {/* Mobile bottom action bar */}
        <div className="hidden">
          <div className="flex items-center justify-around p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} aria-label="Upload">
              <Upload className="h-4 w-4 mr-2" /> Upload
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { const name = `Playlist ${playlists.length+1}`; setNewPlaylistName(name); setTimeout(() => createPlaylist(), 0); setActiveSection("playlists"); document.getElementById("section-playlists")?.scrollIntoView({ behavior: "smooth"}); }}
              aria-label="Add Playlist"
            >
              <Plus className="h-4 w-4 mr-2" /> Playlist
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setActiveSection("display"); document.getElementById("section-display")?.scrollIntoView({ behavior: "smooth"}); }} aria-label="Settings">
              <Settings className="h-4 w-4 mr-2" /> Settings
            </Button>
            <Button size="sm" onClick={() => window.open('/player', '_blank', 'noopener,noreferrer')} aria-label="Open Player">
              <Play className="h-4 w-4 mr-2" /> Player
            </Button>
          </div>
        </div>
        <div ref={swipeContainerRef} className={compact ? "p-4 space-y-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pb-0" : "p-6 space-y-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pb-0"}>
      <Card>
        <CardHeader>
          <CardTitle id="section-library">Library & Quick Actions</CardTitle>
          <CardDescription>Manage media, playlists, schedules, and display settings (PiSignage-like features).</CardDescription>
        </CardHeader>
        <div className="flex justify-end mb-4 gap-2">
          <Button onClick={() => window.open('/player', '_blank', 'noopener,noreferrer')} variant="outline">
            Open Player
          </Button>
          <Button variant="outline" onClick={() => setShowChangePass(true)}>
            Change Password
          </Button>
        </div>
      </Card>

      {showChangePass && (
        <Card>
          <CardHeader>
            <CardTitle>Change Admin Password</CardTitle>
            <CardDescription>Update your admin login password.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-pass">Current Password</Label>
              <Input
                id="current-pass"
                type="password"
                value={currentPassInput}
                onChange={(e) => setCurrentPassInput(e.target.value)}
                placeholder="Enter current password"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-pass">New Password</Label>
              <Input
                id="new-pass"
                type="password"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                placeholder="Enter new password"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-pass">Confirm New Password</Label>
              <Input
                id="confirm-pass"
                type="password"
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                placeholder="Confirm new password"
                autoComplete="off"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => {
                const stored = localStorage.getItem("admin:password") || "admin";
                if (currentPassInput !== stored) {
                  toast.error("Invalid current password");
                  return;
                }
                if (newPass !== confirmPass) {
                  toast.error("New passwords do not match");
                  return;
                }
                if (newPass.length < 4) {
                  toast.error("New password must be at least 4 characters");
                  return;
                }
                localStorage.setItem("admin:password", newPass);
                setShowChangePass(false);
                setCurrentPassInput("");
                setNewPass("");
                setConfirmPass("");
                toast.success("Password changed successfully");
                sessionStorage.removeItem("admin:authed");
                setAuthed(false);
              }}>
                Change Password
              </Button>
              <Button variant="outline" onClick={() => {
                setShowChangePass(false);
                setCurrentPassInput("");
                setNewPass("");
                setConfirmPass("");
              }}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Draggable Now Playing widget */}
      {showNowPlaying && !compact ? (
        <div
          className="fixed z-50 cursor-move select-none hidden sm:block"
          style={{ left: npPos.x, top: npPos.y }}
          onMouseDown={(e) => startDragNP(e.clientX, e.clientY)}
          onTouchStart={(e) => startDragNP(e.touches[0].clientX, e.touches[0].clientY)}
        >
          <Card className="shadow-lg border bg-background/80 backdrop-blur-sm relative">
            <Button
              variant="ghost"
              size="sm"
              className="absolute -top-2 -right-2 h-6 w-6 p-0 rounded-full border-2 border-background"
              onClick={() => setShowNowPlaying(false)}
            >
              <X className="h-3 w-3" />
            </Button>
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Now Playing
              </div>
              {nowPlaying ? (
                <div className="mt-1 flex items-center gap-3">
                  {/* Thumbnail preview for images; badge for others */}
                  {nowPlaying.type === "image" ? (
                    (() => {
                      const mediaItem = media.find(m => m.id === nowPlaying.id);
                      return mediaItem ? (
                        <ImageThumb
                          m={mediaItem}
                          alt={nowPlaying.name}
                          className="h-10 w-16 rounded object-cover border"
                        />
                      ) : (
                        <div className="h-10 w-16 rounded border grid place-items-center text-[10px] text-muted-foreground bg-muted">Image</div>
                      );
                    })()
                  ) : (
                    <div className="h-10 w-16 rounded border grid place-items-center text-[10px] text-muted-foreground bg-muted">
                      {nowPlaying.type === "video" ? "Video" : nowPlaying.type === "presentation" ? "PPTX" : /\.pdf($|\?)/i.test(nowPlaying.src || '') ? "PDF" : "Web"}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate max-w-[240px]" title={nowPlaying.name}>{nowPlaying.name}</div>
                    <div className="text-[11px] text-muted-foreground capitalize">{nowPlaying.type}</div>
                  </div>
                </div>
              ) : (
                <div className="mt-1 text-[11px] text-muted-foreground">Idle - No active content</div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Tabs defaultValue="manage">
        <TabsList>
          <TabsTrigger value="manage">Manage</TabsTrigger>
        </TabsList>

        <TabsContent value="manage" className="space-y-4">
          {/* Upload & Media Library */}
          <Card>
            <CardHeader>
              <CardTitle>Upload & Media Library</CardTitle>
              <CardDescription>Images, videos, and PDFs are stored locally for this demo. For Office docs (PPTX/DOCX/XLSX), paste a public URL below.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* View toggle */}
              <div className={`flex items-center justify-between ${compact ? "hidden" : ""}`}>
                <div className="text-sm text-muted-foreground">View</div>
                <div className="inline-flex rounded-md border overflow-hidden">
                  <button className={`px-3 py-2 text-sm flex items-center gap-1 ${mediaView==='grid'? 'bg-accent' : ''}`} onClick={() => setMediaView('grid')}>
                    <LayoutGrid className="h-4 w-4"/> Grid
                  </button>
                  <button className={`px-3 py-2 text-sm flex items-center gap-1 border-l ${mediaView==='list'? 'bg-accent' : ''}`} onClick={() => setMediaView('list')}>
                    <ListIcon className="h-4 w-4"/> List
                  </button>
                </div>
              </div>
              {/* Empty state for media */}
              {media.length === 0 && (
                <div className="rounded-md border-2 border-dashed p-6 text-center text-muted-foreground">
                  No media yet. Use Upload or Add Web/Document URL above to get started.
                </div>
              )}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!dragActive) setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={
                  "rounded-md border-2 border-dashed p-6 text-center transition-colors cursor-pointer " +
                  (dragActive ? " border-primary/60 bg-primary/5" : " border-border")
                }
              >
                <p className="font-medium">Drag & drop files to upload or click to browse</p>
                <p className="text-xs text-muted-foreground">Images, Videos, PDF. Office docs via public URL below.</p>
                {/* Upload progress indicators */}
                {Object.keys(uploadProgress).length > 0 && (
                  <div className="mt-4 grid sm:grid-cols-2 gap-2">
                    {Object.entries(uploadProgress).map(([name, pct]) => (
                      <div key={name} className="text-left">
                        <div className="flex justify-between text-xs mb-1"><span className="truncate max-w-[70%]" title={name}>{name}</span><span>{pct}%</span></div>
                        <div className="h-1.5 bg-muted rounded"><div className="h-1.5 bg-primary rounded transition-all" style={{ width: `${pct}%` }} /></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2 items-end flex-wrap">
                <div className="space-y-2">
                  <Label htmlFor="file">Select files</Label>
                  <Input ref={fileInputRef} id="file" type="file" multiple accept="image/*,video/*,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={(e) => addFiles(e.target.files)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="weburl">Add Web/Document URL</Label>
                  <div className="flex gap-2">
                    <Input id="weburl" placeholder="https://example.com/file.pdf or Office doc URL" onKeyDown={(e) => {
                      const t = e.target as HTMLInputElement;
                      if (e.key === "Enter") addWebContent(t.value);
                    }} />
                    <Button onClick={() => {
                      const el = document.getElementById("weburl") as HTMLInputElement | null;
                      addWebContent(el?.value || "");
                    }}>Add</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Tip: Office files (PPTX/DOCX/XLSX) must be publicly accessible URLs to render via viewer.</p>
                </div>
              </div>
              {mediaView === 'grid' ? (
                <>
                  {/* Desktop/Grid only on >= sm */}
                  <div className="hidden sm:grid sm:grid-cols-3 lg:grid-cols-5 gap-4">
                    {media.map((m) => (
                      <div key={m.id} draggable onDragStart={(e) => e.dataTransfer.setData("mediaId", m.id)} className="group relative rounded-lg border overflow-hidden bg-card shadow-sm hover:shadow transition-shadow">
                        {/* Thumb */}
                        {m.type === 'image' ? (
                          <ImageThumb m={m} className="h-32 w-full object-cover" />
                        ) : (
                           <div className="h-32 w-full grid place-items-center text-xs text-muted-foreground bg-muted">{m.type === 'video' ? 'Video' : m.type === 'presentation' ? 'PPTX' : /\.pdf($|\?)/i.test(m.src || '') ? 'PDF' : 'Web'}</div>
                         )}
                        <div className="p-2">
                          <div className="text-sm font-medium truncate" title={m.name}>{m.name}</div>
                          <div className="text-[11px] text-muted-foreground capitalize">{m.type}</div>
                        </div>
                        {/* Hover actions */}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity grid place-items-center">
                          <div className="flex gap-2">
                            <Button size="icon" variant="secondary" onClick={() => quickPlay(m)} title="Play"><Play className="h-4 w-4"/></Button>
                            <Button size="icon" variant="destructive" onClick={() => setConfirmRemoveMedia(m)} title="Remove"><Trash2 className="h-4 w-4"/></Button>
                            <Button size="icon" variant="outline" title="Info" onClick={() => toast.info(`${m.name} • ${m.type}`)}><Info className="h-4 w-4"/></Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Force card list on phones even if Grid is selected */}
                  <div className="sm:hidden space-y-2">
                    {media.map((m) => (
                      <div key={m.id} className="rounded-md border p-3 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate" title={m.name}>{m.name}</div>
                          <div className="text-[11px] text-muted-foreground capitalize">
                            {m.type === 'presentation' ? 'PPTX' : m.type} • {(m.duration ?? (m.type==='video' ? undefined : 8)) ?? 'auto'}{typeof (m.duration ?? (m.type==='video' ? undefined : 8)) === 'number' ? 's' : ''}
                          </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Button size="sm" variant="outline" onClick={() => quickPlay(m)}>Play</Button>
                          <Button size="sm" variant="destructive" onClick={() => setConfirmRemoveMedia(m)}>Remove</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
              {mediaView === 'list' ? (
               <>
               <div className="hidden sm:block overflow-x-auto -mx-2 sm:mx-0">
                  <div className="min-w-[720px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Duration (s)</TableHead>
                          <TableHead className={compact ? "hidden" : ""}>Volume/Mute</TableHead>
                          <TableHead className={compact ? "hidden" : ""}>Loop (Video)</TableHead>
                          <TableHead>Actions</TableHead>
                          <TableHead>Quick Play</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {media.map((m) => (
                          <TableRow key={m.id} draggable={m.type === "video"} onDragStart={(e) => e.dataTransfer.setData("mediaId", m.id)}>
                            <TableCell className="max-w-[240px] truncate">{m.name}</TableCell>
                            <TableCell className="capitalize">{m.type === "presentation" ? "PPTX" : m.type}</TableCell>
                            <TableCell>
                              {m.type === "video" ? (
                                <div className="flex items-center gap-2">
                                  <Input
                                    type="number"
                                    value={m.duration || ''}
                                    placeholder="Custom (empty for auto)"
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setMedia(media.map((x) => (x.id === m.id ? { ...x, duration: val === '' ? undefined : Number(val) } : x)));
                                    }}
                                    className="w-24"
                                    min={1}
                                  />
                                  <span className={`text-xs italic ${m.duration ? 'text-muted-foreground line-through' : 'text-primary'}`}>Auto</span>
                                </div>
                              ) : (
                                <Input
                                  type="number"
                                  value={m.duration ?? 8}
                                  min={1}
                                  onChange={(e) =>
                                    setMedia(media.map((x) => (x.id === m.id ? { ...x, duration: Number(e.target.value) } : x)))
                                  }
                                  className="w-24"
                                />
                              )}
                            </TableCell>
                            <TableCell className={compact ? "hidden" : ""}>
                              { (m.type === "video" || m.type === "presentation") ? (
                                m.type === "video" ? (
                                  <div className="flex items-center gap-2 w-full">
                                    <div className="flex items-center gap-1">
                                      <Switch 
                                        id={`mute-${m.id}`} 
                                        checked={!!m.mute} 
                                        onCheckedChange={(val) => setMedia(media.map((x) => (x.id === m.id ? { ...x, mute: val } : x)))}
                                      />
                                      <Label htmlFor={`mute-${m.id}`} className="text-xs font-medium cursor-pointer">Mute Audio</Label>
                                      {m.mute ? <VolumeX className="h-3 w-3 text-destructive" /> : <Volume className="h-3 w-3 text-muted-foreground" />}
                                    </div>
                                    <div className="flex items-center gap-1 flex-1 max-w-xs">
                                      <Slider 
                                        value={[Math.round((m.volume ?? 1) * 100)]} 
                                        onValueChange={([v]) => setMedia(media.map((x) => (x.id === m.id ? { ...x, volume: v / 100 } : x)))}
                                        className="flex-1"
                                        min={0} 
                                        max={100}
                                      />
                                      <span className="text-xs text-muted-foreground min-w-[30px] text-right">{Math.round((m.volume ?? 1) * 100)}%</span>
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">N/A (No Audio)</span>
                                )
                              ) : (
                                <span className="text-muted-foreground">N/A (No Audio)</span>
                              )}
                            </TableCell>
                            <TableCell className={compact ? "hidden" : ""}>
                              {m.type === "video" ? (
                                <Switch
                                  id={`loop-${m.id}`}
                                  checked={!!m.loop}
                                  onCheckedChange={(val) => setMedia(media.map((x) => (x.id === m.id ? { ...x, loop: val } : x)))}
                                />
                              ) : (
                                <span className="text-muted-foreground">N/A</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button variant="destructive" size="sm" onClick={() => setConfirmRemoveMedia(m)}>Remove</Button>
                            </TableCell>
                            <TableCell>
                              <Button variant="outline" size="sm" onClick={() => quickPlay(m)}>Play Now</Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableCaption className="text-xs text-muted-foreground mt-2">
                        💡 Local files up to 300MB supported via IndexedDB (images, videos, PDFs, PPTX). Use "Add Web/Document URL" for external content.
                      </TableCaption>
                    </Table>
                  </div>
                </div>
                {/* Mobile: single-column card list */}
                <div className="sm:hidden space-y-2">
                  {media.map((m) => (
                    <div key={m.id} className="rounded-md border p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate" title={m.name}>{m.name}</div>
                        <div className="text-[11px] text-muted-foreground capitalize">
                          {m.type === 'presentation' ? 'PPTX' : m.type} • {(m.duration ?? (m.type==='video' ? undefined : 8)) ?? 'auto'}{typeof (m.duration ?? (m.type==='video' ? undefined : 8)) === 'number' ? 's' : ''}
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" variant="outline" onClick={() => quickPlay(m)}>Play</Button>
                        <Button size="sm" variant="destructive" onClick={() => setConfirmRemoveMedia(m)}>Remove</Button>
                      </div>
                    </div>
                  ))}
                </div>
               </>
               ) : null}
            </CardContent>
          </Card>

          {/* Playlists */}
          <Card>
            <CardHeader>
              <CardTitle id="section-playlists">Playlists</CardTitle>
              <CardDescription>Create and schedule playlists. The first matching schedule becomes active.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Create playlist */}
              <div className="flex gap-2">
                <Input placeholder="New playlist name" value={newPlaylistName} onChange={(e) => setNewPlaylistName(e.target.value)} />
                <Button onClick={createPlaylist}>Create</Button>
              </div>
              {/* Empty state for playlists */}
              {playlists.length === 0 && (
                <div className="rounded-md border-2 border-dashed p-6 text-center text-muted-foreground">
                  No playlists yet. Create a playlist above, then drag media into it.
                </div>
              )}
              {playlists.map((p) => (
                <Card key={p.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <CardTitle>{p.name}</CardTitle>
                        <CardDescription>Items: {p.items.length} (Drag media from library below)</CardDescription>
                      </div>
                      <Button variant="destructive" onClick={() => deletePlaylist(p.id)}>Delete</Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Drop zone for adding media */}
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const mediaId = e.dataTransfer.getData("mediaId");
                        if (mediaId) {
                          addToPlaylist(p.id, mediaId);
                        }
                      }}
                      className="border-2 border-dashed border-muted rounded-md p-4 text-center text-muted-foreground"
                    >
                      <p>Drop media here to add to playlist</p>
                    </div>
                    {/* Add media select */}
                    <div className="flex flex-wrap gap-2 items-end">
                      <div className="space-y-2">
                        <Label>Add media</Label>
                        <Select onValueChange={(val) => addToPlaylist(p.id, val)}>
                          <SelectTrigger className="w-64"><SelectValue placeholder="Select media to add" /></SelectTrigger>
                          <SelectContent>
                            {media.map((m) => (
                              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {/* Schedule table */}
                    <div className="overflow-x-auto -mx-2 sm:mx-0">
                      <div className="min-w-[720px]">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Name</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead>Duration Override (s)</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {p.items.map((it) => {
                              const m = media.find((x) => x.id === it.mediaId);
                              if (!m) return null;
                              const isCurrent = nowPlaying?.id === m.id;
                              return (
                                <TableRow
                                  key={it.id}
                                  className={`cursor-pointer hover:bg-muted/50 ${isCurrent ? "bg-primary/10 animate-pulse" : ""}`}
                                  onClick={() => handlePlayItem(p.id, it.id)}
                                >
                                  <TableCell className="max-w-[240px] truncate">{m.name}</TableCell>
                                  <TableCell className="capitalize">{m.type}</TableCell>
                                  <TableCell>
                                    <Input
                                      type="number"
                                      value={it.duration || ''}
                                      placeholder={m.type === "video" ? "Custom (empty for auto)" : "Override (s)"}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        const newDur = val === '' ? undefined : Number(val);
                                        setPlaylists(
                                          playlists.map((pl) =>
                                            pl.id === p.id
                                              ? { ...pl, items: pl.items.map((x) => (x.id === it.id ? { ...x, duration: newDur } : x)) }
                                              : pl
                                          )
                                        );
                                      }}
                                      className="w-24"
                                      min={1}
                                    />
                                    {m.type === "video" && !it.duration && (
                                      <span className="text-xs italic text-primary block mt-1">Auto (full video)</span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    {isCurrent ? (
                                      <Badge variant="default" className="bg-primary text-primary-foreground">Now Playing</Badge>
                                    ) : (
                                      <span className="text-muted-foreground">Ready</span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-2">
                                      <Button variant="secondary" size="sm" onClick={() => movePlaylistItem(p.id, it.id, "up")}>Up</Button>
                                      <Button variant="secondary" size="sm" onClick={() => movePlaylistItem(p.id, it.id, "down")}>Down</Button>
                                      <Button variant="destructive" size="sm" onClick={() => removeFromPlaylist(p.id, it.id)}>Remove</Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                    {/* Schedule scheduling UI */}
                    <div className="grid sm:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Days</Label>
                        <Select
                          value={(p.schedule?.days && p.schedule.days.length > 0) ? p.schedule.days.join(",") : "all"}
                          onValueChange={(val) =>
                            updatePlaylistSchedule(
                              p.id,
                              "days",
                              val === "all" ? [] : val.split(",").map((x) => Number(x))
                            )
                          }
                        >
                          <SelectTrigger><SelectValue placeholder="All days" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Days</SelectItem>
                            <SelectItem value="1,2,3,4,5">Weekdays</SelectItem>
                            <SelectItem value="0,6">Weekends</SelectItem>
                            <SelectItem value="0,1,2,3,4,5,6">Sun-Sat</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Start (HH:MM)</Label>
                        <Input placeholder="08:00" value={p.schedule?.start || ""} onChange={(e) => updatePlaylistSchedule(p.id, "start", e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>End (HH:MM)</Label>
                        <Input placeholder="18:00" value={p.schedule?.end || ""} onChange={(e) => updatePlaylistSchedule(p.id, "end", e.target.value)} />
                      </div>
                    </div>
                    {/* Schedule preview */}
                    <div className="mt-2">
                      <div className="flex items-center justify-between mb-2 text-sm text-muted-foreground"><span>Schedule preview</span><div className="flex items-center gap-1"><ChevronLeft className="h-4 w-4"/><ChevronRight className="h-4 w-4"/></div></div>
                      <div className="grid grid-cols-8 text-xs">
                        <div />
                        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (<div key={d} className="px-2 py-1 text-center text-muted-foreground">{d}</div>))}
                      </div>
                      <div className="grid grid-cols-8">
                        <div className="text-xs px-2 py-2 text-muted-foreground">{p.schedule?.start || "00:00"} - {p.schedule?.end || "23:59"}</div>
                        {Array.from({length:7}).map((_,i) => {
                          const days = p.schedule?.days || [];
                          const active = days.length === 0 || days.includes(i as any);
                          return <div key={i} className={`h-8 m-1 rounded ${active? 'bg-primary/20 border border-primary/30' : 'bg-muted'}`} />
                        })}
                      </div>
                      {/* Time presets */}
                      <div className="flex flex-wrap gap-2 mt-3">
                        {["08:00","12:00","18:00"].map((t) => (
                          <Button key={t} variant="secondary" size="sm" onClick={() => updatePlaylistSchedule(p.id, "start", t)}>{t} Start</Button>
                        ))}
                        {["10:00","14:00","20:00"].map((t) => (
                          <Button key={t} variant="secondary" size="sm" onClick={() => updatePlaylistSchedule(p.id, "end", t)}>{t} End</Button>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </CardContent>
          </Card>

          {/* Schedule */}
          <Card>
            <CardHeader>
              <CardTitle id="section-schedule">Schedule</CardTitle>
              <CardDescription>Calendar-style overview of active playlists by day/time.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className={`flex items-center justify-between ${compact ? "hidden" : ""}`}>
                <div className="text-sm text-muted-foreground">View</div>
                <div className="inline-flex rounded-md border overflow-hidden">
                  <button className={`px-3 py-2 text-sm ${scheduleView==='weekly' ? 'bg-accent' : ''}`} onClick={() => setScheduleView('weekly')}>Weekly</button>
                  <button className={`px-3 py-2 text-sm border-l ${scheduleView==='daily' ? 'bg-accent' : ''}`} onClick={() => setScheduleView('daily')}>Daily</button>
                </div>
              </div>

              {scheduleView === 'weekly' ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-7 gap-2 text-xs text-muted-foreground">
                    {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => (
                      <div key={d} className="text-center">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-2">
                    {Array.from({ length: 7 }).map((_, day) => {
                      // active if any playlist includes this day or schedule days empty (all days)
                      const activePlaylists = playlists.filter((p) => {
                        const days = p.schedule?.days || [];
                        const dayActive = days.length === 0 || days.includes(day as any);
                        return dayActive && (p.schedule?.start || p.schedule?.end);
                      });
                      return (
                        <div key={day} className={`min-h-16 rounded-md border p-2 ${activePlaylists.length ? 'bg-primary/5 border-primary/30' : 'bg-muted'}`}>
                          <div className="flex flex-col gap-1">
                            {activePlaylists.slice(0,3).map((p) => (
                              <div key={p.id} className="text-[11px] px-2 py-1 rounded bg-primary/10 text-foreground truncate">
                                {p.name} • {p.schedule?.start || '00:00'}–{p.schedule?.end || '23:59'}
                              </div>
                            ))}
                            {activePlaylists.length > 3 && (
                              <div className="text-[11px] text-muted-foreground">+{activePlaylists.length - 3} more</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground">Today</div>
                  <div className="space-y-2">
                    {playlists.map((p) => {
                      const days = p.schedule?.days || [];
                      const today = new Date().getDay();
                      const isToday = days.length === 0 || days.includes(today as any);
                      return (
                        <div key={p.id} className={`rounded-md border p-3 flex items-center justify-between ${isToday ? 'bg-primary/5 border-primary/30' : 'bg-muted'}`}>
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate" title={p.name}>{p.name}</div>
                            <div className="text-[11px] text-muted-foreground">{p.schedule?.start || '00:00'} – {p.schedule?.end || '23:59'}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">{p.items.length} items</Badge>
                            <Badge variant={isToday ? 'default' : 'secondary'}>{isToday ? 'Active' : 'Inactive'}</Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Display Settings */}
          <Card>
            <CardHeader>
              <CardTitle id="section-display">Display Settings</CardTitle>
              <CardDescription>Orientation, brightness and power control (simulated).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid sm:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label>Orientation</Label>
                  <Select value={display.orientation} onValueChange={(val) => setDisplay({ ...display, orientation: val as any })}>
                    <SelectTrigger><SelectValue placeholder="Select orientation" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="landscape">Landscape</SelectItem>
                      <SelectItem value="portrait">Portrait</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Brightness: {display.brightness}%</Label>
                  <Slider value={[display.brightness]} onValueChange={([v]) => setDisplay({ ...display, brightness: v })} step={1} min={0} max={100} />
                </div>
                <div className="space-y-2">
                  <Label>Power</Label>
                  <div className="flex items-center gap-3">
                    <Switch checked={display.power === "on"} onCheckedChange={(v) => setDisplay({ ...display, power: v ? "on" : "off" })} />
                    <Button variant="secondary" onClick={togglePower}>{display.power === "on" ? "Turn Off" : "Turn On"}</Button>
                  </div>
                </div>
              </div>
              {/* Live preview */}
              <div className="rounded-lg border bg-muted/50 p-4">
                <div className="text-sm text-muted-foreground mb-2">Live Preview</div>
                <div className="mx-auto w-full max-w-md aspect-video bg-black rounded-md overflow-hidden grid place-items-center" style={{ filter: `brightness(${Math.max(5, display.brightness)/100})` , transform: display.orientation === 'portrait' ? 'rotate(90deg)' : 'none'}}>
                  <div className="text-white/80 text-xs">{display.orientation === 'portrait' ? 'Portrait' : 'Landscape'} • {display.brightness}% • {display.power === 'on' ? 'On' : 'Off'}</div>
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                <Button variant="link" onClick={() => window.open('/player', '_blank', 'noopener,noreferrer')} className="p-0 h-auto">
                  Open Player
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Devices */}
          {(() => {
            const now = Date.now();
            const activeWindowMs = 15000; // 15s heartbeat window
            const activeCount = devices.filter(d => now - (d.lastSeen || 0) < activeWindowMs).length;
            const inactiveCount = Math.max(0, devices.length - activeCount);
            const fmtAgo = (ts?: number) => {
              if (!ts) return "never";
              const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
              if (s < 60) return `${s}s ago`;
              const m = Math.floor(s / 60);
              if (m < 60) return `${m}m ago`;
              const h = Math.floor(m / 60);
              return `${h}h ago`;
            };
            return (
              <Card>
                <CardHeader>
                  <CardTitle id="section-devices">Devices</CardTitle>
                  <CardDescription>Monitor player tabs and open their permanent links.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">Active {activeCount} • Inactive {inactiveCount}</div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => window.open('/player', '_blank', 'noopener,noreferrer')}>
                        <Play className="h-4 w-4 mr-2"/> Open New Player
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => {
                        try {
                          localStorage.setItem('admin:devices:refresh', String(Date.now()));
                          // Reading effect will update automatically within 5s
                          toast.success('Refreshing devices...');
                        } catch {}
                      }}>Refresh</Button>
                    </div>
                  </div>
                  {devices.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No players detected yet. Open the Player to register it.</p>
                  ) : (
                    <ul className="divide-y rounded-md border">
                      {devices.map((d) => {
                        const isActive = now - (d.lastSeen || 0) < activeWindowMs;
                        const url = d.url || `/player?deviceId=${encodeURIComponent(d.id || '')}`;
                        return (
                          <li key={d.id} className="p-3 flex items-center justify-between">
                            <div className="min-w-0 flex items-center gap-3">
                              <span className={`h-2.5 w-2.5 rounded-full ${isActive ? "bg-green-500" : "bg-gray-300"}`} />
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate" title={d.id}>{d.name || 'Unnamed Player'}</div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {d.nowPlaying?.name ? `Now playing: ${d.nowPlaying.name}` : `Last seen ${fmtAgo(d.lastSeen)}`}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Button variant="secondary" size="sm" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>Open</Button>
                              <Button variant="outline" size="sm" onClick={() => { setRenameTarget({ id: d.id, name: d.name || "" }); setRenameValue(d.name || ""); }}>Rename</Button>
                              <Button className={compact ? "hidden" : ""} variant="outline" size="sm" onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(window.location.origin + url);
                                  toast.success('Link copied');
                                } catch {
                                  toast.error('Failed to copy');
                                }
                              }}>Copy Link</Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <p className="text-xs text-muted-foreground">Each device gets a permanent URL. Bookmark or reuse it to reopen the same player identity.</p>
                </CardContent>
              </Card>
            );
          })()}
        </TabsContent>
      </Tabs>
      {/* Confirm remove media dialog */}
      <AlertDialog
        open={!!crm}
        onOpenChange={(open) => {
          if (!open) setConfirmRemoveMedia(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove media</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {crm?.name} ({crm?.type})?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (crm) {
                  await removeMedia(crm.id);
                }
                setConfirmRemoveMedia(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Rename device dialog */}
      <AlertDialog
        open={!!renameTarget}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null);
            setRenameValue("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename Player</AlertDialogTitle>
            <AlertDialogDescription>
              Set a friendly name to identify this player device.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="rename-input">Player name</Label>
            <Input
              id="rename-input"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const val = renameValue.trim();
                  if (!val) {
                    toast.error("Name cannot be empty");
                    return;
                  }
                  try {
                    const raw = localStorage.getItem("signage:devices");
                    const list: any[] = raw ? JSON.parse(raw) : [];
                    const updated = list.map((d) =>
                      d.id === renameTarget?.id ? { ...d, name: val } : d
                    );
                    localStorage.setItem("signage:devices", JSON.stringify(updated));
                    setDevices(updated);
                    // Nudge other tabs/listeners
                    localStorage.setItem("admin:devices:refresh", String(Date.now()));
                    // Broadcast rename to target player so it persists its local name
                    try {
                      // @ts-ignore BroadcastChannel may not exist in all envs
                      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
                        const bc = new BroadcastChannel("signage-control");
                        bc.postMessage({ type: "rename", targetId: renameTarget?.id, name: val });
                        try { bc.close(); } catch {}
                      }
                    } catch {}
                    try { (navigator as any)?.vibrate?.(10); } catch {}
                    toast.success("Player renamed");
                    setRenameTarget(null);
                    setRenameValue("");
                  } catch {
                    toast.error("Failed to rename");
                  }
                }
              }}
              placeholder="e.g., Lobby TV"
              maxLength={64}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setRenameTarget(null); setRenameValue(""); }}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const val = renameValue.trim();
                if (!val) {
                  toast.error("Name cannot be empty");
                  return;
                }
                try {
                  const raw = localStorage.getItem("signage:devices");
                  const list: any[] = raw ? JSON.parse(raw) : [];
                  const updated = list.map((d) =>
                    d.id === renameTarget?.id ? { ...d, name: val } : d
                  );
                  localStorage.setItem("signage:devices", JSON.stringify(updated));
                  setDevices(updated);
                  localStorage.setItem("admin:devices:refresh", String(Date.now()));
                  // Broadcast rename to target player so it persists its local name
                  try {
                    // @ts-ignore BroadcastChannel may not exist in all envs
                    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
                      const bc = new BroadcastChannel("signage-control");
                      bc.postMessage({ type: "rename", targetId: renameTarget?.id, name: val });
                      try { bc.close(); } catch {}
                    }
                  } catch {}
                  try { (navigator as any)?.vibrate?.(12); } catch {}
                  toast.success("Player renamed");
                  setRenameTarget(null);
                  setRenameValue("");
                } catch {
                  toast.error("Failed to rename");
                }
              }}
            >
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
         </div>
       </div>
     </div>
   );
}