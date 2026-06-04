import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const tasks = await prisma.scheduleTask.findMany({
      where: { projectId },
      orderBy: { startDate: "asc" },
    });
    return NextResponse.json(tasks);
  } catch (e) {
    console.error("GET /schedule error:", e);
    return NextResponse.json({ error: "Failed to load schedule" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = await request.json();
    const task = await prisma.scheduleTask.create({
      data: {
        projectId,
        name: body.name,
        startDate: body.startDate,
        endDate: body.endDate,
        progress: parseInt(body.progress ?? "0"),
        phase: body.phase ?? "Foundation",
        color: body.color ?? "#2563eb",
        budget: parseFloat(body.budget ?? "0"),
        actualCost: parseFloat(body.actualCost ?? "0"),
        assignedTo: body.assignedTo ?? null,
        predecessor: body.predecessor ?? null,
        depType: body.depType ?? "FS",
        lag: parseInt(body.lag ?? "0"),
        critical: body.critical ?? false,
        notes: body.notes ?? null,
      },
    });
    return NextResponse.json(task, { status: 201 });
  } catch (e) {
    console.error("POST /schedule error:", e);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = await request.json();
    const { id, ...data } = body;
    if (!id) return NextResponse.json({ error: "Task ID required" }, { status: 400 });

    const task = await prisma.scheduleTask.update({
      where: { id },
      data: {
        name: data.name,
        startDate: data.startDate,
        endDate: data.endDate,
        progress: data.progress !== undefined ? parseInt(data.progress) : undefined,
        phase: data.phase,
        color: data.color,
        budget: data.budget !== undefined ? parseFloat(data.budget) : undefined,
        actualCost: data.actualCost !== undefined ? parseFloat(data.actualCost) : undefined,
        assignedTo: data.assignedTo,
        predecessor: data.predecessor,
        critical: data.critical,
        notes: data.notes,
      },
    });
    return NextResponse.json(task);
  } catch (e) {
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (id) {
      await prisma.scheduleTask.delete({ where: { id } });
    } else {
      // Delete all tasks for project
      await prisma.scheduleTask.deleteMany({ where: { projectId } });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
