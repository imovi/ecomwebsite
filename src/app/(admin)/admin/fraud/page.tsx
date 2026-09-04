import { redirect } from "next/navigation";

export default function AdminFraudPage() {
  redirect("/admin/settings?tab=courier");
}
