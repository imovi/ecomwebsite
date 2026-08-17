"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { toast } from "@/lib/stores/toast-store";
import { formatTaka } from "@/lib/utils";
import type { ApiProduct, ApiProductListItem, ApiQuote } from "@/lib/api/types";
import { AdminShell } from "./AdminShell";
import { Card, CardHeader, ErrorBanner, PageBody } from "./ui";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Input, Select, Textarea } from "@/components/ui/Field";

/**
 * An order the desk takes by hand.
 *
 * Most of this shop's sales are agreed in a message rather than through the
 * checkout: a customer sees an ad, writes to the page or to WhatsApp, and
 * somebody settles it in a conversation. This is where that conversation becomes
 * an order.
 *
 * IT PRICES BEFORE IT COMMITS
 * --------------------------
 * The totals come from the server, never from arithmetic here. The desk is on a
 * call and has to say a number out loud, and a number this form worked out
 * itself could disagree with the one the order is written with — which is the
 * kind of discrepancy a customer discovers when the courier asks for money.
 *
 * So every change re-quotes, and the button stays disabled until a quote has
 * come back. What is shown is what will be charged.
 */

/** Chips rather than a dropdown: these are the four that actually happen, and
 *  the field stays free text for the fifth. */
const SOURCE_SUGGESTIONS = ["WhatsApp", "Facebook page", "Instagram", "Phone call"];

/** Named so an emptied cart can retire this message without hiding real ones. */
const PRICING_FAILED = "Could not price this cart.";

interface Line {
  /** Stable for the life of the line, so removing one above it does not
   *  remount the rows below and take the focus with it. */
  key: string;
  productId: string;
  variantId: string | null;
  quantity: number;
}

export function ManualOrderForm() {
  const router = useRouter();

  const [products, setProducts] = useState<ApiProductListItem[]>([]);
  /** Full detail, fetched only for products that actually have options. */
  const [detail, setDetail] = useState<Record<string, ApiProduct>>({});

  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [areaText, setAreaText] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState<"confirmed" | "pending">("confirmed");
  const [lines, setLines] = useState<Line[]>([]);

  /* Monotonic, so a line's key is unique for the life of the form no matter how
     many are added and removed. Derived keys collide the moment two lines of the
     same product exist. */
  const nextKey = useRef(0);

  /* Products whose detail request is already out. Without this, choosing the
     same product twice before the first reply lands fires a second identical
     request and adds a second line for one click's worth of intent. */
  const fetchingDetail = useRef(new Set<string>());

  const [quote, setQuote] = useState<ApiQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    try {
      const result = await adminApi.list<ApiProductListItem>(
        "admin/products?perPage=100&status=active",
      );
      setProducts(result.items);
    } catch {
      setError("Could not load products.");
    }
  }, []);

  useLoad(loadProducts);

  /**
   * Re-quote whenever the cart or the area changes.
   *
   * Debounced, because `areaText` is typed a character at a time and the zone is
   * inferred from it — quoting on every keystroke would be a request per letter
   * for a number that only matters once the address is finished.
   */
  useEffect(() => {
    const priceable = lines.filter((line) => line.quantity > 0);
    /* Nothing to price. The displayed quote is DERIVED from the cart below
       rather than cleared here — clearing it would be a setState in the effect
       body, and the emptiness is already knowable during render. */
    if (priceable.length === 0) return;

    /**
     * Which request this is.
     *
     * The debounce only cancels a timer that has not fired yet; a request
     * already in flight keeps going. So two changes far enough apart both send,
     * and if the FIRST reply arrives last it would overwrite the newer total —
     * leaving the desk reading a price for a cart that no longer exists. The
     * flag is closed over by this run of the effect and cleared by its cleanup,
     * so a superseded reply knows to stay quiet.
     */
    let current = true;

    const timer = setTimeout(() => {
      setQuoting(true);
      adminApi
        /* The quote comes back flat in `data`, not wrapped in `{ quote }` — the
           storefront's own quote endpoint answers the same way. */
        .post<ApiQuote>("admin/orders/quote", {
          items: priceable.map((line) => ({
            productId: line.productId,
            ...(line.variantId ? { variantId: line.variantId } : {}),
            quantity: line.quantity,
          })),
          ...(areaText.trim() ? { areaText: areaText.trim() } : {}),
        })
        .then((result) => {
          if (!current) return;
          setQuote(result);
          setError(null);
        })
        .catch((caught: unknown) => {
          if (!current) return;
          setQuote(null);
          setError(
            caught instanceof AdminApiError ? caught.message : PRICING_FAILED,
          );
        })
        .finally(() => {
          if (current) setQuoting(false);
        });
    }, 400);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [lines, areaText]);

  async function addLine(productId: string): Promise<void> {
    const product = products.find((candidate) => candidate.id === productId);
    if (!product) return;

    /* Fetched to find OUT whether it has options, not because we already know:
       the listing carries no variant information at all. Cached per product, so
       adding a second line of the same thing costs nothing. */
    let variantId: string | null = null;
    if (!detail[productId]) {
      if (fetchingDetail.current.has(productId)) return;
      fetchingDetail.current.add(productId);
      try {
        const full = await adminApi.get<{ product: ApiProduct }>(
          `admin/products/${productId}`,
        );
        setDetail((current) => ({ ...current, [productId]: full.product }));
        variantId = full.product.variants[0]?.id ?? null;
      } catch {
        setError("Could not load that product's options.");
        return;
      } finally {
        fetchingDetail.current.delete(productId);
      }
    } else {
      variantId = detail[productId]?.variants[0]?.id ?? null;
    }

    nextKey.current += 1;
    setLines((current) => [
      ...current,
      { key: `line-${nextKey.current}`, productId, variantId, quantity: 1 },
    ]);
  }

  function updateLine(index: number, patch: Partial<Line>): void {
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, ...patch } : line)),
    );
  }

  function removeLine(index: number): void {
    setLines((current) => current.filter((_, position) => position !== index));
  }

  /**
   * The total actually shown.
   *
   * Derived rather than stored: an emptied cart must not leave the previous
   * total sitting on screen next to a Create button, and deriving it is how that
   * becomes impossible instead of merely handled.
   */
  const hasPriceableLines = lines.some((line) => line.quantity > 0);
  const shownQuote = hasPriceableLines ? quote : null;

  /* A pricing error is about a cart. Empty the cart and the message no longer
     describes anything, so it is derived away rather than left on screen saying
     "could not price this cart" about a cart that is gone. */
  const shownError = hasPriceableLines ? error : (error === PRICING_FAILED ? null : error);

  const canSubmit =
    !saving &&
    !quoting &&
    shownQuote !== null &&
    customerName.trim().length >= 3 &&
    phone.trim().length >= 11 &&
    address.trim().length >= 8 &&
    areaText.trim().length >= 2 &&
    source.trim().length >= 2 &&
    lines.length > 0;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);

    try {
      const result = await adminApi.post<{ order: { orderNumber: string; id?: string } }>(
        "admin/orders",
        {
          customerName: customerName.trim(),
          phone: phone.trim(),
          address: address.trim(),
          areaText: areaText.trim(),
          items: lines.map((line) => ({
            productId: line.productId,
            ...(line.variantId ? { variantId: line.variantId } : {}),
            quantity: line.quantity,
          })),
          ...(customerNote.trim() ? { customerNote: customerNote.trim() } : {}),
          source: source.trim(),
          status,
        },
      );

      toast(`Order ${result.order.orderNumber} created`);
      /* Straight to the order it just made: the next thing the desk does is
         read it back to the customer or hand it to the courier. */
      router.push(`/admin/orders/${result.order.orderNumber}`);
    } catch (caught) {
      setError(
        caught instanceof AdminApiError ? caught.message : "Could not create the order.",
      );
      setSaving(false);
    }
  }

  return (
    <AdminShell title="New order">
      <PageBody>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <ErrorBanner message={shownError} />

          <Card>
            <CardHeader
              title="Where it came from"
              hint="Written down so the shop can tell a message order from a website one."
            />
            <div className="flex flex-col gap-4 p-4">
              <div>
                <Input
                  label="Source"
                  placeholder="WhatsApp"
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  required
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {SOURCE_SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setSource(suggestion)}
                      className="rounded-full border border-line px-2.5 py-1 text-micro text-ink-soft hover:bg-surface"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>

              <Select
                label="Start as"
                value={status}
                onChange={(event) => setStatus(event.target.value as "confirmed" | "pending")}
                hint="Confirmed, because the conversation already happened. Pending if you have not replied yet."
              >
                <option value="confirmed">Confirmed</option>
                <option value="pending">Pending — still needs a call</option>
              </Select>
            </div>
          </Card>

          <Card>
            <CardHeader title="Customer" />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Input
                label="Name"
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                required
              />
              <Input
                label="Phone"
                placeholder="01XXXXXXXXX"
                inputMode="numeric"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                required
              />
              <Textarea
                label="Address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                rows={2}
                required
                className="sm:col-span-2"
              />
              <Input
                label="Area"
                placeholder="Dhanmondi"
                value={areaText}
                onChange={(event) => setAreaText(event.target.value)}
                hint="The delivery zone and charge are worked out from this."
                required
              />
              <Input
                label="Note (optional)"
                value={customerNote}
                onChange={(event) => setCustomerNote(event.target.value)}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Items" hint="Prices come from the catalogue, as they do at checkout." />
            <div className="flex flex-col gap-3 p-4">
              {lines.length === 0 ? (
                <p className="rounded-sm bg-surface px-3 py-6 text-center text-caption text-muted">
                  No items yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {lines.map((line, index) => {
                    const product = products.find((p) => p.id === line.productId);
                    const variants = detail[line.productId]?.variants ?? [];

                    return (
                      <li
                        key={line.key}
                        className="flex flex-wrap items-end gap-3 rounded-sm border border-line p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-caption font-medium text-ink">
                            {product?.name ?? "—"}
                          </p>
                          <p className="text-micro text-muted">
                            {product ? formatTaka(product.price) : ""}
                            {product && ` · ${product.stockQuantity} in stock`}
                          </p>
                        </div>

                        {variants.length > 0 && (
                          <Select
                            label="Option"
                            value={line.variantId ?? ""}
                            onChange={(event) =>
                              updateLine(index, { variantId: event.target.value || null })
                            }
                          >
                            {variants.map((variant) => (
                              <option key={variant.id} value={variant.id}>
                                {Object.values(variant.options).join(" · ") || variant.sku}
                              </option>
                            ))}
                          </Select>
                        )}

                        <Input
                          label="Qty"
                          type="number"
                          min={1}
                          value={String(line.quantity)}
                          onChange={(event) =>
                            updateLine(index, {
                              quantity: Math.max(1, Number(event.target.value) || 1),
                            })
                          }
                          className="w-20"
                        />

                        <button
                          type="button"
                          onClick={() => removeLine(index)}
                          aria-label="Remove item"
                          className="flex size-8 items-center justify-center rounded-xs text-muted hover:bg-sale-soft hover:text-sale"
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <Select
                label="Add a product"
                value=""
                onChange={(event) => {
                  if (event.target.value) void addLine(event.target.value);
                }}
              >
                <option value="">Choose…</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} — {formatTaka(product.price)}
                    {product.stockQuantity === 0 ? " (out of stock)" : ""}
                  </option>
                ))}
              </Select>
            </div>
          </Card>

          <Card>
            <CardHeader title="Total" hint="Worked out by the server, not by this page." />
            <div className="flex flex-col gap-2 p-4 text-caption">
              {quoting ? (
                <p className="text-muted">Pricing…</p>
              ) : shownQuote ? (
                <>
                  <Row label="Subtotal" value={formatTaka(shownQuote.subtotal)} />
                  <Row
                    label={
                      shownQuote.deliveryZone === "inside_dhaka"
                        ? "Delivery — inside Dhaka"
                        : shownQuote.deliveryZone === "outside_dhaka"
                          ? "Delivery — outside Dhaka"
                          : "Delivery"
                    }
                    value={formatTaka(shownQuote.deliveryCharge)}
                  />
                  <div className="mt-1 flex items-center justify-between border-t border-line pt-2 text-body font-semibold text-ink">
                    <span>Total</span>
                    <span className="tnum">{formatTaka(shownQuote.grandTotal)}</span>
                  </div>
                  {/* Said out loud, because the zone decides the charge and a
                      guess from a typo would be charged to a real customer. */}
                  {shownQuote.zoneInferred && (
                    <p className="text-micro text-muted">
                      Zone worked out from the area you typed
                      {shownQuote.zoneMatchedOn ? ` (“${shownQuote.zoneMatchedOn}”)` : ""}.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-muted">Add an item and an area to see the total.</p>
              )}
            </div>
          </Card>

          <div className="sticky bottom-20 z-10 flex gap-2 rounded-md border border-line bg-white/95 p-3 shadow-card backdrop-blur-md lg:bottom-4">
            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={saving}
              disabled={!canSubmit}
            >
              {saving ? "Creating…" : "Create order"}
            </Button>
          </div>
        </form>
      </PageBody>
    </AdminShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-ink-soft">
      <span>{label}</span>
      <span className="tnum">{value}</span>
    </div>
  );
}
