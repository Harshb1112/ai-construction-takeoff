"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { FileText, ArrowRight, Clock } from "lucide-react";
import type { Project } from "@/types";
import { formatBytes } from "@/lib/utils";

export default function DrawingsPage() {
  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => { const r = await fetch("/api/projects"); const d = await r.json(); return Array.isArray(d) ? d : []; },
  });

  return (
    <div className="space-y-5">
      <p className="text-sm text-(--muted-foreground)">Select a project to view and markup its drawings.</p>
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-(--secondary)" />)}</div>
      ) : projects.filter(p => p.status === "ACTIVE").map((p) => (
        <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center gap-4 rounded-xl border border-(--border) bg-(--card) p-4 hover:shadow-md transition-shadow group">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100">
            <FileText className="h-5 w-5 text-sky-500" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-(--foreground)">{p.name}</p>
            <p className="text-xs text-(--muted-foreground)"><Clock className="inline h-3 w-3 mr-1" />{new Date(p.updatedAt).toLocaleDateString()}</p>
          </div>
          <ArrowRight className="h-4 w-4 text-(--muted-foreground) group-hover:text-sky-500 transition-colors" />
        </Link>
      ))}
    </div>
  );
}
