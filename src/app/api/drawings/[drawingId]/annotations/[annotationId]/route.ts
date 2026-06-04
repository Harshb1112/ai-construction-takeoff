import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function DELETE(_req: Request, { params }: { params: Promise<{ drawingId: string; annotationId: string }> }) {
  try {
    const { annotationId } = await params;
    await prisma.annotation.delete({ where: { id: annotationId } });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ drawingId: string; annotationId: string }> }) {
  try {
    const { annotationId } = await params;
    const body = await request.json();

    const annotation = await prisma.annotation.update({
      where: { id: annotationId },
      data: {
        // Allow updating all fields including geometry (for vertex drag/edit)
        ...(body.geometry    !== undefined && { geometry: body.geometry }),
        ...(body.label       !== undefined && { label:    body.label }),
        ...(body.userNote    !== undefined && { userNote: body.userNote }),
        ...(body.color       !== undefined && { color:    body.color }),
        ...(body.opacity     !== undefined && { opacity:  body.opacity }),
        ...(body.measurement !== undefined && { measurement: body.measurement }),
        ...(body.unit        !== undefined && { unit:     body.unit }),
        ...(body.aiAnalyzed  !== undefined && { aiAnalyzed: body.aiAnalyzed }),
        ...(body.aiResult    !== undefined && { aiResult: typeof body.aiResult === "string" ? body.aiResult : JSON.stringify(body.aiResult) }),
      },
    });

    return NextResponse.json(annotation);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
