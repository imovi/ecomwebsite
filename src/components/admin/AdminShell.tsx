"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/lib/admin/actions";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { toast } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";

export type Role = "manager" | "admin" | "super_admin";

const ROLE_RANK: Record<Role, number> = {
  manager: 1,
  admin: 2,
  super_admin: 3,
};

export const ROLE_LABELS: Record<Role, string> = {
  manager: "Admin Member",
  admin: "Manager",
  super_admin: "Owner",
};

interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Earns a permanent slot in the phone's bottom bar. */
  primary?: boolean;
  /** Minimum role required to see and access this destination. Defaults to manager. */
  minRole?: Role;
}

const NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: "grid", primary: true, minRole: "manager" },
  { href: "/admin/orders", label: "Orders", icon: "package", primary: true, minRole: "manager" },
  { href: "/admin/abandoned", label: "Abandoned", icon: "cart", primary: true, minRole: "manager" },
  { href: "/admin/coupons", label: "Coupons", icon: "checkCircle", minRole: "manager" },
  { href: "/admin/products", label: "Products", icon: "mobile", primary: true, minRole: "manager" },
  { href: "/admin/profit", label: "Profit", icon: "cash", minRole: "admin" },
  { href: "/admin/performance", label: "Performance", icon: "rocket", minRole: "admin" },
  { href: "/admin/visitors", label: "Visitors", icon: "eye", minRole: "admin" },
  { href: "/admin/customers", label: "Customers", icon: "users", minRole: "manager" },
  { href: "/admin/categories", label: "Categories", icon: "blocks", minRole: "manager" },
  { href: "/admin/branding", label: "Branding", icon: "camera", minRole: "admin" },
  { href: "/admin/marketing", label: "Marketing", icon: "bolt", minRole: "admin" },
  { href: "/admin/integrations", label: "Integrations", icon: "plug", minRole: "admin" },
  { href: "/admin/ips", label: "Blocked IPs", icon: "shield", minRole: "admin" },
  { href: "/admin/team", label: "Team", icon: "users", minRole: "super_admin" },
  { href: "/admin/settings", label: "Settings", icon: "settings", minRole: "admin" },
];

function isPermitted(item: NavItem, userRole: Role): boolean {
  const min = item.minRole ?? "manager";
  return ROLE_RANK[userRole] >= ROLE_RANK[min];
}

interface CurrentAdminInfo {
  id?: string;
  name?: string;
  email?: string;
  role: Role;
}

let cachedAdmin: CurrentAdminInfo | null = null;

function getStoredRole(): Role {
  if (typeof document === "undefined") return "manager";
  const match = document.cookie.match(/(?:^|;\s*)gng_admin_role=([^;]+)/);
  if (match && (match[1] === "manager" || match[1] === "admin" || match[1] === "super_admin")) {
    return match[1] as Role;
  }
  return "manager";
}

const PRIMARY_ORDER = ["/admin", "/admin/orders", "/admin/products", "/admin/abandoned"];

interface AdminShellProps {
  title: string;
  /** Toolbar content: filters, a create button. */
  action?: React.ReactNode;
  children: React.ReactNode;
}

export function AdminShell({ title, action, children }: AdminShellProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  const [admin, setAdmin] = useState<CurrentAdminInfo>(() => {
    if (cachedAdmin) return cachedAdmin;
    return { role: getStoredRole() };
  });

  useEffect(() => {
    let active = true;
    adminApi
      .get<{ admin: { id: string; name: string; email: string; role: Role } }>("auth/me")
      .then((data) => {
        if (!active || !data.admin) return;
        const info: CurrentAdminInfo = {
          id: data.admin.id,
          name: data.admin.name,
          email: data.admin.email,
          role: data.admin.role,
        };
        cachedAdmin = info;
        setAdmin(info);
        if (typeof document !== "undefined") {
          document.cookie = `gng_admin_role=${encodeURIComponent(data.admin.role)}; path=/; max-age=604800; SameSite=Lax`;
        }
      })
      .catch(() => {
        /* Handled by proxy redirect if session died */
      });

    return () => {
      active = false;
    };
  }, []);

  const role = admin.role;
  const visibleNav = NAV.filter((item) => isPermitted(item, role));

  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    if (menuOpen) setMenuOpen(false);
  }

  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin";
    if (href === "/admin/abandoned") {
      return pathname.startsWith("/admin/abandoned") || pathname.startsWith("/admin/incomplete");
    }
    return pathname.startsWith(href);
  };

  const inMore = visibleNav.some((item) => !item.primary && isActive(item.href));

  // Access check for the current page
  const matchingItem = NAV.find((item) =>
    item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href)
  );
  const isDenied = Boolean(matchingItem && !isPermitted(matchingItem, role));

  const primaryItems = visibleNav
    .filter((item) => item.primary)
    .sort((a, b) => PRIMARY_ORDER.indexOf(a.href) - PRIMARY_ORDER.indexOf(b.href));

  return (
    <div className="min-h-dvh bg-surface">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-line bg-white lg:flex">
        <Link href="/admin" className="flex h-16 items-center px-5 text-title font-bold text-ink">
          {copy.brand.name}
          <span className="ml-2 rounded-xs bg-surface px-1.5 py-0.5 text-micro font-medium text-muted">
            {ROLE_LABELS[role]}
          </span>
        </Link>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 py-3">
          {visibleNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-sm px-3 py-2 text-caption font-medium transition-colors",
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
          {admin.name && (
            <div className="mb-2 px-3 py-1">
              <p className="truncate text-caption font-semibold text-ink">{admin.name}</p>
              <p className="text-micro text-muted">{ROLE_LABELS[role]}</p>
            </div>
          )}
          <button
            type="button"
            onClick={() => setPasswordOpen(true)}
            className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-caption text-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <Icon name="settings" size={17} />
            Change password
          </button>
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-sm px-3 py-2 text-caption text-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <Icon name="cart" size={17} />
            View storefront
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-caption text-muted transition-colors hover:bg-sale-soft hover:text-sale"
            >
              <Icon name="signOut" size={17} />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="lg:pl-56">
        <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-white/95 px-4 py-3 backdrop-blur-md lg:px-5">
          <h1 className="min-w-0 flex-1 truncate text-title font-semibold text-ink">{title}</h1>
          {action}
        </header>

        <main className="px-4 pb-28 pt-5 lg:px-6 lg:pb-10">
          {isDenied ? (
            <div className="mx-auto mt-8 max-w-md rounded-md border border-line bg-white p-8 text-center shadow-card">
              <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-surface text-muted">
                <Icon name="shield" size={24} />
              </div>
              <h2 className="text-title font-semibold text-ink">Access Restricted</h2>
              <p className="mt-1.5 text-caption text-ink-soft">
                আপনার অ্যাকাউন্ট ({ROLE_LABELS[role]}) থেকে এই সেকশনটিতে প্রবেশের অনুমতি নেই।
              </p>
              <p className="mt-1 text-micro text-muted">
                This section requires {matchingItem?.minRole === "super_admin" ? "Owner" : "Manager"} privileges.
              </p>
              <div className="mt-6 flex justify-center">
                <Link
                  href="/admin"
                  className="inline-flex items-center gap-2 rounded-sm bg-ink px-4 py-2 text-caption font-medium text-white hover:bg-ink-soft"
                >
                  <Icon name="chevronLeft" size={16} />
                  Back to Overview
                </Link>
              </div>
            </div>
          ) : (
            children
          )}
        </main>
      </div>

      {/* Phone tab bar */}
      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-white/95 pb-safe backdrop-blur-md lg:hidden"
      >
        {primaryItems.map((item) => (
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

      {/* Mobile drawer */}
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="All sections">
        <div className="grid grid-cols-3 gap-2 px-gutter pb-2">
          {visibleNav.map((item) => {
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
          {admin.name && (
            <div className="mb-2 px-1 py-1">
              <p className="truncate text-caption font-semibold text-ink">{admin.name}</p>
              <p className="text-micro font-medium text-muted">{ROLE_LABELS[role]}</p>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setPasswordOpen(true);
            }}
            className="flex min-h-12 items-center gap-2.5 rounded-sm px-1 text-caption text-muted active:bg-surface"
          >
            <Icon name="settings" size={18} />
            Change password
          </button>
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

      {/* Change password modal sheet */}
      <Sheet open={passwordOpen} onClose={() => setPasswordOpen(false)} title="Change password">
        <div className="p-4 sm:p-6">
          <ChangePasswordModalForm onClose={() => setPasswordOpen(false)} />
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

function ChangePasswordModalForm({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logoutFormRef = useRef<HTMLFormElement>(null);

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  async function submit() {
    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await adminApi.post("auth/change-password", { currentPassword, newPassword });
    } catch (caught) {
      setError(
        caught instanceof AdminApiError ? caught.message : "Could not change your password.",
      );
      setBusy(false);
      return;
    }

    toast("Password changed. Signing you out — please sign in again with the new password.");
    logoutFormRef.current?.requestSubmit();
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-caption text-muted">
        Your own account. You will be signed out afterwards and need to sign in again with your new password.
      </p>

      <Input
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
      />

      <Input
        label="New password"
        type="password"
        autoComplete="new-password"
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        hint="At least 12 characters, with an uppercase letter, a lowercase letter and a number."
      />

      <Input
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        error={mismatch ? "Does not match." : undefined}
      />

      {error && (
        <div className="rounded-xs border border-sale-soft bg-sale-soft/30 p-3 text-caption text-sale">
          {error}
        </div>
      )}

      <div className="mt-2 flex items-center justify-end gap-3">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          loading={busy}
          disabled={
            currentPassword.length === 0 || newPassword.length < 12 || confirmPassword.length === 0 || mismatch
          }
          onClick={() => void submit()}
        >
          Change password
        </Button>
      </div>

      <form ref={logoutFormRef} action={logoutAction} className="hidden" />
    </div>
  );
}
