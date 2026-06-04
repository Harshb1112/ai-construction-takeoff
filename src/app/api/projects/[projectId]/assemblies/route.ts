import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const assemblies = await prisma.assembly.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  return NextResponse.json(assemblies);
}

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await req.json();
  const assembly = await prisma.assembly.create({
    data: {
      projectId,
      name:        data.name,
      category:    data.category    ?? "General",
      description: data.description,
      parameters:  data.parameters  ?? [],
      components:  data.components  ?? [],
    },
  });
  return NextResponse.json(assembly);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { id } = await req.json();
  await prisma.assembly.deleteMany({ where: { id, projectId } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  await params;
  const { id, ...data } = await req.json();
  const a = await prisma.assembly.update({ where: { id }, data });
  return NextResponse.json(a);
}
