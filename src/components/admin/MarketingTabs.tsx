"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function MarketingTabs() {
  const pathname = usePathname();
  const isAnnouncement = pathname.startsWith("/admin/marketing/announcement");

  return (
    <div className="flex border-b border-line mb-6 gap-2">
      <Link
        href="/admin/marketing"
        className={cn(
          "px-4 py-2.5 text-caption font-medium border-b-2 transition-colors -mb-px",
          !isAnnouncement
            ? "border-primary text-primary font-semibold"
            : "border-transparent text-muted hover:text-ink"
        )}
      >
        Tracking & Pixels
      </Link>
      <Link
        href="/admin/marketing/announcement"
        className={cn(
          "px-4 py-2.5 text-caption font-medium border-b-2 transition-colors -mb-px",
          isAnnouncement
            ? "border-primary text-primary font-semibold"
            : "border-transparent text-muted hover:text-ink"
        )}
      >
        Top Announcement Bar
      </Link>
    </div>
  );
}
