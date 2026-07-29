"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/Icon";

/**
 * Only the sections that exist. Categories, customers, coupons and banners
 * were descoped — add them here when they're built rather than shipping links
 * that 404.
 */
const ITEMS = [
  { href: "/admin", label: "Dashboard", icon: "grid", exact: true },
  { href: "/admin/orders", label: "Orders", icon: "package" },
  { href: "/admin/products", label: "Products", icon: "mobile" },
  { href: "/admin/stock", label: "Stock", icon: "alert" },
];

/**
 * Sidebar on desktop, horizontal scroller on mobile. Admin work happens on a
 * laptop, but order confirmation calls happen on a phone — so the orders view
 * has to be usable one-handed.
 */
export function AdminNav() {
  const pathname = usePathname();

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <nav
      aria-label="Admin"
      className="border-b border-line bg-white md:h-full md:w-56 md:shrink-0 md:border-b-0 md:border-r"
    >
      <div className="hidden px-4 py-5 md:block">
        <Link href="/" className="text-title tracking-[-0.04em] text-ink">
          gng
        </Link>
        <p className="text-micro text-muted">Admin</p>
      </div>

      <ul className="snap-rail gap-1 px-3 py-2 md:flex-col md:overflow-visible md:px-2 md:py-0">
        {ITEMS.map((item) => {
          const active = isActive(item.href, item.exact);
          return (
            <li key={item.href} className="snap-item md:w-full">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 whitespace-nowrap rounded-sm px-3 py-2.5 text-caption font-medium transition-colors",
                  active
                    ? "bg-ink text-white"
                    : "text-ink-soft hover:bg-surface hover:text-ink",
                )}
              >
                <Icon name={item.icon} size={17} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
