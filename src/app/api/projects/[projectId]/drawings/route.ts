import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const drawings = await prisma.drawing.findMany({
      where: { projectId },
      include: { scale: true, _count: { select: { annotations: true } } },
      orderBy: { uploadedAt: "desc" },
    });
    return NextResponse.json(drawings);
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
