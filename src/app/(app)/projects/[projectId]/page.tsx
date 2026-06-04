"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  FileText, Calculator, ListOrdered, Upload,
  FolderOpen, ArrowRight, Bot,
  Camera, BookOpen, Layers, Calendar, CheckSquare, Box,
  Wand2, Database, MessageSquare, Home, MapPin,
  Wind, PieChart, SquareKanban, Cpu, Trash2
} from "lucide-react";
import { FileUploadZone } from "@/components/upload/FileUploadZone";
import type { Drawing } from "@/types";
import { formatBytes } from "@/lib/utils";
import styles from "./page.module.css";

// ─── Weather code → label/icon ───────────────────────────────────
const WMO: Record<number, { label: string; icon: string }> = {
  0:  { label: "Clear sky",     icon: "☀️" },
  1:  { label: "Mainly clear",  icon: "🌤️" },
  2:  { label: "Partly cloudy", icon: "⛅" },
  3:  { label: "Overcast",      icon: "☁️" },
  45: { label: "Fog",           icon: "🌫️" },
  48: { label: "Icy fog",       icon: "🌫️" },
  51: { label: "Light drizzle", icon: "🌦️" },
  61: { label: "Rain",          icon: "🌧️" },
  71: { label: "Snow",          icon: "🌨️" },
  80: { label: "Rain showers",  icon: "🌦️" },
  95: { label: "Thunderstorm",  icon: "⛈️" },
};

function MapWeatherCard({ address }: { address?: string | null }) {
  const [geo, setGeo]     = useState<{ lat: number; lon: number } | null>(null);
  const [weather, setWeather] = useState<{ temp: number; code: number; wind: number } | null>(null);
  const [geoErr, setGeoErr]   = useState(false);

  useEffect(() => {
    if (!address?.trim()) return;
    fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
      { headers: { "User-Agent": "AI-Construction-Takeoff/1.0" } },
    )
      .then(r => r.json())
      .then(d => {
        if (d?.[0]) {
          const lat = parseFloat(d[0].lat);
          const lon = parseFloat(d[0].lon);
          setGeo({ lat, lon });
          return fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode,windspeed_10m&timezone=auto`,
          );
        }
      })
      .then(r => r?.json())
      .then(d => {
        if (d?.current) {
          setWeather({
            temp: Math.round(d.current.temperature_2m),
            code: d.current.weathercode,
            wind: Math.round(d.current.windspeed_10m),
          });
        }
      })
      .catch(() => setGeoErr(true));
  }, [address]);

  if (!address?.trim()) return null;

  const wmo = weather
    ? (WMO[weather.code] ?? WMO[Math.floor(weather.code / 10) * 10] ?? { label: "Unknown", icon: "🌡️" })
    : null;
  const mapUrl = geo
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${geo.lon - 0.02},${geo.lat - 0.015},${geo.lon + 0.02},${geo.lat + 0.015}&layer=mapnik&marker=${geo.lat},${geo.lon}`
    : null;

  return (
    <div className={`${styles.mapCard} ${weather ? styles.mapCardWeather : styles.mapCardSingle}`}>
      {mapUrl ? (
        <iframe src={mapUrl} className={styles.mapIframe} title="Project location" />
      ) : (
        <div className={styles.mapPlaceholder}>
          <MapPin size={24} color="#cbd5e1" />
          <p className={styles.mapPlaceholderText}>
            {geoErr ? "Location not found" : "Locating address…"}
          </p>
        </div>
      )}
      {weather && wmo && (
        <div className={styles.weatherPanel}>
          <span className={styles.weatherIcon}>{wmo.icon}</span>
          <p className={styles.weatherTemp}>{weather.temp}°C</p>
          <p className={styles.weatherLabel}>{wmo.label}</p>
          <div className={styles.weatherWind}>
            <Wind size={11} color="rgba(255,255,255,.7)" />
            <span className={styles.weatherWindText}>{weather.wind} km/h</span>
          </div>
        </div>
      )}
    </div>
  );
}

const FORMAT_EMOJI: Record<string, string> = {
  PDF: "📄", DWG: "📐", DXF: "📐", IFC: "🏗️",
  PNG: "🖼️", JPG: "🖼️", JPEG: "🖼️",
};

interface ProjectFull {
  id: string; name: string; description?: string | null;
  address?: string | null; status: string;
  drawings: Drawing[];
  _count: { drawings: number; takeoffItems: number; boqItems: number };
}

const FEATURE_TILES = [
  { label: "Room Analyzer",          sub: "2D · 3D · 4D",                    href: "rooms",      icon: Home          },
  { label: "3D BIM Viewer",          sub: "IFC · DXF · BIM→BOQ",             href: "model3d",    icon: Box           },
  { label: "🏗️ AI Takeoff (7-step)", sub: "CubiCasa5k + Markup + Table",     href: "ai-takeoff", icon: Cpu           },
  { label: "AI Takeoff",             sub: "LM Studio Vision",                 href: "takeoff",    icon: Calculator    },
  { label: "AI Extract",             sub: "Room-wise extract",                href: "extract",    icon: Wand2         },
  { label: "Photo → BOQ",            sub: "Site photo AI",                    href: "photo-boq",  icon: Camera        },
  { label: "BOQ",                    sub: "CSI · GAEB · S-Curve",             href: "boq",        icon: ListOrdered   },
  { label: "Cost Database",          sub: "14 regions pricing",               href: "costdb",     icon: Database      },
  { label: "Assemblies",             sub: "Parameterized",                    href: "assemblies", icon: Layers        },
  { label: "Data Explorer",          sub: "Pivot · Charts · BOQ",             href: "explorer",   icon: PieChart      },
  { label: "Schedule",               sub: "Gantt · EVM · 4D",                 href: "schedule",   icon: Calendar      },
  { label: "BIM Kanban",             sub: "Tasks linked to model",            href: "kanban",     icon: SquareKanban  },
  { label: "Punch List",             sub: "5-stage workflow",                 href: "punchlist",  icon: CheckSquare   },
  { label: "AI Chat",                sub: "Streaming · Any LLM",              href: "chat",       icon: MessageSquare },
  { label: "Knowledge Base",         sub: "PDF · AI Q&A",                     href: "knowledge",  icon: BookOpen      },
];

const STATS = [
  { label: "Drawings",      colorKey: "blue"   as const },
  { label: "Takeoff Items", colorKey: "green"  as const },
  { label: "BOQ Items",     colorKey: "purple" as const },
];

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();

  const { data: project, refetch, isLoading } = useQuery<ProjectFull>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/drawings/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      return id;
    },
    onSuccess: () => refetch(),
  });

  if (isLoading) return (
    <div className={`${styles.loadingWrapper} fade-up`}>
      <div className={`shimmer ${styles.shimmerHeader}`} />
      <div className={styles.shimmerGrid}>
        {[1,2,3,4].map(i => <div key={i} className={`shimmer ${styles.shimmerCard}`} />)}
      </div>
    </div>
  );

  const statValues = [
    project?._count.drawings      ?? 0,
    project?._count.takeoffItems  ?? 0,
    project?._count.boqItems      ?? 0,
  ];

  return (
    <div className={`${styles.pageWrapper} fade-up`}>

      {/* Project header card */}
      <div className={styles.headerCard}>
        <div className={styles.headerRow}>
          <div className={styles.projectIcon}>
            <FolderOpen size={24} color="#fff" />
          </div>
          <div className={styles.headerInfo}>
            <h1 className={styles.headerTitle}>{project?.name}</h1>
            {project?.description && (
              <p className={styles.headerDesc}>{project.description}</p>
            )}
            {project?.address && (
              <p className={styles.headerAddress}>📍 {project.address}</p>
            )}
          </div>
          <div className={styles.headerActions}>
            <Link href={`/projects/${projectId}/takeoff`} className={styles.actionPrimary}>
              <Calculator size={14} /> AI Takeoff
            </Link>
            <Link href={`/projects/${projectId}/chat`} className={styles.actionSecondary}>
              <Bot size={14} /> AI Chat
            </Link>
          </div>
        </div>

        {project?.address && (
          <div className={styles.mapWrapper}>
            <MapWeatherCard address={project.address} />
          </div>
        )}

        <div className={styles.statsRow}>
          {STATS.map(({ label, colorKey }, i) => (
            <div key={label} className={styles.statItem}>
              <p className={styles.statValue} data-color={colorKey}>{statValues[i]}</p>
              <p className={styles.statLabel}>{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Feature tiles */}
      <div>
        <p className={styles.sectionLabel}>Features</p>
        <div className={styles.tilesGrid}>
          {FEATURE_TILES.map(({ label, sub, href, icon: Icon }) => (
            <Link
              key={href}
              href={`/projects/${projectId}/${href}`}
              className={styles.tile}
              data-id={href}
            >
              <div className={styles.tileIconWrap}>
                <Icon size={17} />
              </div>
              <div>
                <p className={styles.tileTitle}>{label}</p>
                <p className={styles.tileSub}>{sub}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Upload section */}
      <div className={styles.uploadCard}>
        <div className={styles.uploadHeader}>
          <div className={styles.uploadIconWrap}>
            <Upload size={16} color="#2563eb" />
          </div>
          <div>
            <p className={styles.uploadTitle}>Upload Drawings</p>
            <p className={styles.uploadSub}>PDF, DWG, DXF, IFC, PNG, JPG — max 100MB</p>
          </div>
        </div>
        <FileUploadZone projectId={projectId} onUploaded={() => refetch()} />
      </div>

      {/* Drawings list */}
      <div className={styles.drawingsCard}>
        <div className={styles.drawingsHeader}>
          <div className={styles.drawingsHeaderLeft}>
            <FileText size={16} color="#64748b" />
            <p className={styles.drawingsTitle}>Drawings</p>
            {project?.drawings?.length ? (
              <span className={styles.drawingsCount}>{project.drawings.length}</span>
            ) : null}
          </div>
        </div>

        {!project?.drawings?.length ? (
          <div className={styles.drawingsEmpty}>
            <FileText size={36} color="#cbd5e1" className={styles.drawingsEmptyIcon} />
            <p className={styles.drawingsEmptyTitle}>No drawings uploaded yet</p>
            <p className={styles.drawingsEmptySub}>Upload PDF, DWG, DXF, or image files above</p>
          </div>
        ) : (
          <div>
            {project.drawings.map(drawing => (
              <div key={drawing.id} className={styles.drawingRow}>
                <div className={styles.drawingFileIcon}>
                  {FORMAT_EMOJI[drawing.fileFormat] ?? "📄"}
                </div>
                <div className={styles.drawingInfo}>
                  <p className={styles.drawingName}>{drawing.originalName}</p>
                  <p className={styles.drawingMeta}>
                    {drawing.fileFormat} · {formatBytes(drawing.fileSizeBytes)} ·&nbsp;
                    {new Date(drawing.uploadedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className={styles.drawingActions}>
                  <Link
                    href={`/projects/${projectId}/drawings/${drawing.id}`}
                    className={styles.openEditor}
                  >
                    Open Editor + AI
                    <ArrowRight size={12} />
                  </Link>
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    onClick={() => {
                      if (deleteMutation.isPending) return;
                      if (confirm("Delete this drawing?")) deleteMutation.mutate(drawing.id);
                    }}
                  >
                    <Trash2 size={12} />
                    {deleteMutation.isPending ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
