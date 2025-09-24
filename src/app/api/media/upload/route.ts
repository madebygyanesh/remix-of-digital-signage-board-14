import { NextRequest, NextResponse } from "next/server";
import { promises as fsp } from "fs";
import path from "path";

export const runtime = "nodejs";

const uploadsDir = path.join(process.cwd(), "public", "uploads");

async function ensureDir() {
  try {
    await fsp.mkdir(uploadsDir, { recursive: true });
  } catch {}
}

export async function POST(req: NextRequest) {
  await ensureDir();
  const form = await req.formData();
  const file = form.get("file");
  const id = String(form.get("id") || "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const originalName = (form.get("name") as string) || (file as any).name || "upload";
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `${id}-${safeName}`;
  const filepath = path.join(uploadsDir, filename);

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await fsp.writeFile(filepath, buffer);

  const url = `/uploads/${filename}`;
  return NextResponse.json({ id, url, filename });
}