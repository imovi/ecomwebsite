"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/lib/admin/actions";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";

/**
 * Admin chrome.
 *
 * Sidebar on desktop, bottom tab bar on mobile — the store is run from a phone
 * more often than a desk, and an order queue that needs a desktop to work is an
 * order queue that gets worked late.
 *
 * The phone bar carries four destinations and a More button, not all ten. Ten
 * tabs do not fit across a phone: squeezed to fit they leave ~37px each and
 * every label truncates into nonsense, and the scrolling row that replaced them
 * hid half the panel off the right edge of a bar that does not look scrollable.
 * Four is what fits at a legible size, and the rest live one tap away in a
 * sheet that shows every destination at once.
 */

interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Earns a permanent slot in the phone's bottom bar. */
  primary?: boolean;
}

/* The four primaries are the daily loop of running the shop: see what came in,
   work the queue, fix a listing, check the margin. Everything else is set up
   once and revisited occasionally, which is exactly what a More menu is for. */
const NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: "grid", primary: true },
  { href: "/admin/orders", label: "Orders", icon: "package", primary: true },
  { href: "/admin/products", label: "Products", icon: "mobile", primary: true },
  { href: "/admin/profit", label: "Profit", icon: "cash", primary: true },
  /* Directly under Profit, and deliberately not a primary: the two are read
     together — "did I make money" and then "is the advertising why" — but the
     second is a weekly question, and the bottom bar only has room for daily
     ones. */
  { href: "/admin/performance", label: "Performance", icon: "rocket" },
  /* Beside Orders in the More menu rather than in the primary bar: it is read
     when somebody is deciding whether to trust a caller, not on every shift. */
  { href: "/admin/customers", label: "Customers", icon: "users" },
  { href: "/admin/categories", label: "Categories", icon: "blocks" },
  { href: "/admin/branding", label: "Branding", icon: "camera" },
  { href: "/admin/marketing", label: "Marketing", icon: "bolt" },
  { href: "/admin/integrations", label: "Alerts", icon: "alert" },
  /* Beside Blocked IPs: both answer "should we send this parcel", and both are
     set up once and revisited rarely. */
  { href: "/admin/fraud", label: "Fraud check", icon: "truck" },
  { href: "/admin/ips", label: "Blocked IPs", icon: "shield" },
  { href: "/admin/team", label: "Team", icon: "users" },
  { href: "/admin/settings", label: "Settings", icon: "settings" },
];

const PRIMARY = NAV.filter((item) => item.primary);

interface AdminShellProps {
  title: string;
  /** Toolbar content: filters, a create button. */
  action?: React.ReactNode;
  children: React.ReactNode;
}

export function AdminShell({ title, action, children }: AdminShellProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  /**
   * Close on navigation.
   *
   * Each page renders its own shell, but a client-side push can reuse this
   * instance, and a sheet left open over the page the admin just asked for is
   * the kind of thing that gets called a freeze. Adjusted during render — the
   * pattern React documents for deriving state from props — rather than from
   * an effect, which would render the stale sheet once before closing it.
   */
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    if (menuOpen) setMenuOpen(false);
  }

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

  /* More stands in for wherever you actually are, so the bar never shows an
     admin sitting on Settings with nothing lit. */
  const inMore = NAV.some((item) => !item.primary && isActive(item.href));

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
              <Icon name="signOut" size={17} />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="lg:pl-56">
        {/* `min-w-0` on the title: a long product name has to be allowed to
            truncate, or it pushes the page action off the right of a phone. */}
        <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-white/95 px-4 py-3 backdrop-blur-md lg:px-5">
          <h1 className="min-w-0 flex-1 truncate text-title font-semibold text-ink">{title}</h1>
          {action}
        </header>

        <main className="px-4 pb-28 pt-5 lg:px-6 lg:pb-10">{children}</main>
      </div>

      {/* Phone tab bar: four destinations and More, evenly divided. */}
      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-white/95 pb-safe backdrop-blur-md lg:hidden"
      >
        {PRIMARY.map((item) => (
          <TabLink key={item.href} item={item} active={isActive(item.href)} />
        ))}

        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          className={cn(
            "flex min-h-14 flex-col items-center justify-center gap-1 text-micro font-medium transition-colors",
            inMore ? "text-ink" : "text-muted",
          )}
        >
          <Icon name="dots" size={20} />
          More
        </button>
      </nav>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="All sections">
        {/* Three across: every destination is on one screen with no scrolling,
            and each tile keeps a thumb-sized target. */}
        <div className="grid grid-cols-3 gap-2 px-gutter pb-2">
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-sm border px-2 py-3 text-center text-caption font-medium transition-colors",
                  active
                    ? "border-ink bg-ink text-white"
                    : "border-line text-ink-soft active:bg-surface",
                )}
              >
                <Icon name={item.icon} size={21} />
                <span className="leading-tight">{item.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="mt-2 flex flex-col border-t border-line px-gutter py-2 pb-5">
          <Link
            href="/"
            onClick={() => setMenuOpen(false)}
            className="flex min-h-12 items-center gap-2.5 rounded-sm px-1 text-caption text-muted active:bg-surface"
          >
            <Icon name="cart" size={18} />
            View storefront
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex min-h-12 w-full items-center gap-2.5 rounded-sm px-1 text-caption text-muted active:bg-sale-soft active:text-sale"
            >
              <Icon name="signOut" size={18} />
              Sign out
            </button>
          </form>
        </div>
      </Sheet>
    </div>
  );
}

function TabLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-14 flex-col items-center justify-center gap-1 text-micro font-medium transition-colors",
        active ? "text-ink" : "text-muted",
      )}
    >
      <Icon name={item.icon} size={20} />
      {item.label}
    </Link>
  );
}
