"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { getMedia, getPlaylists, saveMedia, savePlaylists, uid, type MediaItem, type Playlist, type PlaylistItem, type Schedule } from "@/lib/signage";
import Link from "next/link";

const DAYS = [
  { i: 0, name: "Sun" },
  { i: 1, name: "Mon" },
  { i: 2, name: "Tue" },
  { i: 3, name: "Wed" },
  { i: 4, name: "Thu" },
  { i: 5, name: "Fri" },
  { i: 6, name: "Sat" },
];

export default function PortalPage() {
  // Media library
  const [media, setMedia] = useState<MediaItem[]>([]);
  useEffect(() => setMedia(getMedia()), []);

  // Upload handling (drag & drop + browse)
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [uploading, setUploading] = useState(false);

  const acceptedTypes = useMemo(
    () => [
      "image/*",
      "video/*",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ],
    []
  );

  const toDataURL = (f: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(f);
    });

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (!arr.length) return;
    setUploading(true);
    setProgress({});

    const existing = getMedia();
    const created: MediaItem[] = [];

    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      try {
        setProgress((p) => ({ ...p, [f.name]: 10 }));
        if (f.type === "application/pdf") {
          // PDF page to image conversion
          const fileUrl = URL.createObjectURL(f);
          const pdfjs = await import("pdfjs-dist");
          pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
          const loadingTask = pdfjs.getDocument(fileUrl);
          const pdf = await loadingTask.promise;
          const numPages = pdf.numPages;
          let progressValue = 20;
          setProgress((p) => ({ ...p, [f.name]: progressValue }));
          for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const scale = 1.5;
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d") as CanvasRenderingContext2D;
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            const renderContext = {
              canvasContext: context,
              viewport,
              canvas,
            } as any;
            await page.render(renderContext).promise;
            const pageSrc = canvas.toDataURL("image/png");
            const item: MediaItem = {
              id: uid("media"),
              type: "image",
              name: `${f.name.replace(/\.[^/.]+$/, "")} - Page ${pageNum}`,
              src: pageSrc,
              duration: 8,
            };
            created.push(item);
            progressValue = Math.round(20 + (pageNum / numPages) * 80);
            setProgress((p) => ({ ...p, [f.name]: progressValue }));
          }
          URL.revokeObjectURL(fileUrl);
          setProgress((p) => ({ ...p, [f.name]: 100 }));
        } else {
          // Non-PDF file handling
          const type: MediaItem["type"] = f.type.startsWith("image/")
            ? "image"
            : f.type.startsWith("video/")
            ? "video"
            : "web";

          const src = await toDataURL(f);

          let item: MediaItem = {
            id: uid("media"),
            type,
            name: f.name,
            src,
            duration: type === "video" ? undefined : 8,
            ...(type === "video" ? { mute: true, volume: 1 } : {}),
          };

          // Detect duration for videos
          if (type === "video") {
            const videoEl = document.createElement("video");
            videoEl.src = src;
            await new Promise<void>((resolve) => {
              videoEl.onloadedmetadata = () => {
                if (videoEl.duration && !isNaN(videoEl.duration) && videoEl.duration > 0) {
                  item.duration = Math.round(videoEl.duration);
                } else {
                  item.duration = 8;
                }
                videoEl.src = "";
                resolve();
              };
              videoEl.onerror = () => {
                item.duration = 8;
                videoEl.src = "";
                resolve();
              };
              videoEl.load();
            });
          } else {
            item.duration = 8;
          }

          setProgress((p) => ({ ...p, [f.name]: 90 }));
          created.push(item);
          setProgress((p) => ({ ...p, [f.name]: 100 }));
        }
      } catch (e) {
        toast.error(`Failed to process ${f.name}: ${(e as Error).message || e}`);
        setProgress((p) => ({ ...p, [f.name]: 100 }));
      }
    }

    if (created.length) {
      localStorage.setItem("signage:media", JSON.stringify([...existing, ...created]));
      setMedia(getMedia());
      toast.success(`Added ${created.length} item${created.length > 1 ? "s" : ""} (including ${arr.length === 1 && arr[0].type === "application/pdf" ? "PDF pages" : "files"}).`);
    }

    setTimeout(() => setProgress({}), 600);
    setUploading(false);
  }, [getMedia]);

  const onBrowse = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = acceptedTypes.join(",");
    input.onchange = () => input.files && handleFiles(input.files);
    input.click();
  }, [acceptedTypes, handleFiles]);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  // Playlist builder
  const [playlistName, setPlaylistName] = useState("My Playlist");
  const [items, setItems] = useState<PlaylistItem[]>([]);

  const clearBuilder = () => {
    setItems([]);
  };

  // Drag-reorder (HTML5 DnD)
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const handleDragStart = (index: number) => setDragIndex(index);
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
  };
  const handleDropItem = (index: number) => {
    if (dragIndex === null || dragIndex === index) return;
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(index, 0, moved);
      return next;
    });
    setDragIndex(null);
  };

  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));

  // Scheduling (simple)
  const [days, setDays] = useState<number[]>([]); // empty = every day
  const [start, setStart] = useState<string>("");
  const [end, setEnd] = useState<string>("");

  const savePlaylist = () => {
    if (!playlistName.trim()) {
      toast.error("Enter a playlist name");
      return;
    }
    if (!items.length) {
      toast.error("Add at least one media item");
      return;
    }

    const schedule: Schedule | undefined = days.length || start || end ? { days, start: start || undefined, end: end || undefined } : undefined;

    const newPlaylist: Playlist = {
      id: uid("pl"),
      name: playlistName.trim(),
      items,
      schedule,
    };

    const all = getPlaylists();
    savePlaylists([newPlaylist, ...all]);
    toast.success(
      `Saved "Playlist name". ${schedule ? "Scheduled" : "Active now"}. ${items.length} item${items.length > 1 ? "s" : ""}`
    );
  };

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Zero‑Friction Portal</h1>
          <div className="flex gap-2">
            <Button asChild variant="secondary"><Link href="/">Home</Link></Button>
            <Button asChild variant="outline"><Link href="/admin">Admin</Link></Button>
            <Button asChild><Link href="/player" target="_blank">Open Player</Link></Button>
          </div>
        </div>

        {/* 1. Media Library */}
        <Card>
          <CardHeader>
            <CardTitle>1. Media Library</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {media.length === 0 ? (
              <div className="p-4 text-muted-foreground text-center">
                No media uploaded yet. Drag files to the playlist builder below to add.
              </div>
            ) : (
              media.map((m) => (
                <div
                  key={m.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", `add:${m.id}`)}
                  className="flex items-center justify-between p-3 border rounded-md hover:bg-accent cursor-move"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate" title={m.name}>
                      {m.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {m.type.toUpperCase()} • {m.duration || 8}s
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                    <Input
                      type="number"
                      min="1"
                      value={m.duration || 8}
                      onChange={(e) => {
                        const v = parseInt(e.target.value) || 8;
                        const newMedia = media.map((x) =>
                          x.id === m.id ? { ...x, duration: v } : x
                        );
                        saveMedia(newMedia);
                        setMedia(newMedia);
                      }}
                      className="w-16"
                    />
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        const newMedia = media.filter((x) => x.id !== m.id);
                        saveMedia(newMedia);
                        setMedia(newMedia);
                        toast.success(`Deleted ${m.name}`);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* 2. Build Playlist */}
        <Card>
          <CardHeader>
            <CardTitle>2. Build Playlist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!isDragging) setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              className={
                "rounded-xl border-2 border-dashed transition-colors p-6 sm:p-8 " +
                (isDragging ? " border-primary/60 bg-primary/5" : " border-border")
              }
            >
              <div className="space-y-2">
                <p className="font-medium">Drag & drop files here to upload to library</p>
                <p className="text-xs text-muted-foreground">
                  Images, videos (auto-detects duration), PDF, Office docs.
                </p>
                <Button size="sm" onClick={onBrowse}>Browse files</Button>
              </div>
              {uploading && (
                <div className="mt-4 space-y-2">
                  {Object.keys(progress).map((name) => (
                    <div key={name} className="text-xs text-muted-foreground flex items-center justify-between">
                      <span className="truncate max-w-[70%]" title={name}>{name}</span>
                      <span className="tabular-nums">{progress[name]}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3">
              <Label htmlFor="plname" className="w-full sm:w-40">Playlist name</Label>
              <Input id="plname" value={playlistName} onChange={(e) => setPlaylistName(e.target.value)} className="w-full" />
            </div>

            <Button size="sm" variant="secondary" onClick={clearBuilder}>Clear playlist</Button>

            <div
              className="mt-4 rounded-md border divide-y"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const dt = e.dataTransfer;
                if (dt.files?.length) {
                  handleFiles(dt.files);
                  return;
                }
                const data = dt.getData("text/plain");
                if (data.startsWith("add:")) {
                  const mid = data.slice(4);
                  const mm = media.find((x) => x.id === mid);
                  if (mm) {
                    const dur = mm.duration || 8;
                    const newIt: PlaylistItem = {
                      id: uid("pli"),
                      mediaId: mid,
                      duration: dur,
                      ...(mm.type === "video"
                        ? {
                            startSec: 0,
                            endSec: dur, // default to full video duration
                          }
                        : {}),
                    };
                    setItems((prev) => [...prev, newIt]);
                    toast.success(`Added "${mm.name}" to playlist`);
                  }
                }
              }}
            >
              {items.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  Drag media from library above to build your playlist.
                </div>
              ) : (
                items.map((it, i) => {
                  const m = media.find((mm) => mm.id === it.mediaId);
                  return (
                    <div
                      key={it.id}
                      draggable
                      onDragStart={() => handleDragStart(i)}
                      onDragOver={(e) => handleDragOver(e, i)}
                      onDrop={() => handleDropItem(i)}
                      className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 bg-background"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate" title={m?.name || it.mediaId}>
                          {m?.name || it.mediaId}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {m?.type.toUpperCase()} • {it.duration || m?.duration || 8}s
                        </div>
                      </div>
                      <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                        <Input
                          type="number"
                          className="w-20 flex-shrink-0"
                          min={1}
                          value={it.duration ?? m?.duration ?? 8}
                          onChange={(e) => {
                            const v = Number(e.target.value) || 8;
                            setItems((prev) =>
                              prev.map((p, idx) => (idx === i ? { ...p, duration: v } : p))
                            );
                          }}
                          placeholder="Duration (s)"
                        />
                        {m?.type === "video" && (
                          <div className="flex items-center gap-1 text-xs w-full sm:w-auto">
                            <Label className="whitespace-nowrap">From</Label>
                            <Input
                              type="number"
                              className="w-16"
                              min={0}
                              value={it.startSec ?? 0}
                              onChange={(e) => {
                                const v = Number(e.target.value) || 0;
                                setItems((prev) =>
                                  prev.map((p, idx) =>
                                    idx === i ? { ...p, startSec: Math.max(0, v) } : p
                                  )
                                );
                              }}
                              placeholder="0"
                            />
                            <Label className="whitespace-nowrap">To</Label>
                            <Input
                              type="number"
                              className="w-16"
                              min={0}
                              value={it.endSec ?? (m.duration || "")}
                              onChange={(e) => {
                                const v = Number(e.target.value) || 0;
                                const start = it.startSec ?? 0;
                                setItems((prev) =>
                                  prev.map((p, idx) =>
                                    idx === i
                                      ? { ...p, endSec: v >= start ? v : (it.endSec ?? 0) }
                                      : p
                                  )
                                );
                              }}
                              placeholder={m.duration?.toString() || "full"}
                            />
                          </div>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeItem(i)}
                          className="flex-shrink-0"
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        {/* 3. Schedule & Publish */}
        <Card>
          <CardHeader>
            <CardTitle>3. Schedule & Publish</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Label className="text-sm">Days:</Label>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((d) => (
                    <label key={d.i} className="inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
                      <Checkbox
                        checked={days.includes(d.i)}
                        onCheckedChange={(v) =>
                          setDays((prev) =>
                            Boolean(v) ? [...prev, d.i].sort() : prev.filter((x) => x !== d.i)
                          )
                        }
                      />
                      {d.name}
                    </label>
                  ))}
                </div>
              </div>

              <Separator orientation="vertical" className="hidden sm:block h-6" />

              <div className="flex items-center gap-2">
                <Label htmlFor="start" className="text-sm">Start</Label>
                <Input id="start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="end" className="text-sm">End</Label>
                <Input id="end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={savePlaylist}>Save playlist</Button>
              <Button asChild variant="secondary"><Link href="/player" target="_blank">Preview in Player</Link></Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}