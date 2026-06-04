"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, FolderOpen, FileText, Calculator,
  ListOrdered, Download, Settings, HardHat,
  Camera, BookOpen, Layers, Calendar, CheckSquare, Wand2,
  Box, Home, Database, MessageSquare,
  Sparkles, Shield, AlertTriangle, PieChart, SquareKanban,
  Cpu, ChevronLeft, ChevronRight,
} from "lucide-react";
import styles from "./Sidebar.module.css";

const mainNav = [
  { label: "Dashboard",      href: "/dashboard",  icon: LayoutDashboard },
  { label: "Projects",       href: "/projects",   icon: FolderOpen },
  { label: "Drawings",       href: "/drawings",   icon: FileText },
{ label: "Takeoff",        href: "/takeoff",    icon: Calculator },
  { label: "BOQ",            href: "/boq",        icon: ListOrdered },
  { label: "Export",         href: "/export",     icon: Download },
  { label: "LM Studio AI",   href: "/lm-setup",  icon: Cpu },
  { label: "Settings",       href: "/settings",   icon: Settings },
];

const ALL_PROJECT_NAV = (id: string) => [
  { id: "_overview",   label: "Overview",            href: `/projects/${id}`,              icon: FolderOpen },
  { id: "drawings",    label: "Drawings & Markup",   href: `/projects/${id}/drawings`,     icon: FileText },
  { id: "rooms",       label: "Room Analyzer",       href: `/projects/${id}/rooms`,        icon: Home },
  { id: "model3d",     label: "3D BIM Viewer",       href: `/projects/${id}/model3d`,      icon: Box },
  { id: "ai-takeoff",  label: "AI Takeoff (7-step)", href: `/projects/${id}/ai-takeoff`,   icon: Cpu },
  { id: "takeoff",     label: "Takeoff",             href: `/projects/${id}/takeoff`,      icon: Calculator },
  { id: "extract",     label: "AI Extract",          href: `/projects/${id}/extract`,      icon: Wand2 },
  { id: "photo-boq",   label: "Photo → BOQ",         href: `/projects/${id}/photo-boq`,    icon: Camera },
  { id: "boq",         label: "BOQ",                 href: `/projects/${id}/boq`,          icon: ListOrdered },
  { id: "costdb",      label: "Cost Database",       href: `/projects/${id}/costdb`,       icon: Database },
  { id: "assemblies",  label: "Assemblies",          href: `/projects/${id}/assemblies`,   icon: Layers },
  { id: "explorer",    label: "Data Explorer",       href: `/projects/${id}/explorer`,     icon: PieChart },
  { id: "schedule",    label: "Schedule (4D+EVM)",   href: `/projects/${id}/schedule`,     icon: Calendar },
  { id: "kanban",      label: "BIM Kanban Tasks",    href: `/projects/${id}/kanban`,       icon: SquareKanban },
  { id: "punchlist",   label: "Punch List",          href: `/projects/${id}/punchlist`,    icon: CheckSquare },
  { id: "requirements",label: "Requirements (EAC)",  href: `/projects/${id}/requirements`, icon: Shield },
  { id: "risk",        label: "Risk Register",       href: `/projects/${id}/risk`,         icon: AlertTriangle },
  { id: "chat",        label: "AI Chat",             href: `/projects/${id}/chat`,         icon: MessageSquare },
  { id: "knowledge",   label: "Knowledge Base",      href: `/projects/${id}/knowledge`,    icon: BookOpen },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Sync collapsed → adjust mainWrapper margin directly
  useEffect(() => {
    const main = document.querySelector('[class*="mainWrapper"]') as HTMLElement | null;
    if (main) {
      main.style.marginLeft = collapsed ? "0px" : "240px";
      main.style.transition = "margin-left 0.25s ease";
    }
  }, [collapsed]);
  const projectId = pathname.includes("/projects/")
    ? pathname.split("/projects/")[1]?.split("/")[0]
    : null;
  const isInProject = !!projectId && projectId !== "new";

  const isActive = (href: string) =>
    pathname === href || (href.split("/").length > 3 && pathname.startsWith(href + "/"));

  const [enabledModules, setEnabledModules] = useState<Set<string> | null>(null);
  useEffect(() => {
    const stored = localStorage.getItem("enabled_modules");
    setEnabledModules(stored ? new Set(JSON.parse(stored)) : null);
  }, [pathname]);

  const projectNav = projectId
    ? ALL_PROJECT_NAV(projectId).filter(item =>
        item.id === "_overview" || !enabledModules || enabledModules.has(item.id)
      )
    : [];

  return (
    <aside className={styles.sidebar} style={{ transform: collapsed ? "translateX(-240px)" : "translateX(0)", transition: "transform 0.25s ease" }}>
      {/* Toggle button — on right edge of sidebar */}
      <button
        onClick={() => setCollapsed(v => !v)}
        style={{
          position: "absolute", right: -14, top: "50%",
          transform: "translateY(-50%)",
          width: 28, height: 48, borderRadius: 6,
          border: "1px solid #e2e8f0",
          background: "#fff", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "2px 0 8px rgba(0,0,0,0.1)",
          zIndex: 50, color: "#64748b",
        }}
        title={collapsed ? "Open sidebar" : "Close sidebar"}
      >
        {collapsed ? <ChevronRight size={14}/> : <ChevronLeft size={14}/>}
      </button>

      {/* Logo */}
      <div className={styles.logo}>
        <div className={styles.logoIcon}>
          <HardHat size={17} color="#fff" />
        </div>
        <div className={styles.logoText}>
          <p className={styles.logoName}>AI Takeoff</p>
          <p className={styles.logoSub}>Construction Suite</p>
        </div>
        <Sparkles size={13} color="#fbbf24" />
      </div>

      {/* Nav */}
      <nav className={styles.nav}>
        <p className={styles.sectionLabel}>Main</p>
        {mainNav.map(({ label, href, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
            >
              <Icon size={15} className={styles.navIcon} />
              <span className={styles.navLabel}>{label}</span>
              {active && <span className={styles.activeDot} />}
            </Link>
          );
        })}

        {isInProject && (
          <>
            <div className={styles.divider} />
            <p className={styles.sectionLabel}>This Project</p>
            {projectNav.map(({ label, href, icon: Icon }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`${styles.navItem} ${styles.navItemSub} ${active ? styles.navItemActive : ""}`}
                >
                  <Icon size={14} className={styles.navIcon} />
                  <span className={styles.navLabel}>{label}</span>
                  {active && <span className={styles.activeDot} />}
                </Link>
              );
            })}
          </>
        )}
      </nav>

      {/* Footer */}
      <div className={styles.footer}>
        <div className={styles.avatar}>
          {(process.env.NEXT_PUBLIC_APP_USER_NAME ?? "A")[0].toUpperCase()}
        </div>
        <div className={styles.userInfo}>
          <p className={styles.userName}>
            {process.env.NEXT_PUBLIC_APP_USER_NAME ?? "Admin"}
          </p>
          {process.env.NEXT_PUBLIC_APP_USER_EMAIL && (
            <p className={styles.userEmail}>
              {process.env.NEXT_PUBLIC_APP_USER_EMAIL}
            </p>
          )}
        </div>
        <Link href="/onboarding" title="Change role / modules" className={styles.roleLink}>
          Role
        </Link>
      </div>
    </aside>
  );
}
