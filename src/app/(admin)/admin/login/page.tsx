import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LoginForm } from "@/components/admin/LoginForm";
import { copy } from "@/lib/copy";
import { RETURN_TO_COOKIE, safeReturnTo } from "@/lib/admin/return-to";

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
export default async function AdminLoginPage() {
  /* Where the proxy was taking this admin before it found no session. Read here
     rather than in the form so the destination survives a submission without
     JavaScript — it goes into the form as a hidden field. */
  const returnTo = safeReturnTo((await cookies()).get(RETURN_TO_COOKIE)?.value);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-5 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 text-center">
          <p className="text-[26px] font-bold tracking-tight text-ink">{copy.brand.name}</p>
          <p className="mt-1 text-caption text-muted">Store administration</p>
        </div>

        <div className="rounded-md border border-line bg-white p-6 shadow-card">
          <LoginForm returnTo={returnTo} />
        </div>

        <p className="mt-6 text-center text-micro text-muted">
          Authorised staff only. All changes are recorded.
        </p>
      </div>
    </main>
  );
}
