/**
 * /api/floorplan/scale-detect
 * Forwards uploaded PDF to Python server → returns detected scale.
 * Called immediately on file upload (before full pipeline).
 */

import { NextResponse } from "next/server";

const BACKEND = process.env.FLOORPLAN_API_URL ?? "http://localhost:8001";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "file required", detected: false }, { status: 400 });
    }

    const fwd      = new FormData();
    const filename = (file as File).name ?? "upload.pdf";
    fwd.append("file", new Blob([await file.arrayBuffer()], { type: file.type }), filename);

    const page = form.get("page");
    fwd.append("page", page ? String(page) : "1");

    const res = await fetch(`${BACKEND}/api/floorplan/scale-detect`, {
      method: "POST",
      body:   fwd,
      signal: AbortSignal.timeout(20_000),   // fast — scale detect only
    });

    if (!res.ok) {
      return NextResponse.json({ detected: false, scale: null, error: `Backend ${res.status}` });
    }

    const data = await res.json();
    return NextResponse.json(data);

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // Server not running → return gracefully (not an error for the user)
    return NextResponse.json({ detected: false, scale: null, error: msg });
  }
}
