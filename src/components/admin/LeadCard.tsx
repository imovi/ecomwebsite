"use client";

import { useState } from "react";
import { copy } from "@/lib/copy";
import { cn, formatTaka } from "@/lib/utils";
import {
  couponOfferMessage,
  offerDeadline,
  recoveryMessage,
  whatsappHref,
} from "@/lib/admin/whatsapp";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";

/**
 * One incomplete checkout, and everything the desk can do about it.
 *
 * The order of the actions is the order they are usually taken — ring, message,
 * offer — but nothing here enforces a sequence. An operator who can already
 * tell from the note that this customer only ever wanted free delivery should
 * be able to send the offer first, and the plan this was built from is explicit
 * about that.
 *
 * Nothing sends itself. Every WhatsApp button opens a chat with the text
 * written and waiting; a human reads it, adjusts it and sends. The separate
 * "mark as sent" confirmation exists because opening a chat is not sending, and
 * a status set on the click would mark half this list as messaged when it was
 * not.
 */

export interface LeadLine {
  name: string;
  variantLabel: string | null;
  quantity: number;
}

export interface LeadCoupon {
  id: string;
  code: string;
  state: "active" | "used" | "cancelled" | "expired";
  cartValue: number;
  expiresAt: string;
  usedAt: string | null;
}

export interface LeadEvent {
  id: string;
  type: string;
  detail: Record<string, unknown>;
  actorName: string;
  createdAt: string;
}

export type LeadStage =
  | "open"
  | "called"
  | "help_message_sent"
  | "coupon_active"
  | "coupon_offer_sent"
  | "coupon_expired"
  | "recovered"
  | "dismissed";

export interface Lead {
  id: string;
  phone: string;
  customerName: string | null;
  address: string | null;
  areaText: string | null;
  contents: LeadLine[];
  itemCount: number;
  estimatedValue: number;
  status: "open" | "contacted" | "dismissed";
  note: string;
  reason: string;
  contactedAt: string | null;
  helpMessageSentAt: string | null;
  couponOfferSentAt: string | null;
  recovered: boolean;
  coupon: LeadCoupon | null;
  events: LeadEvent[];
  stage: LeadStage;
  lastSeenAt: string;
}

/** The reasons the desk can tag, in the words an operator would use. */
const REASONS: { value: string; label: string }[] = [
  { value: "", label: "No reason recorded" },
  { value: "price_too_high", label: "Price too high" },
  { value: "delivery_charge", label: "Delivery charge too high" },
  { value: "product_question", label: "Question about the product" },
  { value: "buying_later", label: "Will buy later" },
  { value: "delivery_area", label: "Delivery area problem" },
  { value: "checkout_problem", label: "Checkout would not work" },
  { value: "no_response", label: "No response" },
  { value: "do_not_contact", label: "Do not contact" },
];

const STAGES: Record<LeadStage, { label: string; tone: "positive" | "warn" | "saleSoft" | "neutral" | "ink" }> = {
  open: { label: "Waiting", tone: "neutral" },
  called: { label: "Called", tone: "saleSoft" },
  help_message_sent: { label: "Messaged", tone: "saleSoft" },
  coupon_active: { label: "Offer ready", tone: "ink" },
  coupon_offer_sent: { label: "Offer sent", tone: "ink" },
  coupon_expired: { label: "Offer expired", tone: "warn" },
  recovered: { label: "Ordered", tone: "positive" },
  dismissed: { label: "Dismissed", tone: "warn" },
};

/** "12 min ago" beats a timestamp when deciding who to ring first. */
function sinceLabel(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** How long an offer has left, which is the only part an operator acts on. */
function remainingLabel(iso: string): string {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (minutes <= 0) return "expired";
  if (minutes < 60) return `${minutes} min left`;

  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} left`;
}

export interface LeadActions {
  onStatus: (status: "contacted" | "dismissed") => Promise<void>;
  onNote: (input: { note?: string; reason?: string }) => Promise<void>;
  onGenerateCoupon: () => Promise<void>;
  onCancelCoupon: () => Promise<void>;
  onMarkSent: (kind: "help" | "coupon_offer") => Promise<void>;
  onDelete: () => void;
}

export function LeadCard({
  lead,
  busy,
  actions,
}: {
  lead: Lead;
  busy: boolean;
  actions: LeadActions;
}) {
  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState(lead.note);
  const [reason, setReason] = useState(lead.reason);
  const [showHistory, setShowHistory] = useState(false);

  /**
   * Which message the operator has just been handed, and not yet confirmed.
   *
   * The confirm strip appears only after a WhatsApp link is opened, so the shop
   * is asked "did that go?" at the one moment it knows the answer — rather than
   * being given a button to press about a message it may not have sent.
   */
  const [awaitingConfirm, setAwaitingConfirm] = useState<"help" | "coupon_offer" | null>(null);

  const stage = STAGES[lead.stage];
  const coupon = lead.coupon;
  const liveCoupon = coupon?.state === "active" ? coupon : null;

  const helpHref = whatsappHref(
    lead.phone,
    recoveryMessage(lead, { storeName: copy.brand.name }),
  );
  const offerHref = liveCoupon
    ? whatsappHref(
        lead.phone,
        couponOfferMessage(lead, liveCoupon, { storeName: copy.brand.name }),
      )
    : null;

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-md border bg-white p-3",
        lead.recovered ? "border-line opacity-60" : "border-line",
      )}
    >
      {/* --- Who, what, how much ------------------------------------------ */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* The phone is the point of the page, so it is the biggest thing on
              the card and it dials on a tap. */}
          <a
            href={`tel:${lead.phone}`}
            className="tnum text-title font-semibold text-ink underline-offset-4 hover:underline"
          >
            {lead.phone}
          </a>

          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-caption text-muted">
            {lead.customerName ?? "No name given"}
            <span>· {sinceLabel(lead.lastSeenAt)}</span>
            <Badge tone={stage.tone}>{stage.label}</Badge>
          </p>

          {lead.areaText && (
            <p className="mt-0.5 truncate text-micro text-muted">
              {[lead.address, lead.areaText].filter(Boolean).join(", ")}
            </p>
          )}
        </div>

        <div className="text-right">
          <p className="tnum text-body font-semibold text-ink">
            {formatTaka(lead.estimatedValue)}
          </p>
          <p className="text-micro text-muted">
            {lead.itemCount} item{lead.itemCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {lead.contents.length > 0 && (
        <ul className="flex flex-col gap-0.5 rounded-sm bg-surface px-3 py-2">
          {lead.contents.map((line, index) => (
            <li key={`${line.name}-${index}`} className="text-caption text-ink-soft">
              {line.name}
              {line.variantLabel && <span className="text-muted"> ({line.variantLabel})</span>}
              <span className="text-muted"> × {line.quantity}</span>
            </li>
          ))}
        </ul>
      )}

      {/* --- The offer ------------------------------------------------------ */}
      {coupon && <CouponPanel coupon={coupon} busy={busy} onCancel={actions.onCancelCoupon} />}

      {/* --- What the customer said ----------------------------------------- */}
      {editingNote ? (
        <div className="flex flex-col gap-2 rounded-sm border border-line p-3">
          <Input
            label="What did they say?"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <Select
            label="Reason"
            hint="Counted on the recovery report, so the same answer given forty times becomes visible."
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            {REASONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              onClick={() =>
                void actions.onNote({ note, reason }).then(() => setEditingNote(false))
              }
            >
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditingNote(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        (lead.note || lead.reason) && (
          <p className="text-caption text-muted">
            {lead.note && <span>“{lead.note}”</span>}
            {lead.reason && (
              <span className="ml-2 text-micro uppercase tracking-wide">
                {REASONS.find((option) => option.value === lead.reason)?.label ?? lead.reason}
              </span>
            )}
          </p>
        )
      )}

      {/* --- Did that message actually go? ---------------------------------- */}
      {awaitingConfirm && (
        <div className="flex flex-wrap items-center gap-2 rounded-sm bg-surface px-3 py-2">
          <p className="flex-1 text-caption text-ink-soft">
            Did the message go through?
          </p>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            onClick={() =>
              void actions.onMarkSent(awaitingConfirm).then(() => setAwaitingConfirm(null))
            }
          >
            <Icon name="check" size={15} />
            Yes, mark as sent
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAwaitingConfirm(null)}>
            Not yet
          </Button>
        </div>
      )}

      {/* --- Actions -------------------------------------------------------- */}
      {!lead.recovered && (
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`tel:${lead.phone}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-xs bg-ink px-3 text-caption font-medium text-white hover:opacity-90"
          >
            <Icon name="phone" size={15} />
            Call
          </a>

          {helpHref && (
            <a
              href={helpHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setAwaitingConfirm("help")}
              className="inline-flex h-8 items-center gap-1.5 rounded-xs border border-line px-3 text-caption font-medium text-ink hover:bg-surface"
            >
              <Icon name="whatsapp" size={15} />
              {lead.helpMessageSentAt ? "Message again" : "Send help message"}
            </a>
          )}

          {offerHref && (
            <a
              href={offerHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setAwaitingConfirm("coupon_offer")}
              className="inline-flex h-8 items-center gap-1.5 rounded-xs bg-positive-soft px-3 text-caption font-medium text-positive hover:opacity-90"
            >
              <Icon name="whatsapp" size={15} />
              Send offer
            </a>
          )}

          {!liveCoupon && (
            <Button
              variant="soft"
              size="sm"
              disabled={busy || lead.reason === "do_not_contact"}
              onClick={() => void actions.onGenerateCoupon()}
            >
              <Icon name="bolt" size={15} />
              {coupon ? "New offer" : "Generate offer"}
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            disabled={busy || lead.status === "contacted"}
            onClick={() => void actions.onStatus("contacted")}
          >
            {lead.status === "contacted" ? "Called ✓" : "Mark called"}
          </Button>

          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditingNote(true)}>
            {lead.note || lead.reason ? "Edit note" : "Add note"}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            disabled={busy || lead.status === "dismissed"}
            onClick={() => void actions.onStatus("dismissed")}
          >
            Dismiss
          </Button>

          <button
            type="button"
            onClick={actions.onDelete}
            disabled={busy}
            aria-label={`Delete the record for ${lead.phone}`}
            className="ml-auto flex size-8 items-center justify-center rounded-xs text-muted hover:bg-sale-soft hover:text-sale disabled:opacity-30"
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      )}

      {/* --- What has been done --------------------------------------------- */}
      {lead.events.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowHistory((open) => !open)}
            className="text-micro text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            {showHistory ? "Hide history" : `History (${lead.events.length})`}
          </button>

          {showHistory && <LeadHistory events={lead.events} />}
        </div>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The offer, and what became of it.
 *
 * The code is the largest thing here for the same reason the phone number is
 * largest on the card: it is what somebody has to read out or copy. Everything
 * else answers "can I still send this?".
 */
function CouponPanel({
  coupon,
  busy,
  onCancel,
}: {
  coupon: LeadCoupon;
  busy: boolean;
  onCancel: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);

  const tone =
    coupon.state === "active"
      ? "border-positive-soft bg-positive-soft"
      : coupon.state === "used"
        ? "border-line bg-surface"
        : "border-line bg-surface opacity-70";

  const status =
    coupon.state === "active"
      ? `Active · ${remainingLabel(coupon.expiresAt)} · until ${offerDeadline(coupon.expiresAt)}`
      : coupon.state === "used"
        ? `Used${coupon.usedAt ? ` · ${offerDeadline(coupon.usedAt)}` : ""}`
        : coupon.state === "cancelled"
          ? "Cancelled"
          : `Expired · ${offerDeadline(coupon.expiresAt)}`;

  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded-sm border px-3 py-2", tone)}>
      <div className="min-w-0 flex-1">
        <p className="text-micro uppercase tracking-wide text-muted">
          Free delivery, one use
        </p>
        <p className="tnum text-title font-semibold tracking-wider text-ink">{coupon.code}</p>
        <p className="text-micro text-muted">{status}</p>
      </div>

      {coupon.state === "active" && (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              /* `writeText` rejects when the page is not focused or the
                 browser refuses the permission. Swallowed, because the code is
                 on screen and can be read — a toast about a failed copy helps
                 nobody select six characters. */
              void navigator.clipboard
                ?.writeText(coupon.code)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                })
                .catch(() => undefined);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void onCancel()}>
            Cancel offer
          </Button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** What each entry says, in the words somebody reading it back would want. */
const EVENT_LABELS: Record<string, string> = {
  help_message_sent: "Help message sent",
  coupon_generated: "Offer created",
  coupon_offer_sent: "Offer sent on WhatsApp",
  coupon_used: "Offer used",
  coupon_cancelled: "Offer cancelled",
  called: "Marked as called",
  note_added: "Note added",
  dismissed: "Dismissed",
  recovered: "Order placed",
};

function LeadHistory({ events }: { events: LeadEvent[] }) {
  return (
    <ol className="mt-2 flex flex-col gap-1 border-l border-line pl-3">
      {events.map((event) => {
        const code = typeof event.detail.code === "string" ? event.detail.code : null;
        const orderNumber =
          typeof event.detail.orderNumber === "string" ? event.detail.orderNumber : null;

        return (
          <li key={event.id} className="text-micro text-muted">
            <span className="text-ink-soft">
              {EVENT_LABELS[event.type] ?? event.type}
              {code && <span className="tnum"> · {code}</span>}
              {orderNumber && <span className="tnum"> · {orderNumber}</span>}
            </span>
            {" — "}
            {offerDeadline(event.createdAt)}
            {event.actorName && ` · ${event.actorName}`}
          </li>
        );
      })}
    </ol>
  );
}
