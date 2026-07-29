"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setVariantStockAction } from "@/app/admin-actions";
import { toast } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/Icon";

/**
 * Editable stock cell — saves on blur or Enter, not on every keystroke.
 *
 * Stock is edited in bursts while counting a shelf, so per-keystroke writes
 * would fire dozens of pointless mutations and make "97" briefly mean "9".
 */
export function StockInput({
  productId,
  variantId,
  stock,
}: {
  productId: string;
  variantId: string;
  stock: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(stock));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [, startTransition] = useTransition();

  async function commit() {
    const next = Number(value);
    if (!Number.isFinite(next) || next < 0) {
      setValue(String(stock));
      return;
    }
    if (next === stock) return;

    setSaving(true);
    const result = await setVariantStockAction(productId, variantId, next);
    setSaving(false);

    if (!result.ok) {
      setValue(String(stock));
      toast(result.error ?? "Could not update stock.", { tone: "error" });
      return;
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    startTransition(() => router.refresh());
  }

  const current = Number(value);

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        aria-label="Stock quantity"
        className={cn(
          "tnum h-8 w-16 rounded-xs border px-2 text-center text-caption font-medium outline-none focus:border-ink",
          current === 0
            ? "border-sale/40 bg-sale-soft text-sale"
            : current <= 3
              ? "border-warn/40 bg-warn-soft text-warn"
              : "border-line bg-white text-ink",
        )}
      />
      {saved && <Icon name="check" size={14} className="text-positive" />}
    </span>
  );
}
