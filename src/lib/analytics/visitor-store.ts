import fs from "node:fs";
import path from "node:path";

export interface VisitorEventPayload {
  type?: "pageview" | "heartbeat";
  visitorId: string;
  sessionId: string;
  pagePath: string;
  pageTitle?: string;
  productId?: string | null;
  referrer?: string;
  userAgent?: string;
  ip?: string;
}

export interface ActiveSession {
  visitorId: string;
  sessionId: string;
  pagePath: string;
  pageTitle?: string;
  productId?: string | null;
  lastSeen: number;
  device: "Mobile" | "Desktop" | "Tablet";
  ip?: string;
  referrer?: string;
}

export interface TopProductStat {
  productId: string;
  path: string;
  title: string;
  views: number;
  uniqueViews: number;
  liveNow: number;
}

export interface LiveProductStat {
  productId: string;
  path: string;
  title: string;
  activeVisitors: number;
}

export interface RecentSessionRow {
  id: number;
  visitorId: string;
  sessionId: string;
  pagePath: string;
  pageTitle: string;
  productId: string | null;
  isReturning: boolean;
  device: string;
  referrer: string;
  createdAt: string;
  lastSeenAt: string;
  isLive: boolean;
}

export type VisitorRangePreset =
  | "today"
  | "yesterday"
  | "last7"
  | "7days"
  | "last30"
  | "30days"
  | "lifetime"
  | "all"
  | "month"
  | "custom";

export interface VisitorStatsQuery {
  date?: string;
  startDate?: string;
  endDate?: string;
  from?: string;
  to?: string;
  preset?: VisitorRangePreset | string;
}

export interface DailyBreakdownItem {
  date: string;
  totalVisits: number;
  uniqueVisitors: number;
}

export interface VisitorSummaryOverview {
  today: { uniqueVisitors: number; totalVisits: number; liveNow: number };
  yesterday: { uniqueVisitors: number; totalVisits: number };
  last7days: { uniqueVisitors: number; totalVisits: number };
  last30days: { uniqueVisitors: number; totalVisits: number };
}

export interface VisitorStatsResponse {
  date: string;
  startDate?: string;
  endDate?: string;
  preset?: string;
  filterLabel?: string;
  isLiveSupported: boolean;
  liveNow: number;
  totalVisits: number;
  uniqueVisitors: number;
  returningVisitors: number;
  devices: {
    Mobile: number;
    Desktop: number;
    Tablet: number;
  };
  topProducts: TopProductStat[];
  liveProducts: LiveProductStat[];
  recentSessions: RecentSessionRow[];
  dailyBreakdown: DailyBreakdownItem[];
  summary?: VisitorSummaryOverview;
}

export interface StoredEvent {
  id: number;
  visitorId: string;
  sessionId: string;
  pagePath: string;
  pageTitle: string;
  productId: string | null;
  isReturning: boolean;
  device: "Mobile" | "Desktop" | "Tablet";
  referrer: string;
  ip: string;
  date: string;
  createdAt: string;
  lastSeenAt: string;
}

export function getDhakaDate(): string {
  const now = new Date();
  const dhakaOffset = 6 * 60; // UTC+6 in minutes
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const dhaka = new Date(utc + dhakaOffset * 60000);
  return dhaka.toISOString().slice(0, 10);
}

export function offsetDhakaDate(days: number): string {
  const now = new Date();
  const dhakaOffset = 6 * 60;
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const dhaka = new Date(utc + dhakaOffset * 60000);
  dhaka.setDate(dhaka.getDate() + days);
  return dhaka.toISOString().slice(0, 10);
}

function getDhakaTimeStr(): string {
  const now = new Date();
  const dhakaOffset = 6 * 60;
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const dhaka = new Date(utc + dhakaOffset * 60000);
  return dhaka.toISOString().replace("T", " ").slice(0, 19);
}

function detectDevice(userAgent?: string): "Mobile" | "Desktop" | "Tablet" {
  if (!userAgent) return "Desktop";
  if (/mobile|android|iphone|ipod/i.test(userAgent)) return "Mobile";
  if (/ipad|tablet/i.test(userAgent)) return "Tablet";
  return "Desktop";
}

const HEARTBEAT_WINDOW_MS = 60 * 1000; // 60 seconds inactivity = offline

let hasMigratedTmp = false;

function getDataDir(): string {
  const custom = process.env.VISITOR_DATA_DIR;
  let dir = "";
  if (custom) {
    dir = custom;
  } else if (process.platform === "win32") {
    dir = path.join(process.cwd(), ".data", "visitors");
  } else {
    dir = "/app/data/visitors";
  }

  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      dir = path.join("/tmp", "hinar-visitors");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
  }

  // One-time automatic migration of any existing files from /tmp/hinar-visitors to persistent dir
  if (!hasMigratedTmp && process.platform !== "win32" && dir !== "/tmp/hinar-visitors") {
    hasMigratedTmp = true;
    try {
      const tmpDir = "/tmp/hinar-visitors";
      if (fs.existsSync(tmpDir)) {
        const files = fs.readdirSync(tmpDir);
        for (const file of files) {
          const src = path.join(tmpDir, file);
          const dst = path.join(dir, file);
          if (!fs.existsSync(dst)) {
            fs.copyFileSync(src, dst);
          }
        }
      }
    } catch {}
  }

  return dir;
}

function getQuickDayStats(dataDir: string, targetDate: string): { totalVisits: number; uniqueVisitors: number } {
  const filePath = path.join(dataDir, `${targetDate}.jsonl`);
  if (!fs.existsSync(filePath)) {
    return { totalVisits: 0, uniqueVisitors: 0 };
  }
  try {
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    let totalVisits = 0;
    const vids = new Set<string>();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      totalVisits++;
      try {
        const ev = JSON.parse(line);
        if (ev.visitorId) vids.add(ev.visitorId);
      } catch {}
    }
    return { totalVisits, uniqueVisitors: vids.size };
  } catch {
    return { totalVisits: 0, uniqueVisitors: 0 };
  }
}

function getQuickRangeStats(dataDir: string, startDate: string, endDate: string): { totalVisits: number; uniqueVisitors: number } {
  try {
    const allFiles = fs.existsSync(dataDir)
      ? fs.readdirSync(dataDir).filter((f) => f.endsWith(".jsonl"))
      : [];
    let totalVisits = 0;
    const vids = new Set<string>();
    for (const f of allFiles) {
      const d = f.replace(".jsonl", "");
      if (d >= startDate && d <= endDate) {
        const lines = fs.readFileSync(path.join(dataDir, f), "utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          totalVisits++;
          try {
            const ev = JSON.parse(line);
            if (ev.visitorId) vids.add(ev.visitorId);
          } catch {}
        }
      }
    }
    return { totalVisits, uniqueVisitors: vids.size };
  } catch {
    return { totalVisits: 0, uniqueVisitors: 0 };
  }
}

function getLogFilePath(date: string): string {
  return path.join(getDataDir(), `${date}.jsonl`);
}

function getActiveSessionsPath(): string {
  return path.join(getDataDir(), "active-sessions.json");
}

function syncActiveSession(session: ActiveSession): void {
  try {
    const filePath = getActiveSessionsPath();
    let map: Record<string, ActiveSession> = {};
    if (fs.existsSync(filePath)) {
      try {
        map = JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch {}
    }
    const now = Date.now();
    // Prune stale sessions older than 60s
    for (const sid in map) {
      if (now - map[sid].lastSeen > HEARTBEAT_WINDOW_MS) {
        delete map[sid];
      }
    }
    map[session.sessionId] = session;
    fs.writeFileSync(filePath, JSON.stringify(map), "utf8");
  } catch (err) {
    console.error("[visitor-store] syncActiveSession error:", err);
  }
}

/**
 * Checks if this visitor has visited on any prior dates
 */
function checkIsReturningVisitor(visitorId: string, currentDate: string): boolean {
  try {
    const dir = getDataDir();
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file.endsWith(".jsonl")) {
        const fileDate = file.replace(".jsonl", "");
        if (fileDate < currentDate) {
          const content = fs.readFileSync(path.join(dir, file), "utf8");
          if (content.includes(`"visitorId":"${visitorId}"`)) {
            return true;
          }
        }
      }
    }
  } catch {}
  return false;
}

let eventCounter = Date.now();

/**
 * Record a visitor pageview or heartbeat
 */
export function recordVisitorEvent(payload: VisitorEventPayload): void {
  const {
    type = "pageview",
    visitorId,
    sessionId,
    pagePath = "/",
    pageTitle = "",
    productId = null,
    referrer = "",
    userAgent = "",
    ip = "",
  } = payload;

  if (!visitorId || !sessionId) return;

  const now = Date.now();
  const date = getDhakaDate();
  const timeStr = getDhakaTimeStr();
  const device = detectDevice(userAgent);
  const cleanPath = String(pagePath || "/").slice(0, 200);
  const cleanTitle = String(pageTitle || "").slice(0, 150);
  const cleanProdId = productId ? String(productId).slice(0, 80) : null;
  const cleanRef = String(referrer || "").slice(0, 200);

  // 1. Sync active session for real-time live visitors across all workers
  syncActiveSession({
    visitorId,
    sessionId,
    pagePath: cleanPath,
    pageTitle: cleanTitle,
    productId: cleanProdId,
    lastSeen: now,
    device,
    ip,
    referrer: cleanRef,
  });

  // Heartbeats only maintain the live session; pageviews are written to the daily log
  if (type === "heartbeat") {
    return;
  }

  // 2. Append pageview to daily JSONL log
  try {
    const isReturning = checkIsReturningVisitor(visitorId, date);
    const event: StoredEvent = {
      id: ++eventCounter,
      visitorId,
      sessionId,
      pagePath: cleanPath,
      pageTitle: cleanTitle,
      productId: cleanProdId,
      isReturning,
      device,
      referrer: cleanRef,
      ip,
      date,
      createdAt: timeStr,
      lastSeenAt: timeStr,
    };

    const logFile = getLogFilePath(date);
    fs.appendFileSync(logFile, JSON.stringify(event) + "\n", "utf8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[visitor-store] write failed:", msg);
  }
}

/**
 * Returns the count of unique visitors active within the last 60 seconds
 */
export function getLiveVisitorsCount(): number {
  try {
    const filePath = getActiveSessionsPath();
    if (!fs.existsSync(filePath)) return 0;
    const map: Record<string, ActiveSession> = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const now = Date.now();
    const activeVids = new Set<string>();
    for (const sid in map) {
      if (now - map[sid].lastSeen <= HEARTBEAT_WINDOW_MS) {
        activeVids.add(map[sid].visitorId);
      }
    }
    return activeVids.size;
  } catch {
    return 0;
  }
}

/**
 * Returns comprehensive visitor statistics for a given date or range/preset
 */
export function getVisitorStats(param?: string | VisitorStatsQuery): VisitorStatsResponse {
  const today = getDhakaDate();
  let query: VisitorStatsQuery = {};
  if (typeof param === "string") {
    query = { date: param };
  } else if (param) {
    query = param;
  }

  const rawPreset = String(query.preset || "").toLowerCase();
  let startDate: string | undefined = query.startDate || query.from;
  let endDate: string | undefined = query.endDate || query.to;
  let preset = "today";
  let filterLabel = "Today";

  if (query.date) {
    startDate = query.date;
    endDate = query.date;
    if (query.date === today) {
      preset = "today";
      filterLabel = `Today (${today})`;
    } else if (query.date === offsetDhakaDate(-1)) {
      preset = "yesterday";
      filterLabel = `Yesterday (${query.date})`;
    } else {
      preset = "custom";
      filterLabel = query.date;
    }
  } else if (rawPreset === "yesterday") {
    const yest = offsetDhakaDate(-1);
    startDate = yest;
    endDate = yest;
    preset = "yesterday";
    filterLabel = `Yesterday (${yest})`;
  } else if (rawPreset === "last7" || rawPreset === "7days") {
    startDate = offsetDhakaDate(-6);
    endDate = today;
    preset = "last7";
    filterLabel = `Last 7 Days (${startDate} ~ ${endDate})`;
  } else if (rawPreset === "last30" || rawPreset === "30days") {
    startDate = offsetDhakaDate(-29);
    endDate = today;
    preset = "last30";
    filterLabel = `Last 30 Days (${startDate} ~ ${endDate})`;
  } else if (rawPreset === "month") {
    startDate = `${today.slice(0, 7)}-01`;
    endDate = today;
    preset = "month";
    filterLabel = `This Month (${startDate} ~ ${endDate})`;
  } else if (rawPreset === "lifetime" || rawPreset === "all") {
    startDate = undefined;
    endDate = undefined;
    preset = "lifetime";
    filterLabel = "All Time";
  } else if (startDate || endDate) {
    if (startDate && !endDate) endDate = startDate;
    if (!startDate && endDate) startDate = endDate;
    preset = "custom";
    filterLabel = startDate === endDate ? `${startDate}` : `${startDate} ~ ${endDate}`;
  } else {
    // Default today
    startDate = today;
    endDate = today;
    preset = "today";
    filterLabel = `Today (${today})`;
  }

  const isLiveSupported = !endDate || endDate >= today;
  const liveNow = isLiveSupported ? getLiveVisitorsCount() : 0;

  const dataDir = getDataDir();
  let allFiles: string[] = [];
  try {
    if (fs.existsSync(dataDir)) {
      allFiles = fs.readdirSync(dataDir).filter((f) => f.endsWith(".jsonl"));
    }
  } catch {}

  const matchingFiles = allFiles
    .filter((f) => {
      const fileDate = f.replace(".jsonl", "");
      if (startDate && fileDate < startDate) return false;
      if (endDate && fileDate > endDate) return false;
      return true;
    })
    .sort();

  let totalVisits = 0;
  const uniqueVisitorIds = new Set<string>();
  const returningVisitorIds = new Set<string>();
  const devices = { Mobile: 0, Desktop: 0, Tablet: 0 };
  const productViewMap = new Map<
    string,
    { productId: string; path: string; title: string; views: number; uniqueVisitors: Set<string> }
  >();
  const recentEvents: StoredEvent[] = [];
  const dailyMap = new Map<string, { totalVisits: number; uniqueVisitors: Set<string> }>();

  for (const file of matchingFiles) {
    const fileDate = file.replace(".jsonl", "");
    const filePath = path.join(dataDir, file);
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n");

      let dayVisits = 0;
      let dayData = dailyMap.get(fileDate);
      if (!dayData) {
        dayData = { totalVisits: 0, uniqueVisitors: new Set<string>() };
        dailyMap.set(fileDate, dayData);
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        try {
          const ev: StoredEvent = JSON.parse(line);
          totalVisits++;
          dayVisits++;
          uniqueVisitorIds.add(ev.visitorId);
          dayData.uniqueVisitors.add(ev.visitorId);

          if (ev.isReturning) {
            returningVisitorIds.add(ev.visitorId);
          }

          if (ev.device === "Mobile") devices.Mobile++;
          else if (ev.device === "Tablet") devices.Tablet++;
          else devices.Desktop++;

          const key = ev.pagePath;
          let entry = productViewMap.get(key);
          if (!entry) {
            entry = {
              productId: ev.productId || "",
              path: ev.pagePath,
              title: ev.pageTitle || ev.pagePath,
              views: 0,
              uniqueVisitors: new Set<string>(),
            };
            productViewMap.set(key, entry);
          }
          entry.views++;
          entry.uniqueVisitors.add(ev.visitorId);
          if (ev.productId && !entry.productId) entry.productId = ev.productId;
          if (ev.pageTitle && entry.title === ev.pagePath) entry.title = ev.pageTitle;

          recentEvents.push(ev);
        } catch {}
      }
      dayData.totalVisits += dayVisits;
    } catch {}
  }

  // Construct daily breakdown
  const dailyBreakdown: DailyBreakdownItem[] = [];
  if (startDate && endDate) {
    const startD = new Date(startDate);
    const endD = new Date(endDate);
    const diffDays = Math.round((endD.getTime() - startD.getTime()) / (1000 * 3600 * 24));
    if (diffDays >= 0 && diffDays <= 60) {
      const cur = new Date(startD);
      while (cur <= endD) {
        const dStr = cur.toISOString().slice(0, 10);
        const dayData = dailyMap.get(dStr);
        dailyBreakdown.push({
          date: dStr,
          totalVisits: dayData ? dayData.totalVisits : 0,
          uniqueVisitors: dayData ? dayData.uniqueVisitors.size : 0,
        });
        cur.setDate(cur.getDate() + 1);
      }
    } else {
      for (const [dStr, dayData] of dailyMap.entries()) {
        dailyBreakdown.push({
          date: dStr,
          totalVisits: dayData.totalVisits,
          uniqueVisitors: dayData.uniqueVisitors.size,
        });
      }
    }
  } else {
    for (const [dStr, dayData] of dailyMap.entries()) {
      dailyBreakdown.push({
        date: dStr,
        totalVisits: dayData.totalVisits,
        uniqueVisitors: dayData.uniqueVisitors.size,
      });
    }
  }

  // Identify currently active live visitors and per-product live visitors
  const liveVisitorIds = new Set<string>();
  const liveProductMap = new Map<
    string,
    { productId: string; path: string; title: string; visitors: Set<string> }
  >();

  if (isLiveSupported) {
    try {
      const activePath = getActiveSessionsPath();
      if (fs.existsSync(activePath)) {
        const map: Record<string, ActiveSession> = JSON.parse(fs.readFileSync(activePath, "utf8"));
        const now = Date.now();
        for (const sid in map) {
          const sess = map[sid];
          if (now - sess.lastSeen <= HEARTBEAT_WINDOW_MS) {
            liveVisitorIds.add(sess.visitorId);

            const isProduct = sess.productId || sess.pagePath.startsWith("/product/");
            if (isProduct) {
              const prodKey = sess.productId || sess.pagePath.replace("/product/", "").split("?")[0];
              let entry = liveProductMap.get(prodKey);
              if (!entry) {
                entry = {
                  productId: prodKey,
                  path: sess.pagePath,
                  title: sess.pageTitle && sess.pageTitle !== sess.pagePath ? sess.pageTitle : prodKey,
                  visitors: new Set<string>(),
                };
                liveProductMap.set(prodKey, entry);
              }
              entry.visitors.add(sess.visitorId);
              if (sess.pageTitle && entry.title === prodKey) {
                entry.title = sess.pageTitle;
              }
            }
          }
        }
      }
    } catch {}
  }

  // Rank top products / pages by total views
  const topProducts: TopProductStat[] = Array.from(productViewMap.values())
    .sort((a, b) => b.views - a.views)
    .slice(0, 30)
    .map((p) => {
      const prodKey = p.productId || p.path.replace("/product/", "").split("?")[0];
      const liveItem = isLiveSupported
        ? liveProductMap.get(prodKey) || liveProductMap.get(p.path)
        : undefined;
      return {
        productId: p.productId,
        path: p.path,
        title: p.title,
        views: p.views,
        uniqueViews: p.uniqueVisitors.size,
        liveNow: liveItem ? liveItem.visitors.size : 0,
      };
    });

  // Active products with live visitors right now
  const liveProducts: LiveProductStat[] = isLiveSupported
    ? Array.from(liveProductMap.values())
        .filter((lp) => lp.visitors.size > 0)
        .map((lp) => ({
          productId: lp.productId,
          path: lp.path,
          title: lp.title,
          activeVisitors: lp.visitors.size,
        }))
        .sort((a, b) => b.activeVisitors - a.activeVisitors)
    : [];

  // Most recent 50 sessions
  const recentSessions: RecentSessionRow[] = recentEvents
    .slice(-50)
    .reverse()
    .map((ev) => ({
      id: ev.id,
      visitorId: ev.visitorId,
      sessionId: ev.sessionId,
      pagePath: ev.pagePath,
      pageTitle: ev.pageTitle,
      productId: ev.productId,
      isReturning: ev.isReturning,
      device: ev.device,
      referrer: ev.referrer,
      createdAt: ev.createdAt,
      lastSeenAt: ev.lastSeenAt,
      isLive: isLiveSupported ? liveVisitorIds.has(ev.visitorId) : false,
    }));

  const yesterdayDate = offsetDhakaDate(-1);
  const sevenDaysAgoDate = offsetDhakaDate(-6);
  const thirtyDaysAgoDate = offsetDhakaDate(-29);

  const todayMetrics = getQuickDayStats(dataDir, today);
  const yesterdayMetrics = getQuickDayStats(dataDir, yesterdayDate);
  const last7Metrics = getQuickRangeStats(dataDir, sevenDaysAgoDate, today);
  const last30Metrics = getQuickRangeStats(dataDir, thirtyDaysAgoDate, today);

  const summary: VisitorSummaryOverview = {
    today: { ...todayMetrics, liveNow: getLiveVisitorsCount() },
    yesterday: yesterdayMetrics,
    last7days: last7Metrics,
    last30days: last30Metrics,
  };

  return {
    date: query.date || startDate || today,
    startDate,
    endDate,
    preset,
    filterLabel,
    isLiveSupported,
    liveNow,
    totalVisits,
    uniqueVisitors: uniqueVisitorIds.size,
    returningVisitors: returningVisitorIds.size,
    devices,
    topProducts,
    liveProducts,
    recentSessions,
    dailyBreakdown,
    summary,
  };
}

/**
 * Returns the number of currently active visitors on a given product slug / path
 */
export function getProductLiveVisitors(productIdOrSlug: string): number {
  try {
    const filePath = getActiveSessionsPath();
    if (!fs.existsSync(filePath)) return 0;
    const map: Record<string, ActiveSession> = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const now = Date.now();
    const visitors = new Set<string>();

    const target = productIdOrSlug.toLowerCase().trim();
    for (const sid in map) {
      const sess = map[sid];
      if (now - sess.lastSeen <= HEARTBEAT_WINDOW_MS) {
        const matches =
          (sess.productId && sess.productId.toLowerCase() === target) ||
          sess.pagePath.toLowerCase().includes(`/product/${target}`);
        if (matches) {
          visitors.add(sess.visitorId);
        }
      }
    }
    return visitors.size;
  } catch {
    return 0;
  }
}

