import { redirect } from "next/navigation";

/**
 * The old address for this screen.
 *
 * Kept as a redirect rather than deleted: the page is linked from the Overview
 * and from the Orders tabs, it is the one admin screen somebody bookmarks, and
 * a 404 on it would read as the feature having been removed.
 */
export default function AdminIncompletePage() {
  redirect("/admin/abandoned");
}
