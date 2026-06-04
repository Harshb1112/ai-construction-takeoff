import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const risks = await prisma.risk.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  return NextResponse.json(risks);
}

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await req.json();
  const risk = await prisma.risk.create({
    data: {
      projectId,
      title:       data.title,
      description: data.description,
      category:    data.category    ?? "Technical",
      probability: data.probability ?? 3,
      impact:      data.impact      ?? 3,
      score:       (data.probability ?? 3) * (data.impact ?? 3),
      mitigation:  data.mitigation  ?? "",
      owner:       data.owner,
      contingency: data.contingency ? parseFloat(data.contingency) : null,
      status:      "OPEN",
    },
  });
  return NextResponse.json(risk);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { id } = await req.json();
  await prisma.risk.deleteMany({ where: { id, projectId } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { id, ...data } = await req.json();
  const risk = await prisma.risk.update({ where: { id }, data });
  return NextResponse.json(risk);
}
