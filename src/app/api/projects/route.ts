import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Single-tenant local user — configurable via environment variables.
// No authentication is required for this local-only app.
export const LOCAL_USER_ID    = process.env.APP_USER_ID    ?? "local-user";
const LOCAL_USER_EMAIL = process.env.APP_USER_EMAIL ?? "admin@construction.ai";
const LOCAL_USER_NAME  = process.env.APP_USER_NAME  ?? "Admin";

// Ensure the local user row exists — called lazily once per process lifetime.
let userReady = false;
let currentUserId = LOCAL_USER_ID;
async function ensureUser() {
  if (userReady) return;

  const userById = await prisma.user.findUnique({ where: { id: LOCAL_USER_ID } });
  if (userById) {
    userReady = true;
    return;
  }

  const userByEmail = await prisma.user.findUnique({ where: { email: LOCAL_USER_EMAIL } });
  if (userByEmail) {
    currentUserId = userByEmail.id;
    userReady = true;
    return;
  }

  await prisma.user.create({
    data: { id: LOCAL_USER_ID, email: LOCAL_USER_EMAIL, name: LOCAL_USER_NAME },
  });
  userReady = true;
}

export async function GET(request: Request) {
  try {
    await ensureUser();
    const { searchParams } = new URL(request.url);

    if (searchParams.get("stats")) {
      const [projectCount, drawingCount, takeoffAgg, recentProjects] = await Promise.all([
        prisma.project.count({
          where: { ownerId: currentUserId, status: { not: "DELETED" } },
        }),
        prisma.drawing.count({
          where: { project: { ownerId: currentUserId } },
        }),
        prisma.takeoffItem.aggregate({
          where: { project: { ownerId: currentUserId } },
          _count: true,
          _sum: { totalCost: true },
        }),
        prisma.project.findMany({
          where: { ownerId: currentUserId, status: { not: "DELETED" } },
          include: { _count: { select: { drawings: true, takeoffItems: true } } },
          orderBy: { updatedAt: "desc" },
          take: 5,
        }),
      ]);

      return NextResponse.json({
        projectCount,
        drawingCount,
        takeoffCount: takeoffAgg._count,
        totalCost: takeoffAgg._sum.totalCost ?? 0,
        recentProjects,
      });
    }

    const projects = await prisma.project.findMany({
      where: { ownerId: currentUserId, status: { not: "DELETED" } },
      include: {
        _count: { select: { drawings: true, takeoffItems: true, boqItems: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json(projects);
  } catch (error) {
    console.error("GET /api/projects:", error);
    return NextResponse.json(
      { error: "Database error: " + (error as Error).message },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  try {
    await ensureUser();
    const body = await request.json();
    const { name, description, address, costRegion } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Project name is required" }, { status: 400 });
    }

    const project = await prisma.project.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        address: address?.trim() || null,
        costRegion: costRegion || "us_national",
        ownerId: currentUserId,
      },
      include: {
        _count: { select: { drawings: true, takeoffItems: true, boqItems: true } },
      },
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error("POST /api/projects:", error);
    return NextResponse.json(
      { error: "Failed to create project: " + (error as Error).message },
      { status: 500 }
    );
  }
}
