import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/admin/LoginForm";
import { Skeleton } from "@/components/ui/Layout";
import { copy } from "@/lib/copy";

/**
 * The shop's name, not a live lookup.
 *
 * This page is reachable before anyone has signed in, so it deliberately does
 * not call the API for settings — an unauthenticated page that queries the
 * database on every hit is a free denial-of-service, and the sign-in screen is
 * the one page an attacker can reach at will.
 */
export const metadata: Metadata = {
  /* The shop's name is not repeated here — the root layout's title template
     already appends it, and spelling it out gave the tab the name twice. */
  title: "Sign in · Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin sign-in.
 *
 * Deliberately outside the admin shell — no navigation, no store branding
 * beyond the wordmark. Nothing here should hint at what the panel contains.
 */
export default function AdminLoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-5 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 text-center">
          <p className="text-[26px] font-bold tracking-tight text-ink">{copy.brand.name}</p>
          <p className="mt-1 text-caption text-muted">Store administration</p>
        </div>

        <div className="rounded-md border border-line bg-white p-6 shadow-card">
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-micro text-muted">
          Authorised staff only. All changes are recorded.
        </p>
      </div>
    </main>
  );
}
