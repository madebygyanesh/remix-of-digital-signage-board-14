import { NextRequest, NextResponse } from "next/server";
import { promises as fsp } from "fs";
import path from "path";

export const runtime = "nodejs";

const uploadsDir = path.join(process.cwd(), "public", "uploads");

function resolveUploadPath(input: string) {
  // input can be a URL (/uploads/abc-file.ext) or a bare filename
  const rel = input.startsWith("/uploads/") ? input.replace("/uploads/", "") : input;
  const safe = rel.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(uploadsDir, safe);
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json().catch(() => ({}));
    const src: string | undefined = data.src || data.filename;
    if (!src) {
      return NextResponse.json({ error: "Missing src/filename" }, { status: 400 });
    }
    const fp = resolveUploadPath(src);
    // Ensure path is within uploadsDir
    const normalized = path.normalize(fp);
    if (!normalized.startsWith(uploadsDir)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }
    await fsp.unlink(normalized).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to delete" }, { status: 500 });
  }
}