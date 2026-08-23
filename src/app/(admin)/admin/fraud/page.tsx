import type { Metadata } from "next";
import { FraudIntegration } from "@/components/admin/FraudIntegration";

export const metadata: Metadata = {
  title: "Fraud check · Admin",
  robots: { index: false, follow: false },
};

export default function AdminFraudPage() {
  return <FraudIntegration />;
}
