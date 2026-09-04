"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { Card, CardHeader } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import type { VisitorStatsResponse } from "@/lib/analytics/visitor-store";

function getDhakaDate(): string {
  const now = new Date();
  const dhakaOffset = 6 * 60;
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const dhaka = new Date(utc + dhakaOffset * 60000);
  return dhaka.toISOString().slice(0, 10);
}

function getDhakaDateOffset(days: number): string {
  const now = new Date();
  const dhakaOffset = 6 * 60;
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const dhaka = new Date(utc + dhakaOffset * 60000);
  dhaka.setDate(dhaka.getDate() + days);
  return dhaka.toISOString().slice(0, 10);
}

type FilterType = "today" | "yesterday" | "last7" | "last30" | "lifetime" | "custom_single" | "custom_range";

export default function VisitorsPage() {
  const [filterType, setFilterType] = useState<FilterType>("today");
  const [singleDate, setSingleDate] = useState<string>(getDhakaDate());
  const [fromDate, setFromDate] = useState<string>(getDhakaDateOffset(-6));
  const [toDate, setToDate] = useState<string>(getDhakaDate());
  const [customOpen, setCustomOpen] = useState(false);
  const [customMode, setCustomMode] = useState<"single" | "range">("single");

  const [stats, setStats] = useState<VisitorStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(
    async (
      type: FilterType,
      opts?: { single?: string; from?: string; to?: string },
      silent = false
    ) => {
      if (!silent) setLoading(true);
      try {
        let url = "/api/admin/visitors";
        if (
          type === "today" ||
          type === "yesterday" ||
          type === "last7" ||
          type === "last30" ||
          type === "lifetime"
        ) {
          url += `?preset=${type}`;
        } else if (type === "custom_single") {
          const d = opts?.single || singleDate;
          url += `?date=${encodeURIComponent(d)}`;
        } else if (type === "custom_range") {
          const f = opts?.from || fromDate;
          const t = opts?.to || toDate;
          url += `?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`;
        }

        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch {} finally {
        if (!silent) setLoading(false);
      }
    },
    [singleDate, fromDate, toDate]
  );

  useEffect(() => {
    fetchStats(filterType, { single: singleDate, from: fromDate, to: toDate });
  }, [filterType, fetchStats]);

  useEffect(() => {
    const isLive =
      filterType === "today" ||
      filterType === "last7" ||
      filterType === "last30" ||
      filterType === "lifetime" ||
      (filterType === "custom_single" && singleDate === getDhakaDate()) ||
      (filterType === "custom_range" && toDate >= getDhakaDate());

    if (!isLive) return;

    const interval = setInterval(() => {
      fetchStats(filterType, { single: singleDate, from: fromDate, to: toDate }, true);
    }, 20000);
    return () => clearInterval(interval);
  }, [filterType, singleDate, fromDate, toDate, fetchStats]);

  const selectPreset = (preset: "today" | "yesterday" | "last7" | "last30" | "lifetime") => {
    setFilterType(preset);
    setCustomOpen(false);
  };

  const applyCustomSingle = () => {
    setFilterType("custom_single");
    setCustomOpen(false);
    fetchStats("custom_single", { single: singleDate });
  };

  const applyCustomRange = () => {
    setFilterType("custom_range");
    setCustomOpen(false);
    fetchStats("custom_range", { from: fromDate, to: toDate });
  };

  const devices = stats?.devices || { Mobile: 0, Desktop: 0, Tablet: 0 };
  const totalDevs = devices.Mobile + devices.Desktop + devices.Tablet;
  const mobilePct = totalDevs > 0 ? Math.round((devices.Mobile / totalDevs) * 100) : 0;
  const desktopPct = totalDevs > 0 ? Math.round((devices.Desktop / totalDevs) * 100) : 0;

  const topProducts = stats?.topProducts || [];
  const maxViews = Math.max(...topProducts.map((p) => p.views || 1), 1);
  const recentSessions = stats?.recentSessions || [];
  const dailyBreakdown = stats?.dailyBreakdown || [];

  const isCustomActive = filterType === "custom_single" || filterType === "custom_range";

  return (
    <AdminShell
      title="Traffic & Visitors"
      action={
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="soft"
            onClick={() => selectPreset("today")}
            className={cn(filterType === "today" && "border-ink bg-ink text-white font-bold")}
          >
            Today / আজকে
          </Button>
          <Button
            size="sm"
            variant="soft"
            onClick={() => selectPreset("yesterday")}
            className={cn(filterType === "yesterday" && "border-ink bg-ink text-white font-bold")}
          >
            Yesterday / গতকাল
          </Button>
          <Button
            size="sm"
            variant="soft"
            onClick={() => selectPreset("last7")}
            className={cn(filterType === "last7" && "border-ink bg-ink text-white font-bold")}
          >
            Last 7 Days
          </Button>
          <Button
            size="sm"
            variant="soft"
            onClick={() => selectPreset("last30")}
            className={cn(filterType === "last30" && "border-ink bg-ink text-white font-bold")}
          >
            Last 30 Days
          </Button>
          <Button
            size="sm"
            variant="soft"
            onClick={() => selectPreset("lifetime")}
            className={cn(filterType === "lifetime" && "border-ink bg-ink text-white font-bold")}
          >
            All Time
          </Button>
          <Button
            size="sm"
            variant="soft"
            onClick={() => setCustomOpen((o) => !o)}
            className={cn(
              isCustomActive && "border-ink bg-ink text-white font-bold",
              customOpen && "ring-2 ring-accent"
            )}
          >
            Custom Date ▾
          </Button>
          <Button
            size="sm"
            variant="soft"
            onClick={() => fetchStats(filterType, { single: singleDate, from: fromDate, to: toDate })}
            disabled={loading}
          >
            <Icon name="refresh" size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Quick Glance Comparison Cards (Google Analytics style) */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* 1. Live Right Now */}
          <div
            onClick={() => selectPreset("today")}
            className={cn(
              "cursor-pointer rounded-xl border p-4 transition-all hover:shadow-md",
              filterType === "today"
                ? "border-emerald-500 bg-emerald-50/70 ring-2 ring-emerald-500/30"
                : "border-line bg-white hover:border-emerald-300"
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-micro font-bold text-emerald-700 uppercase tracking-wider">
                🟢 Live Now
              </span>
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
              </span>
            </div>
            <p className="mt-2 text-3xl font-extrabold tracking-tight text-emerald-800">
              {stats?.summary?.today?.liveNow ?? stats?.liveNow ?? 0}
            </p>
            <p className="mt-1 text-micro text-emerald-600 font-medium">
              Active in last 60s
            </p>
          </div>

          {/* 2. Today */}
          <div
            onClick={() => selectPreset("today")}
            className={cn(
              "cursor-pointer rounded-xl border p-4 transition-all hover:shadow-md",
              filterType === "today"
                ? "border-accent bg-accent/5 ring-2 ring-accent/30"
                : "border-line bg-white hover:border-accent/40"
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-micro font-bold text-muted uppercase tracking-wider">
                📅 Today (আজকে)
              </span>
              {filterType === "today" && (
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
                  Active
                </span>
              )}
            </div>
            <p className="mt-2 text-3xl font-extrabold tracking-tight text-ink">
              {(stats?.summary?.today?.uniqueVisitors ?? stats?.uniqueVisitors ?? 0).toLocaleString()}
            </p>
            <p className="mt-1 text-micro text-muted">
              <strong>{(stats?.summary?.today?.totalVisits ?? stats?.totalVisits ?? 0).toLocaleString()}</strong> views · Unique
            </p>
          </div>

          {/* 3. Yesterday */}
          <div
            onClick={() => selectPreset("yesterday")}
            className={cn(
              "cursor-pointer rounded-xl border p-4 transition-all hover:shadow-md",
              filterType === "yesterday"
                ? "border-accent bg-accent/5 ring-2 ring-accent/30"
                : "border-line bg-white hover:border-accent/40"
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-micro font-bold text-muted uppercase tracking-wider">
                ⏮️ Yesterday (গতকাল)
              </span>
              {filterType === "yesterday" && (
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
                  Active
                </span>
              )}
            </div>
            <p className="mt-2 text-3xl font-extrabold tracking-tight text-ink">
              {(stats?.summary?.yesterday?.uniqueVisitors ?? 0).toLocaleString()}
            </p>
            <p className="mt-1 text-micro text-muted">
              <strong>{(stats?.summary?.yesterday?.totalVisits ?? 0).toLocaleString()}</strong> views · Unique
            </p>
          </div>

          {/* 4. Last 7 Days */}
          <div
            onClick={() => selectPreset("last7")}
            className={cn(
              "cursor-pointer rounded-xl border p-4 transition-all hover:shadow-md",
              filterType === "last7"
                ? "border-accent bg-accent/5 ring-2 ring-accent/30"
                : "border-line bg-white hover:border-accent/40"
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-micro font-bold text-muted uppercase tracking-wider">
                📈 Last 7 Days (৭ দিন)
              </span>
              {filterType === "last7" && (
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
                  Active
                </span>
              )}
            </div>
            <p className="mt-2 text-3xl font-extrabold tracking-tight text-ink">
              {(stats?.summary?.last7days?.uniqueVisitors ?? 0).toLocaleString()}
            </p>
            <p className="mt-1 text-micro text-muted">
              <strong>{(stats?.summary?.last7days?.totalVisits ?? 0).toLocaleString()}</strong> views · Past week
            </p>
          </div>
        </div>

        {/* Custom Filter Selection Box */}
        {customOpen && (
          <Card className="border-accent/40 bg-white p-4 shadow-md transition-all">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-line pb-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCustomMode("single")}
                    className={cn(
                      "rounded-full px-3.5 py-1 text-caption font-semibold transition-colors",
                      customMode === "single"
                        ? "bg-accent text-white"
                        : "bg-surface text-muted hover:text-ink"
                    )}
                  >
                    Specific Date
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomMode("range")}
                    className={cn(
                      "rounded-full px-3.5 py-1 text-caption font-semibold transition-colors",
                      customMode === "range"
                        ? "bg-accent text-white"
                        : "bg-surface text-muted hover:text-ink"
                    )}
                  >
                    Date Range
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setCustomOpen(false)}
                  className="rounded-md px-2 py-1 text-micro font-medium text-muted hover:bg-surface hover:text-ink"
                >
                  ✕ Close
                </button>
              </div>

              {customMode === "single" ? (
                <div className="flex flex-wrap items-end gap-3 pt-1">
                  <div>
                    <label className="block text-micro font-semibold text-muted mb-1">
                      Select Date
                    </label>
                    <input
                      type="date"
                      value={singleDate}
                      max={getDhakaDate()}
                      onChange={(e) => setSingleDate(e.target.value)}
                      className="rounded-md border border-line bg-white px-3 py-1.5 text-caption font-medium text-ink shadow-xs focus:border-accent focus:outline-none"
                    />
                  </div>
                  <Button size="sm" variant="primary" onClick={applyCustomSingle}>
                    View Date
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-end gap-3 pt-1">
                  <div>
                    <label className="block text-micro font-semibold text-muted mb-1">
                      From Date
                    </label>
                    <input
                      type="date"
                      value={fromDate}
                      max={getDhakaDate()}
                      onChange={(e) => setFromDate(e.target.value)}
                      className="rounded-md border border-line bg-white px-3 py-1.5 text-caption font-medium text-ink shadow-xs focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-micro font-semibold text-muted mb-1">
                      To Date
                    </label>
                    <input
                      type="date"
                      value={toDate}
                      max={getDhakaDate()}
                      onChange={(e) => setToDate(e.target.value)}
                      className="rounded-md border border-line bg-white px-3 py-1.5 text-caption font-medium text-ink shadow-xs focus:border-accent focus:outline-none"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={fromDate > toDate}
                    onClick={applyCustomRange}
                  >
                    Apply Range
                  </Button>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Active Filter Period Banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-3.5 shadow-xs">
          <div className="flex items-center gap-2.5">
            <span className="text-caption font-bold text-ink">
              Filtered Period:{" "}
              <span className="text-accent underline decoration-accent/40 underline-offset-2">
                {stats?.filterLabel || "Today"}
              </span>
            </span>
            {stats?.isLiveSupported ? (
              <Badge tone="positive">🟢 Live Tracking Active</Badge>
            ) : (
              <Badge tone="neutral">🕒 Historical Archive Data</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-micro text-muted">
            <span>
              Total Visits: <strong className="text-ink">{stats?.totalVisits.toLocaleString() ?? 0}</strong>
            </span>
            <span>·</span>
            <span>
              Unique Shoppers:{" "}
              <strong className="text-ink">{stats?.uniqueVisitors.toLocaleString() ?? 0}</strong>
            </span>
            {stats?.isLiveSupported ? (
              <>
                <span>·</span>
                <span className="text-emerald-700 font-semibold">
                  Online now: <strong>{stats?.liveNow ?? 0}</strong>
                </span>
              </>
            ) : null}
          </div>
        </div>

        {/* Top 5 Metrics Row */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {/* Live Visitors */}
          <div
            className={cn(
              "rounded-lg border p-4 transition-colors",
              stats?.isLiveSupported
                ? "border-emerald-500/20 bg-emerald-50/50"
                : "border-line bg-surface/50"
            )}
          >
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  "text-micro font-medium",
                  stats?.isLiveSupported ? "text-emerald-700" : "text-muted"
                )}
              >
                Online Right Now
              </span>
              {stats?.isLiveSupported ? (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                </span>
              ) : (
                <span className="text-micro text-muted">Past</span>
              )}
            </div>
            <p
              className={cn(
                "mt-2 text-2xl font-bold tracking-tight",
                stats?.isLiveSupported ? "text-emerald-800" : "text-ink/60"
              )}
            >
              {stats?.isLiveSupported ? (stats?.liveNow ?? 0) : 0}
            </p>
            <p
              className={cn(
                "mt-1 text-micro",
                stats?.isLiveSupported ? "text-emerald-600" : "text-muted"
              )}
            >
              {stats?.isLiveSupported ? "Active in last 60s" : "Viewing past archive"}
            </p>
          </div>

          {/* Total Visits */}
          <div className="rounded-lg border border-line bg-white p-4">
            <span className="text-micro font-medium text-muted">Total Pageviews</span>
            <p className="mt-2 text-2xl font-bold tracking-tight text-ink">
              {stats?.totalVisits.toLocaleString() ?? 0}
            </p>
            <p className="mt-1 text-micro text-muted">In selected period</p>
          </div>

          {/* Unique Visitors */}
          <div className="rounded-lg border border-line bg-white p-4">
            <span className="text-micro font-medium text-muted">Unique Visitors</span>
            <p className="mt-2 text-2xl font-bold tracking-tight text-ink">
              {stats?.uniqueVisitors.toLocaleString() ?? 0}
            </p>
            <p className="mt-1 text-micro text-muted">Distinct shoppers</p>
          </div>

          {/* Returning Visitors */}
          <div className="rounded-lg border border-line bg-white p-4">
            <span className="text-micro font-medium text-muted">Returning Visitors</span>
            <p className="mt-2 text-2xl font-bold tracking-tight text-amber-600">
              {stats?.returningVisitors.toLocaleString() ?? 0}
            </p>
            <p className="mt-1 text-micro text-muted">Repeat visitors</p>
          </div>

          {/* Device Split */}
          <div className="rounded-lg border border-line bg-white p-4">
            <span className="text-micro font-medium text-muted">Device Split</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-sm font-bold text-ink">📱 {mobilePct}%</span>
              <span className="text-micro text-muted">· 💻 {desktopPct}%</span>
            </div>
            <p className="mt-1 text-micro text-muted">
              {devices.Mobile} mobile · {devices.Desktop} desktop
            </p>
          </div>
        </div>

        {/* Daily Breakdown Table for Multi-Day Ranges */}
        {dailyBreakdown.length > 1 && (
          <Card>
            <CardHeader
              title="📈 Daily Traffic Trend"
              hint={`Detailed day-by-day pageviews and unique shoppers for ${stats?.filterLabel || "the selected period"}.`}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-caption">
                <thead>
                  <tr className="border-b border-line bg-surface text-micro font-semibold text-muted">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3 text-right">Pageviews</th>
                    <th className="px-4 py-3 text-right">Unique Shoppers</th>
                    <th className="px-4 py-3">Traffic Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {dailyBreakdown
                    .slice()
                    .reverse()
                    .map((day) => {
                      const maxDayViews = Math.max(...dailyBreakdown.map((d) => d.totalVisits), 1);
                      const pct = Math.round((day.totalVisits / maxDayViews) * 100);
                      const isToday = day.date === getDhakaDate();
                      return (
                        <tr key={day.date} className="hover:bg-surface/60">
                          <td className="px-4 py-3 font-medium text-ink flex items-center gap-2">
                            <span className="font-mono">{day.date}</span>
                            {isToday && <Badge tone="positive">Today</Badge>}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-ink">
                            {day.totalVisits.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right text-muted">
                            {day.uniqueVisitors.toLocaleString()}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className="h-full rounded-full bg-emerald-500 transition-all"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-micro font-mono text-muted">{pct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Currently Active on Products (Only shown when live sync is supported) */}
        {stats?.isLiveSupported && stats?.liveProducts && stats.liveProducts.length > 0 && (
          <Card className="border-emerald-500/30 bg-emerald-50/20">
            <CardHeader
              title="🟢 Currently Active on Products"
              hint="Real-time shoppers browsing specific items right now. Updates automatically every 20 seconds."
            />
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {stats.liveProducts.map((lp) => (
                <div
                  key={lp.productId || lp.path}
                  className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/20 bg-white p-3 shadow-xs"
                >
                  <div className="truncate">
                    <span className="text-caption font-bold text-ink truncate block" title={lp.title}>
                      {lp.title}
                    </span>
                    <span className="text-micro font-mono text-muted">{lp.path}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-caption font-bold text-emerald-800">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                    </span>
                    <span>{lp.activeVisitors} live</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Top Viewed Products & Pages */}
        <Card>
          <CardHeader
            title="📦 Most Viewed Products & Pages"
            hint={`Ranked by total customer views for ${stats?.filterLabel || "the selected period"}.`}
          />
          {topProducts.length === 0 ? (
            <p className="px-4 py-8 text-center text-caption text-muted">
              No page views recorded for this period yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-caption">
                <thead>
                  <tr className="border-b border-line bg-surface text-micro font-semibold text-muted">
                    <th className="px-4 py-3">Page / Product</th>
                    <th className="px-4 py-3">Product Tag</th>
                    {stats?.isLiveSupported && (
                      <th className="px-4 py-3 text-center">Live Now</th>
                    )}
                    <th className="px-4 py-3 text-right">Total Views</th>
                    <th className="px-4 py-3 text-right">Unique Visitors</th>
                    <th className="px-4 py-3">Popularity Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {topProducts.map((p, idx) => {
                    const pct = Math.round((p.views / maxViews) * 100);
                    const isProduct = Boolean(p.productId);
                    return (
                      <tr key={idx} className="hover:bg-surface/60">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {isProduct ? (
                              <Badge tone="warn">PRODUCT</Badge>
                            ) : (
                              <Badge tone="neutral">PAGE</Badge>
                            )}
                            <span className="font-medium text-ink">{p.title || p.path}</span>
                          </div>
                          <span className="font-mono text-micro text-muted">{p.path}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-micro font-medium text-accent">
                          {p.productId || "—"}
                        </td>
                        {stats?.isLiveSupported && (
                          <td className="px-4 py-3 text-center">
                            {p.liveNow > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-micro font-bold text-emerald-800 border border-emerald-500/30">
                                <span className="size-1.5 rounded-full bg-emerald-600 animate-pulse" />
                                {p.liveNow} live
                              </span>
                            ) : (
                              <span className="text-micro text-muted">—</span>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3 text-right font-bold text-ink">
                          {p.views.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-muted">
                          {p.uniqueViews.toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full bg-accent"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-micro text-muted">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Recent Visitor Sessions & Activity Log */}
        <Card>
          <CardHeader
            title="📋 Visitor Activity Log"
            hint={`Activity timeline of customers browsing hinarbd.com for ${stats?.filterLabel || "the selected period"}.`}
          />
          {recentSessions.length === 0 ? (
            <p className="px-4 py-8 text-center text-caption text-muted">
              No visitor sessions recorded yet for this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-caption">
                <thead>
                  <tr className="border-b border-line bg-surface text-micro font-semibold text-muted">
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Date & Time</th>
                    <th className="px-4 py-3">Visitor</th>
                    <th className="px-4 py-3">Device</th>
                    <th className="px-4 py-3">Page / Product Visited</th>
                    <th className="px-4 py-3">Source / Referrer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {recentSessions.map((s) => (
                    <tr key={s.id} className="hover:bg-surface/60">
                      <td className="px-4 py-3">
                        {s.isLive ? (
                          <Badge tone="positive">🟢 ONLINE</Badge>
                        ) : (
                          <Badge tone="neutral">IDLE</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-micro text-muted whitespace-nowrap">
                        {s.lastSeenAt || s.createdAt}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-micro text-ink">
                            {s.visitorId.slice(0, 12)}…
                          </span>
                          {s.isReturning ? (
                            <Badge tone="warn">Returning</Badge>
                          ) : (
                            <Badge tone="neutral">New</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {s.device === "Mobile" ? "📱 Mobile" : "💻 Desktop"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink">{s.pageTitle || s.pagePath}</div>
                        <span className="font-mono text-micro text-muted">{s.pagePath}</span>
                      </td>
                      <td className="px-4 py-3 text-micro text-muted">
                        {s.referrer ? s.referrer.replace(/^https?:\/\//, "").slice(0, 30) : "Direct"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AdminShell>
  );
}
