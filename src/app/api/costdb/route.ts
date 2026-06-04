import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { COST_DATABASE, CURRENCY_MULTIPLIERS, type Region } from "@/lib/cost-database";

// Seed DB from static file if empty
async function seedIfEmpty() {
  const count = await prisma.costItem.count();
  if (count > 0) return;

  const rows: {
    csiCode: string; description: string; unit: string;
    region: string; laborCost: number; materialCost: number; totalCost: number;
    year: number; source: string;
  }[] = [];

  for (const item of COST_DATABASE) {
    for (const [region, price] of Object.entries(item.prices)) {
      if (!price) continue;
      rows.push({
        csiCode:      item.csiCode,
        description:  item.description,
        unit:         item.unit,
        region,
        laborCost:    price.labor,
        materialCost: price.material,
        totalCost:    price.total,
        year:         2025,
        source:       "RSMeans/CWICR",
      });
    }
  }

  for (const row of rows) {
    await prisma.costItem.upsert({
      where: { csiCode_region_year: { csiCode: row.csiCode, region: row.region, year: row.year } },
      create: row,
      update: {},
    });
  }
}

// GET — list / search from DB
export async function GET(req: Request) {
  await seedIfEmpty();

  const { searchParams } = new URL(req.url);
  const q      = searchParams.get("q")?.toLowerCase().trim() ?? "";
  const region = (searchParams.get("region") ?? "us_national") as Region;
  const limit  = Math.min(parseInt(searchParams.get("limit") ?? "40"), 100);

  const items = await prisma.costItem.findMany({
    where: {
      region,
      ...(q ? {
        OR: [
          { description: { contains: q } },
          { csiCode:     { contains: q } },
        ],
      } : {}),
    },
    orderBy: { csiCode: "asc" },
    take: limit,
  });

  const mult = CURRENCY_MULTIPLIERS[region]?.multiplier ?? 1;
  return NextResponse.json(
    items.map(i => ({
      ...i,
      laborCost:    +(i.laborCost    * mult).toFixed(2),
      materialCost: +(i.materialCost * mult).toFixed(2),
      totalCost:    +(i.totalCost    * mult).toFixed(2),
    }))
  );
}

// PATCH — update a single item's price (manual edit)
export async function PATCH(req: Request) {
  const { id, laborCost, materialCost, totalCost } = await req.json();
  const item = await prisma.costItem.update({
    where: { id },
    data:  { laborCost, materialCost, totalCost: totalCost ?? laborCost + materialCost },
  });
  return NextResponse.json(item);
}
