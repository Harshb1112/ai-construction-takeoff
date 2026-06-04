"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  FolderOpen, FileText, Calculator, TrendingUp,
  Plus, ArrowRight, Sparkles,
  BarChart3, Zap, Shield
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import styles from "./page.module.css";

async function fetchStats() {
  const res = await fetch("/api/projects?stats=true");
  if (!res.ok) return null;
  return res.json();
}

const STAT_CARDS = [
  { key: "projectCount", label: "Total Projects", icon: FolderOpen, iconClass: "blueIcon" },
  { key: "drawingCount", label: "Drawings",        icon: FileText,   iconClass: "purpleIcon" },
  { key: "takeoffCount", label: "Takeoff Items",   icon: Calculator, iconClass: "greenIcon" },
  { key: "totalCost",    label: "Total Est. Cost", icon: TrendingUp, iconClass: "orangeIcon", isCurrency: true },
];

const FEATURE_ITEMS = [
  { icon: Zap,      label: "AI Takeoff",   desc: "Groq LLaMA 3 vision", color: "#f59e0b" },
  { icon: BarChart3, label: "S-Curve",     desc: "EVM Analytics",        color: "#2563eb" },
  { icon: Shield,   label: "BOQ Validate", desc: "42 NRM/CSI rules",     color: "#059669" },
];

const ACTIONS = [
  { href: "/projects/new", icon: Plus,      label: "New Project",    desc: "Start a new takeoff",         cardClass: "quickActionNew", iconClass: "quickActionIconBlue", iconColor: "#fff" },
  { href: "/takeoff",      icon: Calculator, label: "Run AI Takeoff", desc: "Extract with Groq LLaMA",     cardClass: "quickActionTakeoff", iconClass: "quickActionIconGreen", iconColor: "#fff" },
  { href: "/boq",          icon: FileText,   label: "Generate BOQ",   desc: "Bill of quantities + GAEB",   cardClass: "quickActionBOQ", iconClass: "quickActionIconPurple", iconColor: "#fff" },
];

export default function DashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ["dashboard-stats"], queryFn: fetchStats });

  return (
    <div className={`${styles.root} page-enter`}>
      <div className={styles.hero}>
        <div className={styles.heroDecor} />
        <div className={styles.heroDecor2} />

        <div className={styles.heroTag}>
          <Sparkles size={20} color="#fbbf24" />
          Powered by Groq LLaMA 3
        </div>

        <h2 className={styles.heroHeading}>AI Construction Takeoff</h2>
        <p className={styles.heroText}>
          Upload drawings → AI extracts materials → Generate BOQ → Schedule with EVM. From PDF to quote in minutes.
        </p>

        <div className={styles.heroActions}>
          <Link href="/projects/new" className={styles.primaryAction}>
            <Plus size={15} />
            New Project
          </Link>
          <Link href="/projects" className={styles.secondaryAction}>
            View All
            <ArrowRight size={14} />
          </Link>
        </div>

        <div className={styles.featurePills}>
          {FEATURE_ITEMS.map(({ icon: Icon, label, desc, color }) => (
            <div key={label} className={styles.featurePill}>
              <Icon size={12} color={color} />
              <strong>{label}</strong> — {desc}
            </div>
          ))}
        </div>
      </div>

      <div className={styles.statsGrid}>
        {STAT_CARDS.map(({ key, label, icon: Icon, iconClass, isCurrency }) => (
          <div key={key} className={styles.statCard}>
            <div className={styles.statHeader}>
              <p className={styles.statLabel}>{label}</p>
              <div className={`${styles.statIcon} ${styles[iconClass as keyof typeof styles]}`}>
                <Icon size={17} color="#fff" />
              </div>
            </div>
            {isLoading ? (
              <div className={`${styles.skeleton} ${styles.skeletonLarge}`} />
            ) : (
              <p className={styles.statValue}>
                {isCurrency ? formatCurrency(data?.[key] ?? 0) : (data?.[key] ?? 0)}
              </p>
            )}
          </div>
        ))}
      </div>

      <div>
        <h3 className={styles.quickActionsHeader}>Quick Actions</h3>
        <div className={styles.quickActionGrid}>
          {ACTIONS.map(({ href, icon: Icon, label, desc, cardClass, iconClass, iconColor }) => (
            <Link key={href} href={href} className={`${styles.quickActionCard} ${styles[cardClass as keyof typeof styles]}`}>
              <div className={`${styles.quickActionIcon} ${styles[iconClass as keyof typeof styles]}`}>
                <Icon size={18} color={iconColor} />
              </div>
              <div className={styles.quickActionContent}>
                <p className={styles.quickActionTitle}>{label}</p>
                <p className={styles.quickActionDesc}>{desc}</p>
              </div>
              <ArrowRight size={14} color="#94a3b8" />
            </Link>
          ))}
        </div>
      </div>

      <div className={styles.projectsPanel}>
        <div className={styles.projectsHeader}>
          <h3 className={styles.projectsTitle}>Recent Projects</h3>
          <Link href="/projects" className={styles.viewAllLink}>View all →</Link>
        </div>

        {isLoading ? (
          <div className={styles.projectsBody}>
            {[1,2,3].map((i) => (
              <div key={i} className={styles.projectRow}>
                <div className={`${styles.skeleton} ${styles.skeletonCircle}`} />
                <div className={styles.flexFill}>
                  <div className={`${styles.skeleton} ${styles.skeletonMedium}`} />
                  <div className={`${styles.skeleton} ${styles.skeletonSmall}`} />
                </div>
              </div>
            ))}
          </div>
        ) : !data?.recentProjects?.length ? (
          <div className={styles.projectEmpty}>
            <FolderOpen size={40} color="#cbd5e1" className={styles.projectEmptyIcon} />
            <p className={styles.projectEmptyText}>No projects yet</p>
            <Link href="/projects/new" className={styles.projectCreateButton}>
              <Plus size={14} />Create First Project
            </Link>
          </div>
        ) : (
          <div className={styles.projectsBody}>
            {data.recentProjects.map((p: { id: string; name: string; status: string; updatedAt: string; _count: { drawings: number } }) => (
              <Link key={p.id} href={`/projects/${p.id}`} className={styles.projectRow}>
                <div className={styles.projectIcon}>
                  <FolderOpen size={18} color="#2563eb" />
                </div>
                <div className={styles.projectInfo}>
                  <p className={styles.projectName}>{p.name}</p>
                  <p className={styles.projectMeta}>
                    {p._count?.drawings ?? 0} drawings · {new Date(p.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <span className={`${styles.projectBadge} ${p.status === "ACTIVE" ? styles.projectBadgeActive : styles.projectBadgeDefault}`}>
                  {p.status === "ACTIVE" ? "✓ Active" : p.status}
                </span>
                <ArrowRight size={14} color="#cbd5e1" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
