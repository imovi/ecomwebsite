import type { Metadata } from "next";
import { ManualOrderForm } from "@/components/admin/ManualOrderForm";

export const metadata: Metadata = {
  title: "New order · Admin",
  robots: { index: false, follow: false },
};

export default function AdminNewOrderPage() {
  return <ManualOrderForm />;
}
