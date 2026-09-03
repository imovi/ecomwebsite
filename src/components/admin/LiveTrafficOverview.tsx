"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import type { VisitorStatsResponse } from "@/lib/analytics/visitor-store";

export function LiveTrafficOverview() {
  const [stats, setStats] = useState<VisitorStatsResponse | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/admin/visitors");
        if (res.ok && mounted) {
          const data = await res.json();
          setStats(data);
        }
      } catch {}
    };

    fetchStats();
    const interval = setInterval(fetchStats, 20000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const liveNow = stats?.liveNow ?? 0;
  const totalVisits = stats?.totalVisits ?? 0;
  const uniqueVisitors = stats?.uniqueVisitors ?? 0;
  const returningVisitors = stats?.returningVisitors ?? 0;
  const topProduct = stats?.topProducts?.find((p) => p.productId) || stats?.topProducts?.[0];

  return (
    <div className="rounded-xl border border-line bg-white p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-bold text-ink">🌐 Website Visitors & Traffic</span>
          <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-micro font-semibold text-emerald-700 border border-emerald-500/20">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
            <span>{liveNow} ONLINE NOW</span>
          </div>
        </div>

        <Link
          href="/admin/visitors"
          className="text-caption font-semibold text-accent hover:underline flex items-center gap-1"
        >
          Detailed Traffic ➔
        </Link>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Live Online */}
        <div className="rounded-lg bg-emerald-50/40 p-3 border border-emerald-500/15">
          <span className="text-micro font-medium text-emerald-800">Online Right Now</span>
          <p className="mt-1 text-2xl font-bold tracking-tight text-emerald-700">{liveNow}</p>
          <span className="text-micro text-emerald-600">Active shoppers</span>
        </div>

        {/* Total Pageviews */}
        <div className="rounded-lg bg-surface p-3">
          <span className="text-micro font-medium text-muted">Today's Visits</span>
          <p className="mt-1 text-2xl font-bold tracking-tight text-ink">{totalVisits.toLocaleString()}</p>
          <span className="text-micro text-muted">Total page loads</span>
        </div>

        {/* Unique Visitors */}
        <div className="rounded-lg bg-surface p-3">
          <span className="text-micro font-medium text-muted">Unique Visitors</span>
          <p className="mt-1 text-2xl font-bold tracking-tight text-ink">{uniqueVisitors.toLocaleString()}</p>
          <span className="text-micro text-muted">Distinct people</span>
        </div>

        {/* Returning Visitors */}
        <div className="rounded-lg bg-surface p-3">
          <span className="text-micro font-medium text-muted">Returning Visitors</span>
          <p className="mt-1 text-2xl font-bold tracking-tight text-amber-600">{returningVisitors.toLocaleString()}</p>
          <span className="text-micro text-muted">Repeat visits</span>
        </div>
      </div>

      {stats?.liveProducts && stats.liveProducts.length > 0 && (
        <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-50/50 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="flex items-center gap-1.5 text-micro font-bold text-emerald-900">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
              </span>
              Active Shoppers on Products Right Now
            </span>
            <span className="text-micro font-semibold text-emerald-700">
              {stats.liveProducts.reduce((acc, p) => acc + p.activeVisitors, 0)} live on {stats.liveProducts.length} product{stats.liveProducts.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {stats.liveProducts.map((lp) => (
              <div
                key={lp.productId || lp.path}
                className="flex items-center gap-2 rounded-md border border-emerald-500/25 bg-white px-2.5 py-1 text-micro shadow-2xs"
              >
                <span className="font-medium text-ink truncate max-w-[220px]" title={lp.title}>
                  {lp.title}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800">
                  <span className="size-1.5 rounded-full bg-emerald-600" />
                  {lp.activeVisitors} live
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {topProduct && (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-surface/80 px-3 py-2 text-micro">
          <div className="flex items-center gap-2 truncate">
            <span className="text-muted">🔥 Most viewed today:</span>
            <span className="font-medium text-ink truncate">{topProduct.title}</span>
            {topProduct.productId && <Badge tone="warn">{topProduct.productId}</Badge>}
          </div>
          <span className="font-semibold text-ink shrink-0 ml-2">
            {topProduct.views} view{topProduct.views === 1 ? "" : "s"} ({topProduct.uniqueViews} unique)
          </span>
        </div>
      )}
    </div>
  );
}
