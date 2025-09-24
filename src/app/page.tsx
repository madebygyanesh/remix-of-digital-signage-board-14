"use client";

import Link from "next/link";
import { useCallback, useState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
// import { Progress } from "@/components/ui/progress"

export default function Home() {
  // Devices state
  const [devices, setDevices] = useState<Array<any>>([]);

  // Devices: read from localStorage + keep fresh
  useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem("signage:devices");
        const list: any[] = raw ? JSON.parse(raw) : [];
        // sort by lastSeen desc
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

  const sendControl = useCallback((type: "play" | "pause" | "next" | "prev", targetId: string) => {
    try {
      // Send a targeted control message to a specific player tab
      // @ts-ignore BroadcastChannel available in modern browsers
      const bc = new BroadcastChannel("signage-control");
      bc.postMessage({ type, targetId });
      setTimeout(() => {
        try { bc.close(); } catch {}
      }, 50);
      toast.success(`${type} sent to ${targetId.slice(0, 6)}…`);
    } catch (e) {
      toast.error("Failed to send control command");
    }
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-5xl w-full text-center space-y-8">
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight !whitespace-pre-line">Digital Board</h1>
        <p className="text-muted-foreground text-lg !whitespace-pre-line">Automation & Robotics Dept

        </p>

        {/* Quick actions - removed all buttons to centralize in Admin */}
        <div className="text-center">
          <Button asChild size="lg">
            <Link href="/admin">Open Admin Portal (password: admin)</Link>
          </Button>
          <p className="text-sm text-muted-foreground mt-2 !whitespace-pre-line"></p>
        </div>

        {/* Drag-and-drop zone - removed; use Admin instead */}
        <div className="text-center text-muted-foreground">
          <p className="!whitespace-pre-line">Digital Board Admin Panel</p>
        </div>

        <div className="rounded-lg overflow-hidden mt-6">
          {/* Demo banner */}
          <img
            src="https://slelguoygbfzlpylpxfs.supabase.co/storage/v1/object/public/document-uploads/Image-1758620549946.jpg"
            alt="Digital signage wall"
            className="w-full h-[340px] object-contain" />

        </div>

        {/* Devices Section */}
        <div className="text-left bg-card border rounded-lg p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Devices</h2>
            <div className="text-sm text-muted-foreground">Active {activeCount} • Inactive {inactiveCount}</div>
          </div>
          {devices.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-2">No players detected yet. Open the Player on this device to register it.</p>
          ) : (
            <ul className="mt-3 divide-y">
              {devices.slice(0, 8).map((d) => {
                const isActive = now - (d.lastSeen || 0) < activeWindowMs;
                return (
                  <li key={d.id} className="py-2 flex items-center justify-between">
                    <div className="min-w-0 flex items-center gap-3">
                      <span className={`h-2.5 w-2.5 rounded-full ${isActive ? "bg-green-500" : "bg-gray-300"}`} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{d.name || "Unnamed Player"}</div>
                        <div className="text-xs text-muted-foreground truncate">{d.nowPlaying?.name ? `Now playing: ${d.nowPlaying.name}` : `Last seen ${fmtAgo(d.lastSeen)}`}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Link href={d.url || "/player"} className="text-sm text-primary hover:underline">Open</Link>
                      <button
                        className="text-xs px-2 py-1 rounded border hover:bg-accent"
                        onClick={() => sendControl("prev", d.id)}
                        aria-label="Previous"
                        title="Previous"
                      >‹</button>
                      <button
                        className="text-xs px-2 py-1 rounded border hover:bg-accent"
                        onClick={() => sendControl(isActive ? "pause" : "play", d.id)}
                        aria-label="Play/Pause"
                        title="Play/Pause"
                      >⏯</button>
                      <button
                        className="text-xs px-2 py-1 rounded border hover:bg-accent"
                        onClick={() => sendControl("next", d.id)}
                        aria-label="Next"
                        title="Next"
                      >›</button>
                      <span className="text-xs text-muted-foreground hidden sm:inline">{d.id}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="text-xs text-muted-foreground mt-3">Each device has a permanent link. Share the link to reopen the same player instance later.</div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 text-left">
          <div>
            <h3 className="font-semibold !whitespace-pre-line">Digital Board</h3>
            <p className="text-sm text-muted-foreground !whitespace-pre-line">Madeby.Gyanesh</p>
          </div>
          <div>
            <h3 className="font-semibold">Playlists & Schedules</h3>
            <p className="text-sm text-muted-foreground !whitespace-pre-line !whitespace-pre-line"></p>
          </div>
          <div>
            <h3 className="font-semibold">Display Controls</h3>
            <p className="text-sm text-muted-foreground !whitespace-pre-line"></p>
          </div>
        </div>
      </div>
    </main>);

}