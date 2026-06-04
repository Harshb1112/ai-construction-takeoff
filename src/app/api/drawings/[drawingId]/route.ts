import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import path from "path";
import fs from "fs";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ drawingId: string }> }
) {
  try {
    const { drawingId } = await params;
    const drawing = await prisma.drawing.findUnique({
      where: { id: drawingId },
      include: {
        scale: true,
        _count: { select: { annotations: true } },
      },
    });
    if (!drawing) {
      return NextResponse.json({ error: "Drawing not found" }, { status: 404 });
    }
    return NextResponse.json(drawing);
  } catch (error) {
    return NextResponse.json(
      { error: "Database error: " + (error as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ drawingId: string }> }
) {
  try {
    const { drawingId } = await params;
    const drawing = await prisma.drawing.findUnique({ where: { id: drawingId } });
    if (!drawing) {
      return NextResponse.json({ error: "Drawing not found" }, { status: 404 });
    }

    const filePath = path.join(UPLOAD_DIR, drawing.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await prisma.drawing.delete({ where: { id: drawingId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Delete failed: " + (error as Error).message },
      { status: 500 }
    );
  }
}
