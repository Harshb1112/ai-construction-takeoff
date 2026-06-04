import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: Request, { params }: { params: Promise<{ drawingId: string }> }) {
  try {
    const { drawingId } = await params;
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") ?? "1");

    const annotations = await prisma.annotation.findMany({
      where: { drawingId, pageNumber: page },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json(annotations);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ drawingId: string }> }) {
  try {
    const { drawingId } = await params;
    const body = await request.json();

    const annotation = await prisma.annotation.create({
      data: {
        drawingId,
        pageNumber:     body.pageNumber   ?? 1,
        type:           body.type,
        geometry:       body.geometry,
        measurement:    body.measurement  ?? null,
        unit:           body.unit         ?? null,
        label:          body.label        ?? null,
        color:          body.color        ?? "#ef4444",
        opacity:        body.opacity      ?? 0.7,
        createdBy:      body.createdBy    ?? null,
        userNote:       body.userNote     ?? null,
        aiAnalyzed:     body.aiAnalyzed   ?? false,
        takeoffItemId:  body.takeoffItemId ?? null,
      },
    });

    return NextResponse.json(annotation, { status: 201 });
  } catch (error) {
    console.error("POST annotation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
