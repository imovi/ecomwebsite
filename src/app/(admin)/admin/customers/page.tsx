import type { Metadata } from "next";
import { CustomerList } from "@/components/admin/CustomerList";

export const metadata: Metadata = {
  title: "Customers · Admin",
  robots: { index: false, follow: false },
};

export default function AdminCustomersPage() {
  return <CustomerList />;
}
