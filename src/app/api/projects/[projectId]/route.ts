import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        drawings: {
          include: { scale: true },
          orderBy: { uploadedAt: "desc" },
        },
        _count: {
          select: { drawings: true, takeoffItems: true, boqItems: true },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json(project);
  } catch (error) {
    console.error("GET /api/projects/[id]:", error);
    return NextResponse.json(
      { error: "Database error: " + (error as Error).message },
      { status: 503 }
    );
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = await request.json();
    const project = await prisma.project.update({
      where: { id: projectId },
      data: {
        name: body.name,
        description: body.description,
        address: body.address,
        status: body.status,
        costRegion: body.costRegion,
      },
    });
    return NextResponse.json(project);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update: " + (error as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "DELETED" },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete: " + (error as Error).message },
      { status: 500 }
    );
  }
}
