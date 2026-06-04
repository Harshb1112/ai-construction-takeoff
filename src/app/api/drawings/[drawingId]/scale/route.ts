import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PUT(request: Request, { params }: { params: Promise<{ drawingId: string }> }) {
  try {
    const { drawingId } = await params;
    const body = await request.json();

    const scale = await prisma.drawingScale.upsert({
      where: { drawingId },
      update: {
        notation: body.notation,
        pxPerUnit: body.pxPerUnit,
        realUnit: body.realUnit,
        scaleRatio: body.scaleRatio,
        calibratedBy: body.calibratedBy ?? "manual",
      },
      create: {
        drawingId,
        notation: body.notation,
        pxPerUnit: body.pxPerUnit,
        realUnit: body.realUnit ?? "ft",
        scaleRatio: body.scaleRatio,
        calibratedBy: body.calibratedBy ?? "manual",
      },
    });

    return NextResponse.json(scale);
  } catch (error) {
    console.error("Scale PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
