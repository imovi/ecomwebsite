import type { Metadata } from "next";
import { BlockedIpList } from "@/components/admin/BlockedIpList";

export const metadata: Metadata = {
  title: "Blocked addresses · Admin",
  robots: { index: false, follow: false },
};

export default function AdminBlockedIpsPage() {
  return <BlockedIpList />;
}
