import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Admin route group.
 *
 * A pass-through: the login page renders standalone, and every authenticated
 * page wraps itself in `AdminShell`. Putting the shell here instead would draw
 * navigation around the login form.
 */
export default function AdminGroupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
