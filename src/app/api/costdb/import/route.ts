import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// POST — import CSV rows
// Expected CSV columns: csiCode, description, unit, region, laborCost, materialCost, totalCost, year, source
export async function POST(req: Request) {
  const { rows }: { rows: {
    csiCode: string; description: string; unit: string;
    region?: string; laborCost: number; materialCost: number; totalCost: number;
    year?: number; source?: string;
  }[] } = await req.json();

  if (!Array.isArray(rows) || rows.length === 0)
    return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  let imported = 0;
  for (const row of rows) {
    if (!row.csiCode || !row.description || !row.totalCost) continue;
    const region = row.region ?? "us_national";
    const year   = row.year   ?? new Date().getFullYear();
    await prisma.costItem.upsert({
      where: { csiCode_region_year: { csiCode: row.csiCode, region, year } },
      create: { ...row, region, year, source: row.source ?? "User import" },
      update: { ...row, region, year, source: row.source ?? "User import" },
    });
    imported++;
  }

  return NextResponse.json({ ok: true, imported });
}
