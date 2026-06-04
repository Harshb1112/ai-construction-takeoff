import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

const CONTENT_TYPES: Record<string, string> = {
  ".pdf":  "application/pdf",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".dwg":  "application/octet-stream",
  ".dxf":  "text/plain; charset=utf-8",
  ".ifc":  "application/octet-stream",
  ".rvt":  "application/octet-stream",
  ".svg":  "image/svg+xml",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // Prevent directory traversal
  const safe = path.basename(filename);
  const filePath = path.join(process.cwd(), "public", "uploads", safe);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(safe).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

  return new Response(buffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${safe}"`,
      "Cache-Control": "public, max-age=86400, immutable",
      "Content-Length": String(buffer.length),
    },
  });
}
