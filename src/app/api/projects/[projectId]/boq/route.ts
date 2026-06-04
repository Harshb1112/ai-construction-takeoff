import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const items = await prisma.boqItem.findMany({
      where: { projectId },
      orderBy: [{ section: "asc" }, { sortOrder: "asc" }],
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

    // Bulk generate from takeoff items
    if (body.generateFromTakeoff) {
      const takeoffItems = await prisma.takeoffItem.findMany({ where: { projectId } });

      // Group by category → BOQ section
      const grouped: Record<string, typeof takeoffItems> = {};
      for (const item of takeoffItems) {
        if (!grouped[item.category]) grouped[item.category] = [];
        grouped[item.category].push(item);
      }

      const boqData = Object.entries(grouped).flatMap(([section, sectionItems], sIdx) =>
        sectionItems.map((item: (typeof takeoffItems)[0], i: number) => ({
          projectId,
          section,
          description: item.description,
          unit: item.unit,
          quantity: item.quantity,
          unitCost: item.unitCost ?? 0,
          totalCost: item.totalCost ?? 0,
          notes: item.notes ?? null,
          sortOrder: sIdx * 100 + i,
        }))
      );

      await prisma.boqItem.deleteMany({ where: { projectId } });
      await prisma.boqItem.createMany({ data: boqData });
      const items = await prisma.boqItem.findMany({ where: { projectId }, orderBy: [{ section: "asc" }, { sortOrder: "asc" }] });
      return NextResponse.json(items, { status: 201 });
    }

    const item = await prisma.boqItem.create({
      data: {
        projectId,
        section: body.section,
        csiCode: body.csiCode ?? null,
        description: body.description,
        unit: body.unit,
        quantity: parseFloat(body.quantity),
        unitCost: parseFloat(body.unitCost),
        totalCost: parseFloat(body.quantity) * parseFloat(body.unitCost),
        notes: body.notes ?? null,
        sortOrder: body.sortOrder ?? 0,
      },
    });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    console.error("BOQ POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
