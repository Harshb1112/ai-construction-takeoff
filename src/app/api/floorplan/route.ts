/**
 * /api/floorplan  — proxy that forwards the raw PDF/image to the Python ML server.
 *
 * Accepts multipart/form-data with:
 *   file        — PDF or image file (required)
 *   scale_hint  — e.g. "auto" or "1:100" (optional)
 *   page        — 1-based page number (optional, default 1)
 *   all_pages   — "true" to analyze every page (optional)
 *
 * Returns the JSON from http://localhost:8001/api/floorplan/analyze
 * or a 503 if the Python backend is not reachable.
 */

import { NextResponse } from "next/server";

// Allow up to 5 minutes for large PDFs with EasyOCR + TextGuided flood fill
export const maxDuration = 300;

const BACKEND = process.env.FLOORPLAN_API_URL ?? "http://localhost:8001";

export async function POST(request: Request) {
  try {
    // Accept raw multipart — forward directly to Python server
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ error: "multipart/form-data required" }, { status: 400 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "file field required" }, { status: 400 });
    }

    // Build forwarded form
    const fwd = new FormData();
    const filename = (file as File).name ?? "upload.pdf";
    fwd.append("file", new Blob([await file.arrayBuffer()], { type: file.type }), filename);

    const scaleHint = form.get("scale_hint");
    if (scaleHint) fwd.append("scale_hint", String(scaleHint));

    const page = form.get("page");
    fwd.append("page", page ? String(page) : "1");

    // Route to all-pages endpoint if requested
    const allPages = form.get("all_pages");
    const endpoint = allPages === "true"
      ? `${BACKEND}/api/floorplan/analyze-all-pages`
      : `${BACKEND}/api/floorplan/analyze`;

    // Forward to Python ML backend
    const res = await fetch(endpoint, {
      method: "POST",
      body: fwd,
      signal: AbortSignal.timeout(300_000), // 5 min — EasyOCR + flood fill can be slow
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown error");
      return NextResponse.json(
        { error: `Python backend returned ${res.status}: ${errText}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("fetch") || msg.includes("ECONNREFUSED") || msg.includes("timeout")) {
      return NextResponse.json(
        { error: "Floor plan ML server not running. Start it with: python scripts/floorplan_server.py" },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
