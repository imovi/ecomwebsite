"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

function getVisitorId(): string {
  if (typeof window === "undefined") return "";
  const key = "hinar_vid";
  try {
    let vid = localStorage.getItem(key);
    if (!vid) {
      vid = "v_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 9);
      localStorage.setItem(key, vid);
    }
    return vid;
  } catch {
    return "v_" + Math.random().toString(36).substring(2, 9);
  }
}

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  const key = "hinar_sid";
  try {
    let sid = sessionStorage.getItem(key);
    if (!sid) {
      sid = "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 7);
      sessionStorage.setItem(key, sid);
    }
    return sid;
  } catch {
    return "s_" + Math.random().toString(36).substring(2, 7);
  }
}

function detectProductId(pathname: string): string | null {
  if (typeof window === "undefined") return null;
  if (pathname.startsWith("/product/")) {
    const slug = pathname.replace("/product/", "").split("/")[0]?.split("?")[0];
    if (slug) return decodeURIComponent(slug);
  }
  if (pathname.startsWith("/products/")) {
    const slug = pathname.replace("/products/", "").split("/")[0]?.split("?")[0];
    if (slug) return decodeURIComponent(slug);
  }
  const m = window.location.search.match(/[?&](?:product_id|product|pid)=([^&]+)/i);
  if (m) return decodeURIComponent(m[1]);
  return null;
}

function sendTrack(type: "pageview" | "heartbeat", path: string) {
  const visitorId = getVisitorId();
  const sessionId = getSessionId();
  if (!visitorId || !sessionId) return;

  const payload = {
    type,
    visitorId,
    sessionId,
    pagePath: path,
    pageTitle: typeof document !== "undefined" ? document.title : "",
    productId: detectProductId(path),
    referrer: typeof document !== "undefined" ? document.referrer : "",
  };

  const bodyStr = JSON.stringify(payload);

  try {
    if (typeof fetch !== "undefined") {
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bodyStr,
        keepalive: true,
      }).catch(() => {});
    } else if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", bodyStr);
    }
  } catch {}
}

export function VisitorTracker() {
  const pathname = usePathname();
  const lastPath = useRef<string>("");

  // 1. Pageview on route change
  useEffect(() => {
    if (!pathname) return;
    if (lastPath.current !== pathname) {
      lastPath.current = pathname;
      // 150ms timeout ensures Next.js metadata has rendered the product/page title
      const timer = setTimeout(() => {
        sendTrack("pageview", pathname);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [pathname]);

  // 2. Heartbeat every 20s while active
  useEffect(() => {
    if (typeof window === "undefined") return;

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        sendTrack("heartbeat", window.location.pathname);
      }
    }, 20000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        sendTrack("heartbeat", window.location.pathname);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return null;
}
