"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { cn, formatTaka, formatDateTime } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { orderMessage, whatsappHref } from "@/lib/admin/whatsapp";
import { FraudCard } from "./FraudCard";
import { toast } from "@/lib/stores/toast-store";
import type { ApiOrderDetail, ApiOrderStatus } from "@/lib/api/types";
import { AdminShell } from "./AdminShell";
import { OriginCard } from "./OriginCard";
import { AsyncState, Card, CardHeader, ErrorBanner, PageBody } from "./ui";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Input, Textarea } from "@/components/ui/Field";

/**
 * Order detail — the screen the store is actually run from.
 *
 * Every mutation sends `expectedVersion`. The API rejects a stale version with
 * a conflict, which is what stops two people on a confirmation call from
 * overwriting each other's correction without either noticing. On conflict the
 * order is reloaded and the operator is told to look again rather than having
 * their edit silently replayed onto newer data.
 */
export function OrderDetail({ identifier }: { identifier: string }) {
  const router = useRouter();
  const [order, setOrder] = useState<ApiOrderDetail | null>(null);
  const [shipment, setShipment] = useState<Shipment | null>(null);
  /** The shop's own WhatsApp wording; empty falls back to the built-in. */
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* Does not raise `loading` on entry: this also runs after every mutation,
     and blanking the order behind a skeleton mid-edit is disorienting. */
  const load = useCallback(async () => {
    try {
      const data = await adminApi.get<{ order: ApiOrderDetail }>(`admin/orders/${identifier}`);
      setOrder(data.order);

      /* Separate call, and a failure here is swallowed: a courier being
         unreachable must not stop the order itself from loading. */
      try {
        const parcel = await adminApi.get<{ shipment: Shipment | null }>(
          `admin/courier/order/${data.order.id}`,
        );
        setShipment(parcel.shipment);
      } catch {
        setShipment(null);
      }

      /* The shop's own WhatsApp wording, swallowed on failure for the same
         reason: the message falls back to the built-in Bangla, which is what
         it was before the shop could edit it. */
      try {
        const settings = await adminApi.get<{
          settings: { whatsappTemplates: Record<string, string> };
        }>("admin/settings");
        setTemplates(settings.settings.whatsappTemplates ?? {});
      } catch {
        setTemplates({});
      }

      setError(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not load the order.");
    } finally {
      setLoading(false);
    }
  }, [identifier]);

  useLoad(load);

  /** Runs a mutation, then refreshes so `version` and the timeline stay true. */
  const mutate = useCallback(
    async (action: () => Promise<unknown>, successMessage: string): Promise<boolean> => {
      setBusy(true);
      setActionError(null);
      try {
        await action();
        toast(successMessage);
        await load();
        return true;
      } catch (caught) {
        if (caught instanceof AdminApiError) {
          setActionError(
            caught.status === 409
              ? "Someone else changed this order while you were editing. It has been reloaded — please check and try again."
              : caught.message,
          );
          if (caught.status === 409) await load();
        } else {
          setActionError("Could not save. Please try again.");
        }
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  if (loading || error || !order) {
    return (
      <AdminShell title="Order">
        <AsyncState loading={loading} error={error} onRetry={() => {
            setLoading(true);
            void load();
          }}>
          <p />
        </AsyncState>
      </AdminShell>
    );
  }

  const isClosed = order.status === "cancelled" || order.status === "returned";

  return (
    <AdminShell
      title={order.orderNumber}
      action={
        <div className="flex items-center gap-2 2xl:col-span-2">
          <Button href="/admin/orders" variant="ghost" size="sm">
            Back
          </Button>
          {/* Opens the API's printable invoice through the authenticated proxy.

              `format=html` is not optional here: the endpoint defaults to JSON —
              for a caller that wants to render its own invoice — so without it
              this button opened a tab of raw JSON. */}
          <Button
            href={`/api/admin/admin/orders/${order.orderNumber}/invoice?format=html`}
            target="_blank"
            rel="noopener"
            variant="secondary"
            size="sm"
          >
            Invoice
          </Button>
          {/* Deliberately NOT beside the status buttons. Deleting is a tidying
              action — a test order, a duplicate — and putting it in the flow of
              working an order is how the wrong one gets removed. */}
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            onClick={() => {
              if (
                !window.confirm(
                  `Move ${order.orderNumber} to the trash? It is kept for 30 days and left out ` +
                    `of every count and profit figure until then.\n\n` +
                    `Stock is NOT returned — cancel the order instead if that is what you want.`,
                )
              ) {
                return;
              }

              void (async () => {
                if (await mutate(() => adminApi.delete(`admin/orders/${order.id}`), "Moved to trash")) {
                  router.push("/admin/orders");
                }
              })();
            }}
          >
            <Icon name="trash" size={15} />
            Delete
          </Button>
        </div>
      }
    >
      <PageBody>
        <ErrorBanner message={actionError} className="2xl:col-span-2" />

        <div className="flex flex-wrap items-center gap-2 2xl:col-span-2">
          <Badge tone={isClosed ? "saleSoft" : order.status === "delivered" ? "positive" : "ink"}>
            {copy.orderStatus[order.status]}
          </Badge>
          <span className="text-caption text-muted">
            Placed {formatDateTime(order.createdAt)}
          </span>
          <span className="text-caption text-muted">· Cash on delivery</span>
        </div>

        {order.cancellationReason && (
          <p className="rounded-sm bg-sale-soft px-3 py-2 text-caption text-sale">
            Cancelled: {order.cancellationReason}
          </p>
        )}

        <StatusActions
          order={order}
          busy={busy}
          onTransition={(status, note) =>
            mutate(
              () =>
                adminApi.patch(`admin/orders/${order.id}/status`, {
                  status,
                  expectedVersion: order.version,
                  ...(note ? { note } : {}),
                }),
              `Marked ${copy.orderStatus[status].toLowerCase()}`,
            )
          }
          onCancel={(reason) =>
            mutate(
              () =>
                adminApi.post(`admin/orders/${order.id}/cancel`, {
                  reason,
                  expectedVersion: order.version,
                }),
              "Order cancelled",
            )
          }
          onUndo={(reason) =>
            mutate(
              () =>
                adminApi.post(`admin/orders/${order.id}/revert`, {
                  reason,
                  expectedVersion: order.version,
                }),
              order.undoableTo
                ? `Put back to ${copy.orderStatus[order.undoableTo].toLowerCase()}`
                : "Status put back",
            )
          }
        />

        {/* Right under the status controls: the desk reads this before it
            decides whether to confirm, not after. */}
        <FraudCard phone={order.phone} />

        <CourierPanel
          order={order}
          shipment={shipment}
          busy={busy}
          onSend={() =>
            mutate(
              () => adminApi.post(`admin/courier/order/${order.id}/send`, {}),
              "Sent to the courier",
            )
          }
          onSync={() =>
            shipment
              ? mutate(
                  () => adminApi.post(`admin/courier/shipment/${shipment.id}/sync`, {}),
                  "Status refreshed",
                )
              : Promise.resolve(false)
          }
        />

        <CustomerCard order={order} busy={busy} mutate={mutate} templates={templates} />

        <OriginCard order={order} busy={busy} mutate={mutate} />

        <Card>
          <CardHeader title="Items" />
          <ul className="divide-y divide-line">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 p-4">
                <span className="relative size-12 shrink-0 overflow-hidden rounded-xs bg-surface">
                  {item.imageUrl ? (
                    <Image
                      src={item.imageUrl}
                      alt=""
                      fill
                      sizes="48px"
                      className="object-cover"
                    />
                  ) : (
                    <Icon
                      name="package"
                      size={18}
                      className="absolute inset-0 m-auto text-muted"
                    />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-caption text-ink">{item.productName}</p>
                  <p className="truncate text-micro text-muted">
                    {item.variantLabel ? `${item.variantLabel} · ` : ""}
                    {item.sku}
                  </p>
                </div>

                <ItemQuantity
                  order={order}
                  itemId={item.id}
                  quantity={item.quantity}
                  disabled={isClosed || busy}
                  mutate={mutate}
                />

                <span className="tnum w-24 shrink-0 text-right text-caption font-medium text-ink">
                  {formatTaka(item.lineTotal)}
                </span>
              </li>
            ))}
          </ul>

          <dl className="flex flex-col gap-1.5 border-t border-line p-4 text-caption">
            <div className="flex justify-between">
              <dt className="text-muted">Subtotal</dt>
              <dd className="tnum text-ink">{formatTaka(order.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">
                Delivery · {order.deliveryZone === "inside_dhaka" ? "Inside Dhaka" : "Outside Dhaka"}
              </dt>
              <dd className="tnum text-ink">{formatTaka(order.deliveryCharge)}</dd>
            </div>
            <div className="mt-1 flex justify-between border-t border-line pt-2 text-body font-semibold">
              <dt className="text-ink">Collect on delivery</dt>
              <dd className="tnum text-ink">{formatTaka(order.grandTotal)}</dd>
            </div>
          </dl>
        </Card>

        <NotesCard order={order} busy={busy} mutate={mutate} />
        <Timeline order={order} />
      </PageBody>
    </AdminShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */

interface Shipment {
  id: string;
  provider: string;
  consignmentId: string;
  trackingCode: string;
  status: string;
  courierStatus: string;
  codAmount: number;
  lastSyncedAt: string | null;
  lastError: string;
}

/** Our vocabulary, in the words the shop would use out loud. */
const SHIPMENT_LABELS: Record<string, string> = {
  pending: "Waiting for pickup",
  picked_up: "Picked up",
  in_transit: "On the way",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  returned: "Returned",
  cancelled: "Cancelled",
  unknown: "Check with the courier",
};

/**
 * The stages a parcel walks through, in order.
 *
 * `returned`, `cancelled` and `unknown` are deliberately absent: they are not
 * points on this line but departures from it, so they are rendered as their own
 * end state rather than being wedged into a sequence they do not belong to.
 */
const SHIPMENT_STAGES = [
  "pending",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
] as const;

/**
 * Where the parcel has got to, stage by stage.
 *
 * Collapsed by default behind a small toggle: the headline status answers the
 * question most of the time, and this screen is already long. Someone on the
 * phone to a customer who asks "so where is it exactly" opens it.
 */
function ShipmentStages({ shipment }: { shipment: Shipment }) {
  const [open, setOpen] = useState(false);

  const currentIndex = SHIPMENT_STAGES.indexOf(
    shipment.status as (typeof SHIPMENT_STAGES)[number],
  );
  /* Off the happy path — returned, cancelled or a status we could not map. */
  const derailed = currentIndex === -1;

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-fit items-center gap-1.5 text-caption font-medium text-ink-soft transition-colors hover:text-ink"
      >
        <Icon
          name="chevronDown"
          size={15}
          className={cn("transition-transform", open && "rotate-180")}
        />
        {open ? "Hide parcel stages" : "Show parcel stages"}
      </button>

      {open &&
        (derailed ? (
          <div className="flex items-center gap-2.5 rounded-sm bg-sale-soft px-3 py-2.5">
            <Icon name="alert" size={16} className="shrink-0 text-sale" />
            <p className="text-caption font-medium text-sale">
              {SHIPMENT_LABELS[shipment.status] ?? shipment.status}
              {shipment.courierStatus && (
                <span className="mt-0.5 block font-normal text-muted">
                  Courier says: {shipment.courierStatus}
                </span>
              )}
            </p>
          </div>
        ) : (
          <ol className="flex flex-col rounded-sm bg-surface px-3 py-3">
            {SHIPMENT_STAGES.map((stage, i) => {
              const done = i <= currentIndex;
              const isCurrent = i === currentIndex;
              const isLast = i === SHIPMENT_STAGES.length - 1;

              return (
                <li key={stage} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border",
                        done
                          ? "border-positive bg-positive text-white"
                          : "border-line bg-white text-line",
                      )}
                    >
                      {done && <Icon name="check" size={11} strokeWidth={2.6} />}
                    </span>
                    {!isLast && (
                      <span
                        className={cn(
                          "w-px flex-1",
                          i < currentIndex ? "bg-positive" : "bg-line",
                        )}
                      />
                    )}
                  </div>

                  <p
                    className={cn(
                      "pb-4 text-caption",
                      isLast && "pb-0",
                      isCurrent
                        ? "font-semibold text-ink"
                        : done
                          ? "text-ink-soft"
                          : "text-muted",
                    )}
                  >
                    {SHIPMENT_LABELS[stage]}
                    {/* The courier's own wording, against the stage it produced
                        — "they told me partial_delivered" is a real call. */}
                    {isCurrent && shipment.courierStatus && (
                      <span className="mt-0.5 block text-micro font-normal text-muted">
                        Courier says: {shipment.courierStatus}
                      </span>
                    )}
                  </p>
                </li>
              );
            })}
          </ol>
        ))}
    </div>
  );
}

/**
 * Hand-off and tracking for one order.
 *
 * Before it is sent this is a single button; after, it is a status line. The
 * button is deliberately absent for a pending order — the API refuses it too,
 * because an unconfirmed parcel is the refusal this whole workflow exists to
 * prevent, and a button that only ever errors is worse than no button.
 */
function CourierPanel({
  order,
  shipment,
  busy,
  onSend,
  onSync,
}: {
  order: ApiOrderDetail;
  shipment: Shipment | null;
  busy: boolean;
  onSend: () => Promise<boolean>;
  onSync: () => Promise<boolean>;
}) {
  const finished = order.status === "cancelled" || order.status === "returned";

  if (!shipment) {
    if (finished) return null;

    return (
      <Card>
        <CardHeader title="Courier" />
        <div className="flex flex-wrap items-center gap-3 p-4">
          {order.status === "pending" ? (
            <p className="text-caption text-muted">
              Confirm this order by phone first. Sending an unconfirmed parcel is how they come
              back.
            </p>
          ) : (
            <>
              <Button variant="primary" size="sm" loading={busy} onClick={() => void onSend()}>
                <Icon name="truck" size={16} />
                Send to courier
              </Button>
              <p className="text-caption text-muted">
                Creates the parcel and marks this order shipped.
              </p>
            </>
          )}
        </div>
      </Card>
    );
  }

  const mismatch = shipment.codAmount !== order.grandTotal;

  return (
    <Card>
      <CardHeader title="Courier" />
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-body font-semibold text-ink">
              {SHIPMENT_LABELS[shipment.status] ?? shipment.status}
            </p>
            <p className="text-caption text-muted">
              {shipment.provider}
              {shipment.trackingCode && (
                <>
                  {" · "}
                  <span className="tnum select-all font-mono">{shipment.trackingCode}</span>
                </>
              )}
              {shipment.lastSyncedAt && ` · checked ${formatDateTime(shipment.lastSyncedAt)}`}
            </p>
          </div>

          <Button variant="soft" size="sm" loading={busy} onClick={() => void onSync()}>
            <Icon name="refresh" size={15} />
            Refresh
          </Button>
        </div>

        <ShipmentStages shipment={shipment} />

        {mismatch && (
          <p className="flex items-start gap-2 rounded-sm bg-warn-soft px-3 py-2 text-caption text-warn">
            <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
            The courier will collect {formatTaka(shipment.codAmount)}, but this order totals{" "}
            {formatTaka(order.grandTotal)}. Fix it in the courier&apos;s panel before delivery.
          </p>
        )}

        {shipment.lastError && (
          <p className="rounded-sm bg-sale-soft px-3 py-2 text-caption text-sale">
            Last check failed: {shipment.lastError}
          </p>
        )}
      </div>
    </Card>
  );
}

function StatusActions({
  order,
  busy,
  onTransition,
  onCancel,
  onUndo,
}: {
  order: ApiOrderDetail;
  busy: boolean;
  onTransition: (status: ApiOrderStatus, note?: string) => Promise<boolean>;
  onCancel: (reason: string) => Promise<boolean>;
  onUndo: (reason: string) => Promise<boolean>;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [undoing, setUndoing] = useState(false);
  const [undoReason, setUndoReason] = useState("");

  /* Cancellation has its own required reason, so it is excluded here and gets
     a dedicated control. */
  const transitions = order.allowedTransitions.filter((status) => status !== "cancelled");
  const canCancel = order.allowedTransitions.includes("cancelled");

  /* The server decides this — it owns the undo stack, so a step already taken
     back is not offered a second time. See `undoableTo` on the DTO. */
  const undoTarget = order.undoableTo;

  if (transitions.length === 0 && !canCancel && !undoTarget) return null;

  return (
    <Card>
      <CardHeader title="Update status" />
      <div className="flex flex-col gap-3 p-4">
        {transitions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {transitions.map((status) => (
              <Button
                key={status}
                type="button"
                variant={status === "confirmed" ? "primary" : "secondary"}
                size="sm"
                disabled={busy}
                onClick={() => void onTransition(status)}
              >
                {copy.orderStatus[status]}
              </Button>
            ))}
          </div>
        )}

        {canCancel &&
          (cancelling ? (
            <div className="flex flex-col gap-2 rounded-sm border border-line p-3">
              <Input
                label="Why is this order being cancelled?"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                hint="Recorded permanently in the order history."
                placeholder="Customer not reachable after 3 calls"
                required
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  loading={busy}
                  disabled={reason.trim().length < 3}
                  onClick={async () => {
                    if (await onCancel(reason.trim())) {
                      setCancelling(false);
                      setReason("");
                    }
                  }}
                >
                  Cancel order
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCancelling(false)}
                >
                  Keep order
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="danger"
              size="sm"
              className="self-start"
              onClick={() => setCancelling(true)}
            >
              Cancel order
            </Button>
          ))}

        {/* Undoing the last move. Separated from the forward buttons by a rule
            and worded as a correction, because it is not part of working an
            order — it is admitting the last click was wrong, and it should not
            sit among the buttons somebody is clicking quickly. */}
        {undoTarget &&
          (undoing ? (
            <div className="flex flex-col gap-2 rounded-sm border border-line p-3">
              <Input
                label={`Why is this going back to ${copy.orderStatus[undoTarget].toLowerCase()}?`}
                value={undoReason}
                onChange={(event) => setUndoReason(event.target.value)}
                hint="Recorded permanently in the order history."
                placeholder="Marked shipped by mistake — the parcel is still here"
                required
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  disabled={undoReason.trim().length < 3}
                  onClick={async () => {
                    if (await onUndo(undoReason.trim())) {
                      setUndoing(false);
                      setUndoReason("");
                    }
                  }}
                >
                  Put it back
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setUndoing(false)}
                >
                  Leave it
                </Button>
              </div>
            </div>
          ) : (
            <div className="border-t border-line pt-3">
              <button
                type="button"
                onClick={() => setUndoing(true)}
                className="text-caption text-muted underline-offset-2 hover:text-ink hover:underline"
              >
                Undo &mdash; put this back to {copy.orderStatus[undoTarget].toLowerCase()}
              </button>
            </div>
          ))}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Customer                                                                   */
/* -------------------------------------------------------------------------- */

type Mutate = (action: () => Promise<unknown>, message: string) => Promise<boolean>;

function CustomerCard({
  order,
  busy,
  mutate,
  templates,
}: {
  order: ApiOrderDetail;
  busy: boolean;
  mutate: Mutate;
  /** The shop's own WhatsApp wording. Empty falls back to the built-in. */
  templates: Record<string, string>;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    customerName: order.customerName,
    phone: order.phone,
    address: order.address,
    areaText: order.areaText,
    note: "",
  });

  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  /* Rebuilt on every render rather than memoised: it is string concatenation
     over one order, and the message has to follow the status the moment it
     changes. */
  const whatsappLink = whatsappHref(
    order.phone,
    orderMessage(order, { storeName: copy.brand.name, templates }),
  );

  if (!editing) {
    return (
      <Card>
        <CardHeader title="Customer" />
        <div className="flex flex-col gap-2 p-4">
          <p className="text-body font-medium text-ink">{order.customerName}</p>
          <a
            href={`tel:${order.phone}`}
            className="tnum inline-flex w-fit items-center gap-1.5 text-caption text-ink hover:underline"
          >
            <Icon name="phone" size={15} />
            {order.phone}
          </a>
          <p className="text-caption text-ink-soft">{order.address}</p>
          <p className="text-caption text-muted">{order.areaText}</p>

          {/* Opens WhatsApp with this order's update already written. Absent
              when the number is not a Bangladeshi mobile, because `wa.me` would
              otherwise open a chat with a number in the wrong country. */}
          {whatsappLink && (
            <a
              href={whatsappLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1.5 rounded-sm border border-positive/30 bg-positive-soft px-2.5 py-1.5 text-caption font-medium text-positive hover:bg-positive/10"
            >
              <Icon name="whatsapp" size={15} />
              Send the update on WhatsApp
            </a>
          )}

          <Button
            type="button"
            variant="soft"
            size="sm"
            className="mt-1 self-start"
            onClick={() => {
              setForm({
                customerName: order.customerName,
                phone: order.phone,
                address: order.address,
                areaText: order.areaText,
                note: "",
              });
              setEditing(true);
            }}
          >
            Correct details
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Correct customer details"
        hint="Every change is recorded with your name and the previous value."
      />
      <div className="flex flex-col gap-4 p-4">
        <Input
          label="Name"
          value={form.customerName}
          onChange={(event) => set("customerName", event.target.value)}
        />
        <Input
          label="Phone"
          value={form.phone}
          inputMode="tel"
          onChange={(event) => set("phone", event.target.value)}
        />
        <Textarea
          label="Address"
          value={form.address}
          rows={3}
          onChange={(event) => set("address", event.target.value)}
        />
        <Input
          label="Area"
          value={form.areaText}
          onChange={(event) => set("areaText", event.target.value)}
          hint="Changing the area may change the delivery charge and the total."
        />
        <Input
          label="Note (optional)"
          value={form.note}
          onChange={(event) => set("note", event.target.value)}
          placeholder="Corrected during confirmation call"
        />

        <div className="flex gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={busy}
            onClick={async () => {
              /* Only changed fields are sent: the API records one audit entry
                 per field, and resending an unchanged value would log a change
                 that never happened. */
              const payload: Record<string, string | number> = {
                expectedVersion: order.version,
              };
              if (form.customerName !== order.customerName)
                payload.customerName = form.customerName.trim();
              if (form.phone !== order.phone) payload.phone = form.phone.trim();
              if (form.address !== order.address) payload.address = form.address.trim();
              if (form.areaText !== order.areaText) payload.areaText = form.areaText.trim();
              if (form.note.trim()) payload.note = form.note.trim();

              if (Object.keys(payload).length === 1) {
                setEditing(false);
                return;
              }

              if (await mutate(
                () => adminApi.patch(`admin/orders/${order.id}/customer`, payload),
                "Customer details updated",
              )) {
                setEditing(false);
              }
            }}
          >
            Save changes
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Items and notes                                                            */
/* -------------------------------------------------------------------------- */

function ItemQuantity({
  order,
  itemId,
  quantity,
  disabled,
  mutate,
}: {
  order: ApiOrderDetail;
  itemId: string;
  quantity: number;
  disabled: boolean;
  mutate: Mutate;
}) {
  const change = (next: number) => {
    if (next < 1) return;
    void mutate(
      () =>
        adminApi.patch(`admin/orders/${order.id}/items/${itemId}/quantity`, {
          quantity: next,
          expectedVersion: order.version,
        }),
      "Quantity updated",
    );
  };

  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => change(quantity - 1)}
        disabled={disabled || quantity <= 1}
        aria-label="Decrease quantity"
        className="flex size-7 items-center justify-center rounded-xs border border-line text-ink disabled:opacity-30"
      >
        <Icon name="minus" size={13} />
      </button>
      <span className="tnum w-7 text-center text-caption text-ink">{quantity}</span>
      <button
        type="button"
        onClick={() => change(quantity + 1)}
        disabled={disabled}
        aria-label="Increase quantity"
        className="flex size-7 items-center justify-center rounded-xs border border-line text-ink disabled:opacity-30"
      >
        <Icon name="plus" size={13} />
      </button>
    </div>
  );
}

function NotesCard({
  order,
  busy,
  mutate,
}: {
  order: ApiOrderDetail;
  busy: boolean;
  mutate: Mutate;
}) {
  const [notes, setNotes] = useState(order.internalNotes ?? "");
  const changed = notes !== (order.internalNotes ?? "");

  return (
    <Card>
      <CardHeader title="Internal notes" hint="Staff only. Never shown to the customer." />
      <div className="flex flex-col gap-3 p-4">
        <Textarea
          label="Notes"
          value={notes}
          rows={3}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Called at 6pm, asked to deliver after Friday prayers."
        />
        {changed && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={busy}
            className="self-start"
            onClick={() =>
              void mutate(
                () =>
                  adminApi.patch(`admin/orders/${order.id}/notes`, {
                    internalNotes: notes.trim() === "" ? null : notes.trim(),
                    expectedVersion: order.version,
                  }),
                "Notes saved",
              )
            }
          >
            Save notes
          </Button>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Timeline                                                                   */
/* -------------------------------------------------------------------------- */

/** Renders an audited value; `null` means the field was cleared. */
function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function Timeline({ order }: { order: ApiOrderDetail }) {
  return (
    <Card>
      <CardHeader
        title="History"
        hint="Every change to this order, oldest first. This record cannot be edited."
      />
      <ol className="flex flex-col divide-y divide-line">
        {order.timeline.map((event) => (
          <li key={event.id} className="flex flex-col gap-0.5 px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-caption font-medium text-ink">
                {event.type.replace(/_/g, " ")}
              </span>
              <span className="text-micro text-muted">{formatDateTime(event.createdAt)}</span>
              <span className="text-micro text-muted">· {event.actorName}</span>
            </div>

            {event.field && (
              <p className="text-micro text-ink-soft">
                <span className="text-muted">{event.field}:</span>{" "}
                {renderValue(event.previousValue)} → {renderValue(event.newValue)}
              </p>
            )}

            {event.note && <p className="text-micro text-muted">“{event.note}”</p>}
          </li>
        ))}
      </ol>
    </Card>
  );
}
