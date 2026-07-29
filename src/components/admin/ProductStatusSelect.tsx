"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ProductStatus } from "@/types";
import { setProductStatusAction } from "@/app/admin-actions";
import { toast } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";

const STATUSES: ProductStatus[] = ["active", "draft", "archived"];

/** Inline publish control. Archived products stay in order history but leave
 *  the storefront immediately. */
export function ProductStatusSelect({
  productId,
  status,
}: {
  productId: string;
  status: ProductStatus;
}) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();

  async function change(next: ProductStatus) {
    const previous = value;
    setValue(next);
    setSaving(true);

    const result = await setProductStatusAction(productId, next);
    setSaving(false);

    if (!result.ok) {
      setValue(previous);
      toast(result.error ?? "Could not update the product.", { tone: "error" });
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <select
      value={value}
      disabled={saving}
      onChange={(e) => change(e.target.value as ProductStatus)}
      aria-label="Product status"
      className={cn(
        "h-8 rounded-xs border px-2 text-caption font-medium outline-none",
        value === "active"
          ? "border-positive/30 bg-positive-soft text-positive"
          : value === "draft"
            ? "border-line bg-surface text-ink-soft"
            : "border-line bg-white text-muted",
      )}
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
