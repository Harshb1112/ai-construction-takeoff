import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import path from "path";
import fs from "fs";
import type { FileFormat } from "@/types";
import { randomUUID } from "crypto";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

const FORMAT_MAP: Record<string, FileFormat> = {
  pdf: "PDF", dwg: "DWG", dxf: "DXF",
  png: "PNG", jpg: "JPG", jpeg: "JPEG", ifc: "IFC",
};

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const projectId = formData.get("projectId") as string;

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    // Validate file type
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const format = FORMAT_MAP[ext];
    if (!format) {
      return NextResponse.json({
        error: `Unsupported format: .${ext}. Supported: PDF, DWG, DXF, IFC, PNG, JPG`
      }, { status: 400 });
    }

    // Validate file size (100MB max)
    const MAX_SIZE = 100 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large (max 100MB)" }, { status: 400 });
    }

    // Ensure upload directory exists
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    // Save file with UUID name (no Math.random)
    const uuid = randomUUID();
    const filename = `${uuid}.${ext}`;
    const filePath = path.join(UPLOAD_DIR, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    const fileUrl = `/uploads/${filename}`;

    // Verify project exists before creating drawing
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      fs.unlinkSync(filePath); // Clean up orphaned file
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Save drawing to DB
    const drawing = await prisma.drawing.create({
      data: {
        projectId,
        filename,
        originalName: file.name,
        fileUrl,
        fileFormat: format,
        fileSizeBytes: file.size,
      },
    });

    // Try FastAPI processing (optional, non-blocking)
    const fastapiUrl = process.env.FASTAPI_URL;
    if (fastapiUrl && fastapiUrl !== "http://localhost:8000") {
      // Fire-and-forget FastAPI processing
      const fastapiForm = new FormData();
      fastapiForm.append("file", new Blob([buffer], { type: file.type }), file.name);
      fetch(`${fastapiUrl}/api/upload/drawing`, { method: "POST", body: fastapiForm })
        .then(async res => {
          if (res.ok) {
            const data = await res.json();
            await prisma.drawing.update({
              where: { id: drawing.id },
              data: { fastapiId: data.drawing_id },
            });
          }
        })
        .catch(() => {}); // FastAPI is optional
    }

    return NextResponse.json(drawing, { status: 201 });

  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Upload failed: " + (error as Error).message },
      { status: 500 }
    );
  }
}
