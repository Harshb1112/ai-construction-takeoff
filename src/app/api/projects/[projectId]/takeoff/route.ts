import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const items = await prisma.takeoffItem.findMany({
      where: { projectId },
      orderBy: [{ category: "asc" }, { description: "asc" }],
    });
    return NextResponse.json(items);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = await request.json();

    const item = await prisma.takeoffItem.create({
      data: {
        projectId,
        drawingId: body.drawingId ?? null,
        source: body.source ?? "MANUAL",
        category: body.category,
        subcategory: body.subcategory ?? null,
        description: body.description,
        quantity: parseFloat(body.quantity),
        unit: body.unit,
        unitCost: body.unitCost ? parseFloat(body.unitCost) : null,
        totalCost: body.unitCost ? parseFloat(body.quantity) * parseFloat(body.unitCost) : null,
        wastePercent: parseFloat(body.wastePercent ?? "0"),
        aiProvider: body.aiProvider ?? null,
        confidence: body.confidence ?? null,
        notes: body.notes ?? null,
        metadata: body.metadata ?? null,
      },
    });

    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    console.error("POST takeoff error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = await request.json();
    const { id, unitCost, quantity, description, category, unit, notes } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const uc = unitCost !== undefined ? parseFloat(String(unitCost)) : undefined;
    const qty = quantity !== undefined ? parseFloat(String(quantity)) : undefined;

    const item = await prisma.takeoffItem.update({
      where: { id },
      data: {
        ...(description !== undefined && { description }),
        ...(category   !== undefined && { category }),
        ...(unit       !== undefined && { unit }),
        ...(notes      !== undefined && { notes }),
        ...(qty        !== undefined && { quantity: qty }),
        ...(uc         !== undefined && { unitCost: uc }),
        // Recalculate totalCost whenever either changes
        ...(uc !== undefined || qty !== undefined
          ? { totalCost: (uc ?? 0) * (qty ?? 0) || null }
          : {}
        ),
      },
    });
    return NextResponse.json(item);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (id) {
      await prisma.takeoffItem.delete({ where: { id } });
    } else {
      await prisma.takeoffItem.deleteMany({ where: { projectId } });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
