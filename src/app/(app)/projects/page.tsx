"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { Plus, FolderOpen, Trash2, Search, FileText, Calculator, X, ChevronRight } from "lucide-react";
import type { Project } from "@/types";
import styles from "./page.module.css";

async function fetchProjects(): Promise<Project[]> {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const { data: projects = [], isLoading } = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      const res = await fetch("/api/projects", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setShowNew(false); setName(""); setDesc("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/projects/${id}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  const filtered = projects.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className={`${styles.page} fade-up`}>

      {/* Header */}
      <div className={styles.header}>
        <div className={styles.searchWrap}>
          <Search size={14} className={styles.searchIcon} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects..."
            className={styles.searchInput}
          />
        </div>
        <button className={styles.addBtn} onClick={() => setShowNew(true)}>
          <Plus size={15} /> New Project
        </button>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className={styles.grid}>
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className={`${styles.card} ${styles.skeletonCard}`}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div className={styles.skeleton} style={{ width: 44, height: 44, borderRadius: 12 }} />
                <div style={{ flex: 1 }}>
                  <div className={styles.skeleton} style={{ height: 14, width: "60%", marginBottom: 8 }} />
                  <div className={styles.skeleton} style={{ height: 11, width: "40%" }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>
            <FolderOpen size={28} color="#2563eb" />
          </div>
          <div>
            <p className={styles.emptyTitle}>
              {search ? "No projects found" : "No projects yet"}
            </p>
            <p className={styles.emptyDesc}>
              {search ? "Try a different search term." : "Create your first project to start a takeoff."}
            </p>
          </div>
          {!search && (
            <button className={styles.addBtn} onClick={() => setShowNew(true)}>
              <Plus size={15} /> Create First Project
            </button>
          )}
        </div>
      ) : (
        <div className={styles.grid}>
          {filtered.map(project => {
            const p = project as Project & { _count?: { drawings: number; takeoffItems: number } };
            return (
              <div key={project.id} className={styles.card}>
                {/* Top row */}
                <div className={styles.cardTop}>
                  <div className={styles.cardHeader}>
                    <div className={styles.iconBox}>
                      <FolderOpen size={20} color="#2563eb" />
                    </div>
                    <div className={styles.cardTitleGroup}>
                      <p className={styles.cardTitle}>{project.name}</p>
                      <span className={project.status === "ACTIVE" ? styles.badgeActive : styles.badgeDefault}>
                        {project.status === "ACTIVE" ? "Active" : project.status}
                      </span>
                    </div>
                  </div>
                  <button
                    className={styles.deleteBtn}
                    onClick={e => {
                      e.stopPropagation();
                      if (confirm("Delete project?")) deleteMutation.mutate(project.id);
                    }}
                    aria-label="Delete project"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {project.description && (
                  <p className={styles.cardDesc}>{project.description}</p>
                )}

                <div className={styles.cardStats}>
                  <span className={styles.cardStat}><FileText size={12} />{p._count?.drawings ?? 0} drawings</span>
                  <span className={styles.cardStat}><Calculator size={12} />{p._count?.takeoffItems ?? 0} items</span>
                </div>

                <Link href={`/projects/${project.id}`} className={styles.openBtn}>
                  Open Project <ChevronRight size={13} />
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {/* New Project Modal */}
      {showNew && (
        <div className={styles.overlay} onClick={() => setShowNew(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.modalTitle}>New Project</p>
                <p className={styles.modalSub}>Fill in the details to get started</p>
              </div>
              <button className={styles.closeBtn} onClick={() => setShowNew(false)} aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <div className={styles.fieldGroup}>
              <div>
                <label className={styles.label}>
                  Project Name <span className={styles.required}>*</span>
                </label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Residential Block A"
                  className={styles.textInput}
                  autoFocus
                />
              </div>
              <div>
                <label className={styles.label}>
                  Description <span className={styles.optional}>(optional)</span>
                </label>
                <textarea
                  value={desc}
                  onChange={e => setDesc(e.target.value)}
                  placeholder="Brief description of the project..."
                  className={styles.textarea}
                />
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button className={styles.cancelBtn} onClick={() => setShowNew(false)}>Cancel</button>
              <button
                className={styles.createBtn}
                disabled={!name.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate({ name, description: desc })}
              >
                {createMutation.isPending ? "Creating..." : "Create Project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
