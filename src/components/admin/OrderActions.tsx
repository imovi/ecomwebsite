"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { OrderStatus } from "@/types";
import { addOrderNoteAction, updateOrderStatusAction } from "@/app/actions";
import { copy } from "@/lib/copy";
import { toast } from "@/lib/stores/toast-store";
import { Button } from "@/components/ui/Button";

/**
 * Order status controls.
 *
 * Only legal forward transitions are offered — the allowed set is computed
 * server-side from the state machine in `lib/data/orders`, so the UI can't
 * offer a move the domain would reject.
 *
 * The PENDING → CONFIRMED step is the confirmation phone call. Making it an
 * explicit, logged transition is what turns "did anyone ring this customer?"
 * from a guess into a fact.
 */
export function OrderActions({
  orderId,
  status,
  allowed,
}: {
  orderId: string;
  status: OrderStatus;
  allowed: OrderStatus[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<OrderStatus | null>(null);

  async function move(next: OrderStatus) {
    setBusy(next);
    const result = await updateOrderStatusAction(
      orderId,
      next,
      note.trim() || undefined,
    );
    setBusy(null);

    if (!result.ok) {
      toast(result.error ?? "Could not update the order.", { tone: "error" });
      return;
    }

    setNote("");
    toast(`Order marked ${copy.orderStatus[next].toLowerCase()}`, {
      tone: "positive",
    });
    startTransition(() => router.refresh());
  }

  async function saveNote() {
    if (!note.trim()) return;
    await addOrderNoteAction(orderId, note);
    setNote("");
    toast("Note added");
    startTransition(() => router.refresh());
  }

  const terminal = allowed.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink-soft">
          Call notes {terminal ? "" : "(saved with the next status change)"}
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="e.g. Confirmed by phone, customer available after 6pm"
          className="rounded-sm border border-line bg-white px-3 py-2.5 text-caption outline-none focus:border-ink"
        />
      </label>

      {terminal ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-caption text-muted">
            This order is closed — {copy.orderStatus[status].toLowerCase()}.
          </p>
          <Button
            variant="soft"
            size="sm"
            onClick={saveNote}
            disabled={!note.trim() || pending}
          >
            Add note
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {allowed.map((next) => (
            <Button
              key={next}
              variant={
                next === "cancelled" || next === "returned" ? "danger" : "primary"
              }
              size="md"
              onClick={() => move(next)}
              loading={busy === next}
              disabled={busy !== null || pending}
            >
              Mark {copy.orderStatus[next].toLowerCase()}
            </Button>
          ))}
          <Button
            variant="soft"
            size="md"
            onClick={saveNote}
            disabled={!note.trim() || pending}
          >
            Add note only
          </Button>
        </div>
      )}
    </div>
  );
}
