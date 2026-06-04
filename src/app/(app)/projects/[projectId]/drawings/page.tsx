"use client";

import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import type { ElementType } from "react";
import {
  FileText, ArrowRight, Clock, Upload,
  Layers, ImageIcon, File, Plus, Wand2, Trash2
} from "lucide-react";
import { FileUploadZone } from "@/components/upload/FileUploadZone";
import { formatBytes } from "@/lib/utils";
import type { Drawing } from "@/types";
import styles from "./page.module.css";

const FORMAT_ICONS: Record<string, { icon: ElementType; iconClass: string; badgeClass: string }> = {
  PDF:  { icon: FileText,  iconClass: "formatIconPDF", badgeClass: "formatBadgePDF" },
  DWG:  { icon: Layers,    iconClass: "formatIconDWG", badgeClass: "formatBadgeDWG" },
  DXF:  { icon: Layers,    iconClass: "formatIconDXF", badgeClass: "formatBadgeDXF" },
  IFC:  { icon: Layers,    iconClass: "formatIconIFC", badgeClass: "formatBadgeIFC" },
  PNG:  { icon: ImageIcon, iconClass: "formatIconPNG", badgeClass: "formatBadgePNG" },
  JPG:  { icon: ImageIcon, iconClass: "formatIconJPG", badgeClass: "formatBadgeJPG" },
  JPEG: { icon: ImageIcon, iconClass: "formatIconJPEG", badgeClass: "formatBadgeJPEG" },
};

export default function DrawingsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}`);
      if (!r.ok) throw new Error("Project not found");
      return r.json() as Promise<{ name: string; drawings: Drawing[] }>;
    },
  });

  const drawings: Drawing[] = project?.drawings ?? [];

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/drawings/${id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });

  return (
    <div className={`fade-up ${styles.root}`}>

      {/* Header */}
      <div className={styles.header}>
        <div>
          <h2 className={styles.headerTitle}>Drawings</h2>
          <p className={styles.headerMeta}>
            {project?.name} — {drawings.length} drawing{drawings.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link href={`/projects/${projectId}`} className={styles.actionLink}>
            <Plus size={14} /> Upload More
          </Link>
        </div>
      </div>

      {/* Upload zone */}
      <div className={styles.card}>
        <div className={styles.uploadHeader}>
          <div className={styles.uploadIcon}>
            <Upload size={16} color="#2563eb" />
          </div>
          <p className={styles.uploadTitle}>Upload Drawing</p>
        </div>
        <FileUploadZone
          projectId={projectId}
          onUploaded={() => queryClient.invalidateQueries({ queryKey: ["project", projectId] })}
        />
      </div>

      {/* Drawings grid */}
      {isLoading ? (
        <div className={styles.grid}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} className={`shimmer ${styles.shimmerCard}`} />
          ))}
        </div>
      ) : drawings.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <FileText size={28} color="#2563eb" />
          </div>
          <div>
            <p className={styles.emptyTitle}>No drawings uploaded yet</p>
            <p className={styles.emptyText}>
              Upload PDF, DWG, DXF, IFC, PNG or JPG files above
            </p>
          </div>
        </div>
      ) : (
        <div className={styles.drawingGrid}>
          {drawings.map(drawing => {
            const fmt = FORMAT_ICONS[drawing.fileFormat] ?? { icon: File, iconClass: "formatIconPDF", badgeClass: "formatBadgePDF" };
            const Icon = fmt.icon;
            return (
              <div key={drawing.id} className={styles.drawingCard}>
                {/* Drawing icon + info */}
                <div className={styles.drawingRow}>
                  <div className={`${styles.drawingIcon} ${styles[fmt.iconClass as keyof typeof styles]}`}>
                    <Icon size={22} />
                  </div>
                  <div className={styles.drawingInfo}>
                    <p className={styles.drawingTitle}>{drawing.originalName}</p>
                    <div className={styles.drawingMetaRow}>
                      <span className={`${styles.drawingBadge} ${styles[fmt.badgeClass as keyof typeof styles]}`}>
                        {drawing.fileFormat}
                      </span>
                      <span className={styles.drawingSize}>
                        {formatBytes(drawing.fileSizeBytes)}
                      </span>
                    </div>
                    <p className={styles.drawingUploaded}>
                      <Clock size={10} />
                      {new Date(drawing.uploadedAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  </div>
                </div>

                {/* Action buttons */}
                <div className={styles.actionRow}>
                  <Link href={`/projects/${projectId}/drawings/${drawing.id}`} className={styles.primaryButton}>
                    Open Editor
                    <ArrowRight size={13} />
                  </Link>
                  <Link
                    href={`/projects/${projectId}/takeoff?drawing=${drawing.id}`}
                    className={styles.secondaryButton}
                    title="AI Takeoff from this drawing"
                  >
                    <Wand2 size={13} />
                    AI
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      if (!deleteMutation.isPending && confirm("Delete this drawing?")) {
                        deleteMutation.mutate(drawing.id);
                      }
                    }}
                    title="Delete drawing"
                    className={styles.deleteButton}
                  >
                    <Trash2 size={13} />
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Quick tips */}
      {drawings.length > 0 && (
        <div className={styles.quickTips}>
          <p className={styles.quickTipsTitle}>
            💡 Editor features
          </p>
          <div className={styles.quickTipsGrid}>
            {[
              "Click 'Open Editor' → PDF/DWG opens with markup tools",
              "Draw area polygon → auto-calculates sq ft",
              "Use measure tool → real dimensions with scale",
              "'Ask AI about this drawing' → AI answers questions",
              "Stamp tool → APPROVED / REJECTED / FOR REVIEW",
              "Ctrl+scroll → zoom in/out on drawing",
            ].map(tip => (
              <p key={tip} className={styles.quickTipRow}>
                <span className={styles.quickTipBullet}>•</span> {tip}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
