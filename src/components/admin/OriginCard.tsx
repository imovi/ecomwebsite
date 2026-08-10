"use client";

import { useState } from "react";
import Link from "next/link";
import type { ApiOrderDetail } from "@/lib/api/types";
import { adminApi } from "@/lib/admin/client";
import { formatTaka } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Card, CardHeader } from "@/components/admin/ui";

/**
 * Where an order came from, what else came from there, and the block.
 *
 * THE NUMBER THAT MATTERS IS THE PHONE COUNT, NOT THE ORDER COUNT
 * ---------------------------------------------------------------
 * Bangladesh's mobile carriers run carrier-grade NAT: Grameenphone, Robi and
 * Banglalink put hundreds of real customers behind a handful of public
 * addresses. So "6 orders from this address" is not evidence of anything on its
 * own. Six orders from six different phone numbers is an ordinary tower. Six
 * orders from one number is somebody gaming the shop.
 *
 * That distinction is written out as a sentence rather than left as two
 * statistics side by side, and it is repeated inside the block dialog — because
 * the moment of decision is the only place a warning actually changes anyone's
 * mind. It is the one thing standing between a fair fraud block and cutting off
 * a district mid-campaign.
 *
 * Split into its own file rather than added to `OrderDetail.tsx`, which is
 * already near the size limit this project sets for a single file.
 */

type Mutate = (action: () => Promise<unknown>, message: string) => Promise<boolean>;

export function OriginCard({
  order,
  busy,
  mutate,
}: {
  order: ApiOrderDetail;
  busy: boolean;
  mutate: Mutate;
}) {
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("7");

  const ip = order.customerIp;

  /* Orders placed before the storefront began forwarding the shopper's address
     have none. Nothing to show, and nothing to block. */
  if (!ip) {
    return (
      <Card>
        <CardHeader title="Origin" />
        <p className="p-4 text-caption text-muted">No address was recorded for this order.</p>
      </Card>
    );
  }

  const sameIp = order.sameIp;
  const shared = sameIp !== null && sameIp.total > 0;

  /* Every order from a different number is the signature of a shared carrier
     address, not of one person ordering repeatedly. */
  const looksShared = shared && sameIp.distinctPhones >= sameIp.total;

  const blocked = order.blocked;

  return (
    <Card>
      <CardHeader title="Origin" />
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="tnum text-body font-medium text-ink">{ip}</span>
          {blocked && (
            <span className="rounded-sm bg-sale-soft px-2 py-0.5 text-micro font-medium text-sale">
              Blocked
            </span>
          )}
        </div>

        {shared ? (
          <>
            <p className="text-caption text-ink-soft">
              <strong className="text-ink">
                {sameIp.total} other {sameIp.total === 1 ? "order" : "orders"}
              </strong>{" "}
              from this address, from{" "}
              <strong className="text-ink">
                {sameIp.distinctPhones} different{" "}
                {sameIp.distinctPhones === 1 ? "number" : "numbers"}
              </strong>
              .{" "}
              {looksShared
                ? "A different number each time is normal on a shared mobile network — most of Bangladesh is behind one."
                : "Repeat orders from the same number at one address are worth a closer look."}
            </p>

            <ul className="divide-y divide-line rounded-sm border border-line">
              {sameIp.recent.map((row) => (
                <li key={row.orderNumber}>
                  <Link
                    href={`/admin/orders/${row.orderNumber}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 hover:bg-surface"
                  >
                    <span className="text-caption font-medium text-ink">{row.orderNumber}</span>
                    <span className="text-caption text-ink-soft">{row.customerName}</span>
                    <span className="tnum text-caption text-muted">{row.phone}</span>
                    <span className="text-micro text-muted">{row.status}</span>
                    <span className="tnum text-caption text-ink">{formatTaka(row.grandTotal)}</span>
                  </Link>
                </li>
              ))}
            </ul>

            <Link
              href={`/admin/orders?customerIp=${encodeURIComponent(ip)}`}
              className="self-start text-caption text-muted underline underline-offset-4 hover:text-ink"
            >
              See every order from this address
            </Link>
          </>
        ) : (
          <p className="text-caption text-muted">No other orders have come from this address.</p>
        )}

        {blocked ? (
          <div className="flex flex-col gap-2 rounded-sm bg-surface p-3">
            <p className="text-caption text-ink-soft">
              Orders from this address are being refused
              {blocked.reason ? ` — ${blocked.reason}` : ""}.
            </p>
            <Button
              type="button"
              variant="soft"
              size="sm"
              className="self-start"
              disabled={busy}
              onClick={() => {
                void mutate(() => adminApi.delete(`admin/ips/${blocked.id}`), "Address unblocked");
              }}
            >
              Unblock this address
            </Button>
          </div>
        ) : blocking ? (
          <div className="flex flex-col gap-3 rounded-sm bg-surface p-3">
            {looksShared && (
              <p className="rounded-sm bg-sale-soft px-3 py-2 text-caption text-sale">
                Careful — the orders from this address come from different phone numbers, which
                usually means a shared mobile network. Blocking it may stop real customers who have
                done nothing.
              </p>
            )}

            <Input
              label="Reason"
              placeholder="e.g. four fake orders, same number"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />

            <label className="flex flex-col gap-1">
              <span className="text-caption text-ink-soft">Block for</span>
              <select
                value={days}
                onChange={(event) => setDays(event.target.value)}
                className="rounded-sm border border-line bg-white px-3 py-2 text-caption text-ink"
              >
                {/* Seven days first, and it is the default. A block that heals
                    itself is the difference between a mistake and an outage. */}
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="permanent">Permanently</option>
              </select>
            </label>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  void mutate(
                    () =>
                      adminApi.post("admin/ips", {
                        ip,
                        reason: reason.trim(),
                        expiresInDays: days === "permanent" ? null : Number(days),
                      }),
                    "Address blocked",
                  ).then((ok) => {
                    if (ok) setBlocking(false);
                  });
                }}
              >
                Block this address
              </Button>
              <Button type="button" variant="soft" size="sm" onClick={() => setBlocking(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="soft"
            size="sm"
            className="self-start"
            onClick={() => setBlocking(true)}
          >
            Block this address
          </Button>
        )}
      </div>
    </Card>
  );
}
