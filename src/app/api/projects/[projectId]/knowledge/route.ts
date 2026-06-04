import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const docs = await prisma.knowledgeDoc.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, type: true, chunks: true, summary: true, content: true, createdAt: true },
  });
  return NextResponse.json(docs);
}

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const data = await req.json();
  const doc = await prisma.knowledgeDoc.create({
    data: {
      projectId,
      name:    data.name,
      type:    data.type    ?? "pdf",
      content: data.content ?? "",
      chunks:  data.chunks  ?? 1,
      summary: data.summary,
    },
  });
  return NextResponse.json(doc);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { id } = await req.json();
  await prisma.knowledgeDoc.deleteMany({ where: { id, projectId } });
  return NextResponse.json({ ok: true });
}

// Search endpoint — real keyword search over stored content
export async function PATCH(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { query } = await req.json();
  if (!query) return NextResponse.json([]);

  const docs = await prisma.knowledgeDoc.findMany({ where: { projectId } });
  const queryLower = query.toLowerCase();
  const words = queryLower.split(/\s+/).filter((w: string) => w.length > 2);

  const results = docs
    .flatMap(doc => {
      const lines = doc.content.split(/\n+/).filter((l: string) => l.trim().length > 20);
      return lines
        .map((chunk: string) => {
          const cl = chunk.toLowerCase();
          const hits = words.filter((w: string) => cl.includes(w)).length;
          const relevance = hits / Math.max(words.length, 1);
          return { docName: doc.name, chunk, relevance };
        })
        .filter((r: { docName: string; chunk: string; relevance: number }) => r.relevance > 0);
    })
    .sort((a: { relevance: number }, b: { relevance: number }) => b.relevance - a.relevance)
    .slice(0, 8);

  return NextResponse.json(results);
}
