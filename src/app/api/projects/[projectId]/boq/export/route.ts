import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import ExcelJS from "exceljs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    const [project, items] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId } }),
      prisma.boqItem.findMany({
        where: { projectId },
        orderBy: [{ section: "asc" }, { sortOrder: "asc" }],
      }),
    ]);

    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const wb = new ExcelJS.Workbook();
    wb.creator = "AI Construction Takeoff";
    wb.created = new Date();

    const ws = wb.addWorksheet("BOQ", { pageSetup: { fitToPage: true, fitToWidth: 1 } });

    // ── Title block ──────────────────────────────────────────────
    ws.mergeCells("A1:H1");
    ws.getCell("A1").value = `BILL OF QUANTITIES — ${project.name.toUpperCase()}`;
    ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
    ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(1).height = 28;

    ws.mergeCells("A2:H2");
    ws.getCell("A2").value = `Generated: ${new Date().toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })}  |  Region: ${project.costRegion}`;
    ws.getCell("A2").font = { italic: true, size: 10, color: { argb: "FF64748B" } };
    ws.getCell("A2").alignment = { horizontal: "center" };
    ws.getRow(2).height = 18;

    // ── Column widths ────────────────────────────────────────────
    ws.columns = [
      { key: "pos",      width: 6  },
      { key: "section",  width: 24 },
      { key: "csiCode",  width: 14 },
      { key: "desc",     width: 42 },
      { key: "unit",     width: 8  },
      { key: "qty",      width: 10 },
      { key: "unitCost", width: 12 },
      { key: "total",    width: 14 },
    ];

    // ── Header row ───────────────────────────────────────────────
    const headerRow = ws.addRow(["#", "Section", "CSI Code", "Description", "Unit", "Qty", "Unit Cost", "Total"]);
    headerRow.eachCell(cell => {
      cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = { bottom: { style: "thin", color: { argb: "FF94A3B8" } } };
    });
    ws.getRow(3).height = 20;

    // ── Data rows grouped by section ─────────────────────────────
    const grouped: Record<string, typeof items> = {};
    for (const item of items) {
      if (!grouped[item.section]) grouped[item.section] = [];
      grouped[item.section].push(item);
    }

    let pos = 1;
    let grandTotal = 0;

    for (const [section, sectionItems] of Object.entries(grouped)) {
      // Section header
      const secRow = ws.addRow(["", section, "", "", "", "", "", ""]);
      ws.mergeCells(`B${secRow.number}:H${secRow.number}`);
      secRow.eachCell(cell => {
        cell.font = { bold: true, size: 11, color: { argb: "FF1E40AF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } };
      });
      secRow.height = 18;

      const sectionStart = ws.rowCount + 1;

      for (const item of sectionItems) {
        const row = ws.addRow([
          pos++,
          item.section,
          item.csiCode ?? "",
          item.description,
          item.unit,
          item.quantity,
          item.unitCost,
          item.totalCost,
        ]);
        row.getCell(6).numFmt = "#,##0.00";
        row.getCell(7).numFmt = '"$"#,##0.00';
        row.getCell(8).numFmt = '"$"#,##0.00';
        row.getCell(8).font = { bold: true, color: { argb: "FF059669" } };
        if (pos % 2 === 0) {
          row.eachCell(cell => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
          });
        }
      }

      // Section subtotal
      const sectionTotal = sectionItems.reduce((s, i) => s + i.totalCost, 0);
      grandTotal += sectionTotal;
      const stRow = ws.addRow(["", `${section} SUBTOTAL`, "", "", "", "", "", sectionTotal]);
      stRow.getCell(8).numFmt = '"$"#,##0.00';
      stRow.getCell(8).font = { bold: true };
      stRow.eachCell(cell => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0FDF4" } };
      });
    }

    // ── Grand total ───────────────────────────────────────────────
    ws.addRow([]);
    const gtRow = ws.addRow(["", "GRAND TOTAL", "", "", "", "", "", grandTotal]);
    gtRow.getCell(2).font = { bold: true, size: 13 };
    gtRow.getCell(8).numFmt = '"$"#,##0.00';
    gtRow.getCell(8).font = { bold: true, size: 13, color: { argb: "FF059669" } };
    gtRow.eachCell(cell => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
      cell.border = { top: { style: "double", color: { argb: "FF059669" } } };
    });
    gtRow.height = 24;

    const buf = await wb.xlsx.writeBuffer();
    const safeName = project.name.replace(/[^a-z0-9]/gi, "_").slice(0, 40);
    return new Response(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="BOQ_${safeName}.xlsx"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
