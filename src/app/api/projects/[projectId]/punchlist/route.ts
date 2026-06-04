import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const items = await prisma.punchItem.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(items);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = await request.json();
    const item = await prisma.punchItem.create({
      data: {
        projectId,
        title: body.title,
        description: body.description ?? null,
        status: body.status ?? "OPEN",
        priority: body.priority ?? "MEDIUM",
        category: body.category ?? "General",
        location: body.location ?? null,
        assignedTo: body.assignedTo ?? null,
      },
    });
    return NextResponse.json(item, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    await params;
    const body = await request.json();
    const { id, ...data } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const item = await prisma.punchItem.update({ where: { id }, data });
    return NextResponse.json(item);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    await params;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await prisma.punchItem.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
