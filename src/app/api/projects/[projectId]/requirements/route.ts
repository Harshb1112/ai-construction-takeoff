import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const reqs = await prisma.requirement.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  return NextResponse.json(reqs);
}

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await req.json();
  const req2 = await prisma.requirement.create({
    data: {
      projectId,
      entity:     data.entity,
      attribute:  data.attribute,
      constraint: data.constraint,
      category:   data.category   ?? "Structural",
      boqRef:     data.boqRef,
      status:     "OPEN",
      gate:       data.gate       ?? "completeness",
      notes:      data.notes,
    },
  });
  return NextResponse.json(req2);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { id } = await req.json();
  await prisma.requirement.deleteMany({ where: { id, projectId } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  await params;
  const { id, ...data } = await req.json();
  const r = await prisma.requirement.update({ where: { id }, data });
  return NextResponse.json(r);
}
