"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ListOrdered, ArrowRight } from "lucide-react";
import type { Project } from "@/types";

export default function BoqGlobalPage() {
  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => { const r = await fetch("/api/projects"); const d = await r.json(); return Array.isArray(d) ? d : []; },
  });
  const active = projects.filter((p) => p.status === "ACTIVE");
  return (
    <div className="space-y-5">
      <p className="text-sm text-(--muted-foreground)">Select a project to view or generate its Bill of Quantities.</p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {active.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}/boq`} className="group flex items-center gap-4 rounded-xl border border-(--border) bg-(--card) p-5 hover:shadow-md transition-shadow">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100">
              <ListOrdered className="h-5 w-5 text-violet-500" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-(--foreground)">{p.name}</p>
              <p className="text-sm text-(--muted-foreground)">Generate BOQ →</p>
            </div>
            <ArrowRight className="h-4 w-4 text-(--muted-foreground) group-hover:text-violet-500 transition-colors" />
          </Link>
        ))}
      </div>
    </div>
  );
}
