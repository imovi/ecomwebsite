import type { Metadata } from "next";
import Link from "next/link";
import { AdminNav } from "@/components/admin/AdminNav";
import { Icon } from "@/components/ui/Icon";

/** Admin data is never cached — the whole point is seeing current state. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · gng Admin" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <AdminNav />

      <div className="min-w-0 flex-1 bg-surface/40">
        {/*
          There is NO authentication on this panel. The build is frontend-only,
          so adding a fake login would imply protection that doesn't exist.
          Before this goes anywhere public it needs a real auth gate plus
          middleware protecting /admin — see README.
        */}
        <div className="flex items-center gap-2 bg-warn-soft px-4 py-2 text-caption text-warn">
          <Icon name="alert" size={15} />
          <span className="flex-1">
            Demo admin — no authentication, and changes reset when the server
            restarts.
          </span>
          <Link href="/" className="font-medium underline underline-offset-2">
            View store
          </Link>
        </div>

        <div className="px-4 py-6 md:px-8">{children}</div>
      </div>
    </div>
  );
}
