import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/admin/ForgotPasswordForm";
import { copy } from "@/lib/copy";

export const metadata: Metadata = {
  title: "Reset password · Admin",
  robots: { index: false, follow: false },
};

/**
 * Password recovery.
 *
 * Like the sign-in page, this is reachable without a session, so it makes no
 * API call of its own — an unauthenticated page that queries the database on
 * every hit is a free denial-of-service, and this one is reachable at will.
 *
 * Kept outside the admin shell for the same reason as sign-in: nothing here
 * should hint at what the panel contains.
 */
export default function AdminForgotPasswordPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-5 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 text-center">
          <p className="text-[26px] font-bold tracking-tight text-ink">{copy.brand.name}</p>
          <p className="mt-1 text-caption text-muted">Store administration</p>
        </div>

        <div className="rounded-md border border-line bg-white p-6 shadow-card">
          <ForgotPasswordForm />
        </div>

        <p className="mt-6 text-center text-micro text-muted">
          Authorised staff only. All changes are recorded.
        </p>
      </div>
    </main>
  );
}
