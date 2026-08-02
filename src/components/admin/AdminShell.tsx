"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/lib/admin/actions";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { Icon } from "@/components/ui/Icon";

/**
 * Admin chrome.
 *
 * Sidebar on desktop, bottom tab bar on mobile — the store is run from a phone
 * more often than a desk, and an order queue that needs a desktop to work is an
 * order queue that gets worked late.
 */

const NAV = [
  { href: "/admin", label: "Overview", icon: "grid" },
  { href: "/admin/orders", label: "Orders", icon: "package" },
  { href: "/admin/profit", label: "Profit", icon: "cash" },
  { href: "/admin/products", label: "Products", icon: "mobile" },
  { href: "/admin/categories", label: "Categories", icon: "grid" },
  { href: "/admin/branding", label: "Branding", icon: "camera" },
  { href: "/admin/marketing", label: "Marketing", icon: "alert" },
  { href: "/admin/integrations", label: "Alerts", icon: "phone" },
  { href: "/admin/team", label: "Team", icon: "shield" },
  { href: "/admin/settings", label: "Settings", icon: "refresh" },
] as const;

interface AdminShellProps {
  title: string;
  /** Toolbar content: filters, a create button. */
  action?: React.ReactNode;
  children: React.ReactNode;
}

export function AdminShell({ title, action, children }: AdminShellProps) {
  const pathname = usePathname();

  /* `/admin` must not light up for `/admin/orders`, so the root is matched
     exactly while every other entry matches its subtree. Incomplete checkouts
     live at their own route but are a tab inside Orders, so that route lights
     up the Orders entry rather than nothing. */
  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin";
    if (href === "/admin/orders") {
      return pathname.startsWith("/admin/orders") || pathname.startsWith("/admin/incomplete");
    }
    return pathname.startsWith(href);
  };

  return (
    <div className="min-h-dvh bg-surface">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-line bg-white lg:flex">
        <Link href="/admin" className="flex h-16 items-center px-5 text-title font-bold text-ink">
          {copy.brand.name}
          <span className="ml-2 rounded-xs bg-surface px-1.5 py-0.5 text-micro font-medium text-muted">
            admin
          </span>
        </Link>

        <nav className="flex flex-1 flex-col gap-0.5 px-2.5 py-3">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-sm px-3 py-2.5 text-caption font-medium transition-colors",
                isActive(item.href)
                  ? "bg-ink text-white"
                  : "text-ink-soft hover:bg-surface hover:text-ink",
              )}
            >
              <Icon name={item.icon} size={17} />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-line p-2.5">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-sm px-3 py-2.5 text-caption text-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <Icon name="cart" size={17} />
            View storefront
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2.5 text-caption text-muted transition-colors hover:bg-sale-soft hover:text-sale"
            >
              <Icon name="power" size={17} />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="lg:pl-56">
        <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center gap-3 border-b border-line bg-white/95 px-5 py-3 backdrop-blur-md">
          <h1 className="flex-1 text-title font-semibold text-ink">{title}</h1>
          {action}
        </header>

        <main className="px-4 pb-28 pt-5 lg:px-6 lg:pb-10">{children}</main>
      </div>

      {/* Mobile tab bar */}
      {/* Scrolls rather than squeezing: ten tabs divided evenly across a phone
          leaves ~37px each, which truncates every label into nonsense. */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-line bg-white/95 pb-safe backdrop-blur-md lg:hidden">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex min-w-[68px] flex-1 shrink-0 flex-col items-center gap-1 py-2.5 text-micro font-medium transition-colors",
              isActive(item.href) ? "text-ink" : "text-muted",
            )}
          >
            <Icon name={item.icon} size={20} />
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
