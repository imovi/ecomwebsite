"use client";

import { useState } from "react";
import { quickAddProductAction } from "@/app/actions";
import type { QuickAddProduct } from "@/lib/catalog-utils";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { Icon } from "@/components/ui/Icon";
import { QuickAddSheet, type QuickAddSummary } from "./QuickAddSheet";

/**
 * The one interactive control on an otherwise static product card.
 *
 * It is a sibling of the card's link, never a descendant: a button inside an
 * anchor is invalid HTML, and nesting the two makes a tap near the boundary
 * ambiguous. The card's link stretches over the whole card with a pseudo
 * element instead, and this sits above it — see `ProductCard`.
 *
 * WHY THE PRODUCT IS FETCHED ON TAP
 * The card is rendered from the listing endpoint, which returns no variants.
 * The summary it holds is enough to draw the sheet's header immediately — the
 * photo, name and price the shopper is already looking at — but not enough to
 * know whether there is a size to choose. So the sheet opens at once and the
 * real variant data lands a moment later, rather than the tap sitting there
 * doing nothing while a request completes.
 *
 * Fetched once per card. Re-opening the same card does not ask again; the data
 * is thirty seconds fresh from the server's own cache and stock is re-checked
 * server-side at placement regardless.
 */
export function QuickAddButton({
  summary,
  className,
}: {
  summary: QuickAddSummary;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<QuickAddProduct | null>(null);
  const [failed, setFailed] = useState(false);

  async function handleOpen() {
    setOpen(true);
    if (detail || failed) return;

    const loaded = await quickAddProductAction(summary.id);
    if (loaded) setDetail(loaded);
    else setFailed(true);
  }

  return (
    <>
      <button
        type="button"
        aria-label={copy.product.quickAdd(summary.title)}
        aria-haspopup="dialog"
        onClick={handleOpen}
        className={cn(
          /* 44px: the smallest target a thumb hits reliably. The visual circle
             is what the shopper sees; the hit area is the whole square. */
          "flex size-11 items-center justify-center rounded-full",
          "bg-white text-ink shadow-card",
          "transition-[transform,background-color] duration-150 ease-out",
          "hover:bg-ink hover:text-white active:scale-95",
          "motion-reduce:transition-none motion-reduce:active:scale-100",
          className,
        )}
      >
        <Icon name="cart" size={19} />
      </button>

      {/* Stays mounted while closed — it renders nothing in that state, and
          keeping it mounted is what lets it play its closing animation. */}
      <QuickAddSheet
        summary={summary}
        product={detail}
        failed={failed}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
