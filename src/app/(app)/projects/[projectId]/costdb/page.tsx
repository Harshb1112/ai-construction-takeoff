"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Search, Globe, Plus, CheckCircle2,
  Loader2, TrendingUp, Filter, RefreshCw, Zap, Upload, FileText
} from "lucide-react";
import { CURRENCY_MULTIPLIERS, ALL_CATEGORIES, type Region } from "@/lib/cost-database";

interface DbCostItem {
  id: string; csiCode: string; description: string; unit: string;
  region: string; laborCost: number; materialCost: number; totalCost: number;
  year: number; source: string;
}

export default function CostDatabasePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  const [query,    setQuery]    = useState("");
  const [region,   setRegion]   = useState<Region>("us_national");
  const [category, setCategory] = useState("ALL");
  const [results,  setResults]  = useState<DbCostItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [adding,   setAdding]   = useState<string | null>(null);
  const [added,    setAdded]    = useState<Set<string>>(new Set());
  const [qty,      setQty]      = useState<Record<string, number>>({});
  const [refreshing,  setRefreshing]  = useState(false);
  const [refreshMsg,  setRefreshMsg]  = useState("");
  const [dbCount,     setDbCount]     = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [importing,   setImporting]   = useState(false);
  const [importMsg,   setImportMsg]   = useState("");

  const currency = CURRENCY_MULTIPLIERS[region];

  // Format price for current region
  const fmtPrice = (val: number) => {
    const decimals = currency.multiplier >= 3 ? 0 : 2;
    return `${currency.symbol}${val.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`;
  };

  // Load from DB via API
  const doSearch = useCallback(async (cat?: string) => {
    setLoading(true);
    setSearched(true);
    try {
      const activeCat = cat ?? category;
      const params = new URLSearchParams({ region, limit: "60" });
      if (query.trim()) params.set("q", query.trim());
      if (activeCat !== "ALL") params.set("q", `${query.trim()} ${activeCat}`.trim());

      const res  = await fetch(`/api/costdb?${params}`);
      const data: DbCostItem[] = await res.json();
      setResults(data);
      if (dbCount === null) setDbCount(data.length);
    } finally {
      setLoading(false);
    }
  }, [query, region, category, dbCount]);

  // Initial load
  useEffect(() => { doSearch(); }, [region]);

  // Refresh prices from BLS PPI (real US gov data)
  const refreshFromBLS = async () => {
    setRefreshing(true);
    setRefreshMsg("Fetching live price indices from US Bureau of Labor Statistics…");
    try {
      const res  = await fetch("/api/costdb/refresh", { method: "POST" });
      const data = await res.json();
      const updated = data.totalUpdated ?? 0;
      const ts = new Date().toLocaleString();
      setRefreshMsg(`✅ Updated ${updated} prices from BLS PPI · ${ts}`);
      setLastUpdated(ts);
      await doSearch();
    } catch {
      setRefreshMsg("❌ BLS fetch failed — check internet connection");
    } finally {
      setRefreshing(false);
    }
  };

  // CSV import — user apni real local market prices upload kare
  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMsg("Parsing CSV…");
    try {
      const text = await file.text();
      const lines = text.split("\n").filter(l => l.trim());
      const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
      const rows = lines.slice(1).map(line => {
        const vals = line.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
        const obj: Record<string,string> = {};
        headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
        return {
          csiCode:      obj["csicode"]     || obj["csi_code"] || obj["code"] || "",
          description:  obj["description"] || obj["desc"]     || obj["name"] || "",
          unit:         obj["unit"]        || "EA",
          region:       obj["region"]      || region,
          laborCost:    parseFloat(obj["laborcost"]    || obj["labor"]    || "0"),
          materialCost: parseFloat(obj["materialcost"] || obj["material"] || "0"),
          totalCost:    parseFloat(obj["totalcost"]    || obj["total"]    || obj["price"] || "0"),
          year:         parseInt(obj["year"] || String(new Date().getFullYear())),
          source:       obj["source"]      || `User CSV import — ${file.name}`,
        };
      }).filter(r => r.csiCode && r.totalCost > 0);

      const res = await fetch("/api/costdb/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      setImportMsg(`✅ Imported ${data.imported} items from ${file.name}`);
      await doSearch();
    } catch {
      setImportMsg("❌ CSV parse error — check format");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  const addToTakeoff = async (item: DbCostItem) => {
    const quantity = qty[item.id] ?? 1;
    setAdding(item.id);
    try {
      await fetch(`/api/projects/${projectId}/takeoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source:      "MANUAL",
          category:    item.csiCode.split(" ")[0] ?? "General",
          description: item.description,
          quantity,
          unit:        item.unit,
          unitCost:    item.totalCost,
          totalCost:   item.totalCost * quantity,
          notes:       `CSI ${item.csiCode} | ${currency.name} | Source: ${item.source} (${item.year})`,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["takeoff", projectId] });
      setAdded(prev => new Set([...prev, item.id]));
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-(--foreground)">Regional Cost Database</h2>
          <p className="text-sm text-(--muted-foreground)">
            98+ CSI items · 14 regions · Prices stored in DB · Refreshable from{" "}
            <a href="https://api.bls.gov" target="_blank" rel="noopener" className="text-sky-500 hover:underline">
              BLS PPI (US Gov)
            </a>
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {/* CSV Import */}
          <label className={`flex cursor-pointer items-center gap-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-100 transition-colors ${importing?"opacity-60":""}`}>
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <Upload className="h-3.5 w-3.5"/>}
            Import CSV
            <input type="file" accept=".csv" className="hidden" onChange={handleCsvImport} disabled={importing}/>
          </label>
          {/* Refresh from real sources */}
          <button
            onClick={refreshFromBLS}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 transition-colors"
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <RefreshCw className="h-3.5 w-3.5"/>}
            Refresh Real Prices
          </button>
        </div>
      </div>

      {/* Real data sources info */}
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 space-y-1.5">
        <p className="text-xs font-semibold text-sky-800 flex items-center gap-1.5"><FileText className="h-3.5 w-3.5"/>Real Data Sources:</p>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-green-700 font-medium">🇮🇳 CPWD DSR 2024 — India Official Govt (cpwd.gov.in)</span>
          <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-blue-700 font-medium">🇺🇸 Fixr.com — US Real Market Prices</span>
          <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-purple-700 font-medium">📊 BLS PPI — US Price Index (api.bls.gov)</span>
          <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-orange-700 font-medium">📁 CSV Import — Apni local rates</span>
        </div>
        <p className="text-xs text-sky-600">Click <strong>Refresh Real Prices</strong> to fetch live data. CSV format: csiCode, description, unit, region, laborCost, materialCost, totalCost</p>
      </div>

      {/* Messages */}
      {refreshMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800 flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 flex-shrink-0"/>{refreshMsg}
        </div>
      )}
      {importMsg && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs text-sky-800 flex items-center gap-2">
          <Upload className="h-3.5 w-3.5 flex-shrink-0"/>{importMsg}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Cost Items (DB)", value: results.length > 0 ? `${results.length}+` : "—" },
          { label: "Regions",         value: Object.keys(CURRENCY_MULTIPLIERS).length },
          { label: "Data Source",     value: results[0]?.source?.split(" ")[0] ?? "RSMeans" },
          { label: "Last Updated",    value: lastUpdated ?? (results[0]?.year ?? "2025") },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border border-(--border) bg-(--card) p-4 text-center">
            <p className="text-xs text-(--muted-foreground)">{label}</p>
            <p className="text-lg font-bold text-(--foreground) truncate">{value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="rounded-xl border border-(--border) bg-(--card) p-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--muted-foreground)" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && doSearch()}
              placeholder="Search: concrete, drywall, steel beam, tile..."
              className="w-full rounded-lg border border-(--border) bg-(--muted) pl-9 pr-3 py-2 text-sm outline-none focus:border-sky-400"
            />
          </div>

          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-sky-500 flex-shrink-0" />
            <select
              value={region}
              onChange={e => setRegion(e.target.value as Region)}
              className="rounded-lg border border-(--border) bg-(--muted) px-3 py-2 text-sm outline-none focus:border-sky-400"
            >
              {Object.entries(CURRENCY_MULTIPLIERS).map(([key, { name }]) => (
                <option key={key} value={key}>{name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-(--muted-foreground) flex-shrink-0" />
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="rounded-lg border border-(--border) bg-(--muted) px-3 py-2 text-sm outline-none focus:border-sky-400"
            >
              <option value="ALL">All Categories</option>
              {ALL_CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          <button
            onClick={() => doSearch()}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-60 transition-colors"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin"/> : <Search className="h-4 w-4"/>}
            Search
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs text-(--muted-foreground)">
          <TrendingUp className="h-3.5 w-3.5 text-sky-500" />
          <span>
            Prices in <strong className="text-(--foreground)">{currency.name}</strong>
            {" · "}1 USD = {currency.symbol}{currency.multiplier}
            {" · "}Data: DB (seeded from RSMeans/CWICR, updatable via BLS PPI)
          </span>
        </div>
      </div>

      {/* Category tiles */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {ALL_CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => { setCategory(cat); doSearch(cat); }}
            className={`rounded-xl border px-3 py-3 text-xs font-medium transition-colors text-center ${
              category === cat
                ? "border-sky-400 bg-sky-50 text-sky-700"
                : "border-(--border) bg-(--card) text-(--foreground) hover:border-sky-400 hover:bg-sky-50"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Results */}
      {searched && (
        <div className="rounded-xl border border-(--border) bg-(--card) overflow-hidden">
          <div className="flex items-center justify-between border-b border-(--border) bg-(--muted) px-4 py-2.5">
            <p className="text-sm font-semibold text-(--foreground)">
              {loading ? "Loading…" : `${results.length} items`}
            </p>
            <p className="text-xs text-(--muted-foreground)">
              {currency.symbol} {currency.name} · DB-backed
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--border)">
                  {["CSI Code","Description","Unit","Labor","Material","Total","Year","Qty","Add"].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-(--border)">
                {loading ? (
                  <tr><td colSpan={9} className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-(--muted-foreground)"/></td></tr>
                ) : results.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-(--muted-foreground)">No items found.</td></tr>
                ) : results.map(item => {
                  const isAdded = added.has(item.id);
                  return (
                    <tr key={item.id} className="hover:bg-(--muted) transition-colors">
                      <td className="px-3 py-2 font-mono text-xs text-(--muted-foreground)">{item.csiCode}</td>
                      <td className="px-3 py-2 max-w-xs">
                        <p className="font-medium text-(--foreground) truncate">{item.description}</p>
                        <p className="text-xs text-(--muted-foreground)">{item.source}</p>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{item.unit}</td>
                      <td className="px-3 py-2 font-mono text-xs text-amber-600">{fmtPrice(item.laborCost)}</td>
                      <td className="px-3 py-2 font-mono text-xs text-sky-600">{fmtPrice(item.materialCost)}</td>
                      <td className="px-3 py-2 font-mono text-sm font-bold text-emerald-600">{fmtPrice(item.totalCost)}</td>
                      <td className="px-3 py-2 text-xs text-(--muted-foreground)">{item.year}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number" min="0.01" step="0.01"
                          value={qty[item.id] ?? 1}
                          onChange={e => setQty(prev => ({ ...prev, [item.id]: parseFloat(e.target.value) || 1 }))}
                          className="w-16 rounded border border-(--border) bg-(--muted) px-1.5 py-0.5 text-xs outline-none focus:border-sky-400"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => addToTakeoff(item)}
                          disabled={adding === item.id || isAdded}
                          className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
                            isAdded ? "bg-emerald-100 text-emerald-700" : "bg-sky-500 text-white hover:bg-sky-600"
                          }`}
                        >
                          {adding === item.id ? <Loader2 className="h-3 w-3 animate-spin"/> :
                           isAdded ? <CheckCircle2 className="h-3 w-3"/> : <Plus className="h-3 w-3"/>}
                          {isAdded ? "Added" : "Add"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
