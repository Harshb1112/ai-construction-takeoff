// Proxy: Next.js → Python floorplan server (click-to-measure)
import { NextResponse } from "next/server";

const FLOORPLAN_URL = process.env.FLOORPLAN_API_URL ?? "http://localhost:8001";

export async function POST(req: Request) {
  try {
    const body = await req.formData();
    const res  = await fetch(`${FLOORPLAN_URL}/api/floorplan/click-room`, {
      method: "POST",
      body,
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { error: `Floorplan server unreachable: ${e}` },
      { status: 503 }
    );
  }
}
