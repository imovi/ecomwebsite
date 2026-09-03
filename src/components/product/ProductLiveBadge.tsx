"use client";

import { useEffect, useState } from "react";

export function ProductLiveBadge({ slug }: { slug: string }) {
  const [liveCount, setLiveCount] = useState<number>(0);

  useEffect(() => {
    let mounted = true;
    const checkLive = async () => {
      try {
        const res = await fetch(`/api/track?product=${encodeURIComponent(slug)}`);
        if (res.ok && mounted) {
          const data = await res.json();
          setLiveCount(data.liveCount || 0);
        }
      } catch {}
    };

    checkLive();
    const interval = setInterval(checkLive, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [slug]);

  if (liveCount <= 0) return null;

  return (
    <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-micro font-medium text-emerald-800 border border-emerald-500/20 w-fit">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
      </span>
      <span>
        🔥 <strong>{liveCount} {liveCount === 1 ? "person is" : "people are"}</strong> viewing this right now
      </span>
    </div>
  );
}
