import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function DELETE(_req: Request, { params }: { params: Promise<{ projectId: string; itemId: string }> }) {
  try {
    const { itemId } = await params;
    await prisma.boqItem.delete({ where: { id: itemId } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string; itemId: string }> }) {
  try {
    const { itemId } = await params;
    const body = await request.json();
    const item = await prisma.boqItem.update({
      where: { id: itemId },
      data: {
        description: body.description,
        quantity: body.quantity ? parseFloat(body.quantity) : undefined,
        unitCost: body.unitCost ? parseFloat(body.unitCost) : undefined,
        totalCost: body.quantity && body.unitCost ? parseFloat(body.quantity) * parseFloat(body.unitCost) : undefined,
        notes: body.notes,
        sortOrder: body.sortOrder,
      },
    });
    return NextResponse.json(item);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
