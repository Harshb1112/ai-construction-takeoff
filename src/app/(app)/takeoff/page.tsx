"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Calculator, ArrowRight } from "lucide-react";
import type { Project } from "@/types";

async function fetchProjects(): Promise<(Project & { _count: { takeoffItems: number } })[]> {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

export default function TakeoffGlobalPage() {
  const { data: projects = [], isLoading } = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });
  const active = projects.filter((p) => p.status === "ACTIVE");

  return (
    <div className="space-y-5">
      <p className="text-sm text-(--muted-foreground)">Select a project to view or run its material takeoff.</p>
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-(--secondary)" />)}
        </div>
      ) : active.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <Calculator className="h-10 w-10 text-(--muted-foreground)" />
          <p className="text-sm text-(--muted-foreground)">No active projects. <Link href="/projects/new" className="text-sky-500 hover:underline">Create one</Link> to start a takeoff.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {active.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}/takeoff`}
              className="group flex items-center gap-4 rounded-xl border border-(--border) bg-(--card) p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
                <Calculator className="h-5 w-5 text-emerald-500" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-(--foreground)">{p.name}</p>
                <p className="text-sm text-(--muted-foreground)">{p._count?.takeoffItems ?? 0} items</p>
              </div>
              <ArrowRight className="h-4 w-4 text-(--muted-foreground) group-hover:text-emerald-500 transition-colors" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
