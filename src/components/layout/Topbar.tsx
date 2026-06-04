"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Bell, Search, HelpCircle } from "lucide-react";
import styles from "./Topbar.module.css";

function getTitle(pathname: string): string {
  const seg = pathname.split("/").filter(Boolean);
  if (seg[0] === "dashboard")  return "Dashboard";
  if (seg[0] === "settings")   return "Settings";
  if (seg[0] === "drawings")   return "Drawings";
  if (seg[0] === "takeoff")    return "Takeoff";
  if (seg[0] === "boq")        return "Bill of Quantities";
  if (seg[0] === "export")     return "Export";
  if (seg[0] === "lm-setup")   return "LM Studio Setup";
  if (seg[0] === "projects") {
    if (!seg[1] || seg[1] === "new") return "Projects";
    const sub = seg[2];
    const map: Record<string, string> = {
      rooms: "Room Analyzer", model3d: "3D BIM Viewer",
      takeoff: "Material Takeoff", extract: "AI Extract",
      "photo-boq": "Photo → BOQ", boq: "BOQ",
      costdb: "Cost Database", assemblies: "Assemblies",
      schedule: "Schedule", punchlist: "Punch List",
      chat: "AI Chat", knowledge: "Knowledge Base",
      drawings: "Drawings", "ai-takeoff": "AI Takeoff",
    };
    return sub ? (map[sub] ?? "Project") : "Project Overview";
  }
  return "AI Construction Takeoff";
}

export function Topbar() {
  const pathname = usePathname();
  const router   = useRouter();
  const title    = getTitle(pathname);
  const [q, setQ] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    router.push(`/projects?q=${encodeURIComponent(term)}`);
    setQ("");
  };

  return (
    <header className={styles.topbar}>
      <h1 className={styles.title}>{title}</h1>

      <form onSubmit={handleSearch} className={styles.searchWrap}>
        <Search size={13} className={styles.searchIcon} />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search projects..."
          className={styles.searchInput}
          aria-label="Search projects"
        />
      </form>

      <button className={styles.iconBtn} aria-label="Notifications">
        <Bell size={15} />
      </button>
      <button className={styles.iconBtn} aria-label="Help">
        <HelpCircle size={15} />
      </button>

      <div className={styles.avatar} aria-label="User menu">A</div>
    </header>
  );
}
