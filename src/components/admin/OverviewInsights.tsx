"use client";

import Link from "next/link";
import { formatTaka } from "@/lib/utils";
import type { ApiOverview } from "@/lib/api/types";
import { Card, CardHeader } from "./ui";

/**
 * The three things on the dashboard that are about risk rather than takings:
 * what is about to run out, which courier loses parcels, and who sends them
 * back.
 *
 * Split out of `Overview` on a real seam. That file answers "how is the shop
 * doing"; this one answers "what is going to go wrong", and keeping them
 * together made one screen-sized component nobody could read.
 *
 * EVERY CARD HERE HAS A HONEST EMPTY STATE
 * ----------------------------------------
 * This shop has barely used a courier and has had almost no returns, so most
 * of these will be empty for a while. An empty card that says why is worth
 * having; one that draws a plausible-looking zero, or a percentage bar at some
 * default, teaches a shop to read numbers that were never measured. Each one
 * says what it is waiting for.
 */

export function OverviewInsights({ overview }: { overview: ApiOverview }) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <StockForecast rows={overview.stock} />
      <CourierComparison rows={overview.couriers} />
      <ReturnWatchlist rows={overview.returnRisk} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * What is running out, and roughly when.
 *
 * The count of what is left is on the products page already. What a dashboard
 * adds is the rate: four units is a fortnight for one product and this
 * afternoon for another, and only the second is worth interrupting anyone
 * about. A product with no recent sales gets no forecast rather than a
 * reassuring large number — no rate means no answer.
 */
function StockForecast({ rows }: { rows: ApiOverview["stock"] }) {
  return (
    <Card>
      <CardHeader
        title="Running out"
        hint="Stock right now, against the last fortnight's sales."
      />

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-caption text-muted">
          Nothing is near its reorder level.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((row) => {
            const urgent =
              row.stockQuantity === 0 ||
              (row.daysLeft !== null && row.daysLeft <= 3);

            return (
              <li
                key={row.productId}
                className="flex items-start justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/admin/products/${row.productId}`}
                    className="block truncate text-caption font-medium text-ink hover:underline"
                  >
                    {row.name}
                  </Link>
                  <p
                    className={`text-micro ${urgent ? "text-sale" : "text-muted"}`}
                  >
                    {row.stockQuantity === 0
                      ? "Out of stock — still taking orders"
                      : row.daysLeft === null
                        ? `${row.stockQuantity} left · none sold in a fortnight, so no forecast`
                        : `${row.stockQuantity} left · about ${dayCount(row.daysLeft)} at the current rate`}
                  </p>
                </div>

                <span
                  className={`tnum shrink-0 rounded-xs px-1.5 py-0.5 text-micro font-medium ${
                    urgent ? "bg-sale-soft text-sale" : "bg-warn-soft text-warn"
                  }`}
                >
                  {row.stockQuantity}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function dayCount(days: number): string {
  if (days === 0) return "gone today";
  return days === 1 ? "1 day" : `${days} days`;
}

/* -------------------------------------------------------------------------- */

/**
 * Which courier actually delivers.
 *
 * On cash on delivery a returned parcel costs both ways, so a courier five
 * points worse at delivering is not a rounding difference — it is the shipping
 * bill twice on one order in twenty. Worth knowing before the shop signs up to
 * one of them by habit.
 *
 * A rate needs a denominator, and a percentage from three parcels is noise
 * dressed as a measurement. Below the threshold the count is shown instead.
 */
const ENOUGH_PARCELS = 10;

function CourierComparison({ rows }: { rows: ApiOverview["couriers"] }) {
  return (
    <Card>
      <CardHeader
        title="Courier record"
        hint="Parcels that finished in this range."
      />

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-caption text-muted">
          No parcel has finished with a courier in this range. Once you start
          booking through Pathao or Steadfast, their delivery rates get compared
          here.
        </p>
      ) : (
        <ul className="flex flex-col gap-3 p-4">
          {rows.map((row) => {
            const rate =
              row.settled > 0
                ? Math.round((row.delivered / row.settled) * 100)
                : 0;
            const enough = row.settled >= ENOUGH_PARCELS;

            return (
              <li key={row.provider}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-caption capitalize text-ink">
                    {row.provider}
                  </span>
                  <span className="tnum shrink-0 text-micro text-muted">
                    {enough ? `${rate}%` : `${row.delivered} of ${row.settled}`}
                    {row.averageDays !== null && ` · ${row.averageDays} days`}
                  </span>
                </div>

                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface">
                  <div
                    className={
                      rate >= 90 ? "h-full bg-positive" : "h-full bg-warn"
                    }
                    style={{ width: `${rate}%` }}
                  />
                </div>

                {!enough && (
                  <p className="mt-1 text-micro text-muted">
                    Too few parcels to call this a rate yet.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Numbers that have refused delivery more than once.
 *
 * From this shop's own orders, not from the couriers. The Fraud screen asks the
 * couriers what a number's nationwide record looks like — the better question,
 * and one that needs courier logins entered first. This needs nothing, and a
 * customer who has already cost this shop two round trips is worth a call
 * before the third parcel goes out.
 *
 * Deliberately not a block button. Refusing a delivery twice is not proof of
 * anything, and a dashboard that lets somebody ban a phone number in one tap
 * from a two-line summary will eventually ban a real customer whose road was
 * flooded. The link goes to their orders, where the history is.
 */
function ReturnWatchlist({ rows }: { rows: ApiOverview["returnRisk"] }) {
  return (
    <Card>
      <CardHeader
        title="Sends parcels back"
        hint="Two or more refusals, all time."
      />

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-caption text-muted">
          No customer has refused delivery twice. This fills itself in as
          returns happen.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((row) => (
            <li
              key={row.phone}
              className="flex items-start justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-caption font-medium text-ink">
                  {row.name || "No name recorded"}
                </p>
                {/* The phone is the identity on a cash-on-delivery shop, so it
                    is what the desk searches the order list by. */}
                <Link
                  href={`/admin/orders?q=${encodeURIComponent(row.phone)}`}
                  className="tnum text-micro text-muted hover:underline"
                >
                  {row.phone} · see their orders
                </Link>
              </div>

              <span className="shrink-0 rounded-xs bg-sale-soft px-1.5 py-0.5 text-micro font-medium text-sale">
                {row.returned} of {row.settled} back
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Cash the couriers are holding.
 *
 * WHAT THIS DELIBERATELY DOES NOT CLAIM
 * -------------------------------------
 * The design asked for "money delivered that has not reached the bank yet".
 * Neither courier reports settlements to us and nothing here records a payout
 * arriving, so that figure cannot be produced — and producing it anyway, by
 * assuming a weekly cycle, would give the shop a precise-looking number to
 * reconcile its accounts against. So this reports the two facts that ARE
 * written on each parcel and says which is which.
 */
export function CourierCash({
  rows,
}: {
  rows: NonNullable<ApiOverview["money"]>["courierCash"];
}) {
  const out = rows.reduce((sum, row) => sum + row.inParcels, 0);
  const collected = rows.reduce((sum, row) => sum + row.recentlyCollected, 0);

  return (
    <Card>
      <CardHeader
        title="Cash with the couriers"
        hint="From the amount written on each parcel. Right now, not over the range."
      />

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-caption text-muted">
          No parcel has been handed to a courier yet.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 p-4">
            <div>
              <p className="text-micro uppercase tracking-wide text-muted">
                Still out
              </p>
              <p className="tnum mt-1 text-[22px] font-semibold text-ink">
                {formatTaka(out)}
              </p>
              <p className="mt-0.5 text-micro text-muted">
                Not collected from anybody yet.
              </p>
            </div>
            <div>
              <p className="text-micro uppercase tracking-wide text-muted">
                Collected recently
              </p>
              <p className="tnum mt-1 text-[22px] font-semibold text-ink">
                {formatTaka(collected)}
              </p>
              <p className="mt-0.5 text-micro text-muted">
                Delivered in the last fortnight.
              </p>
            </div>
          </div>

          <ul className="flex flex-col gap-1 border-t border-line px-4 py-3">
            {rows.map((row) => (
              <li
                key={row.provider}
                className="flex items-baseline justify-between gap-2 text-micro"
              >
                <span className="capitalize text-ink-soft">{row.provider}</span>
                <span className="tnum text-muted">
                  {formatTaka(row.inParcels)} out ·{" "}
                  {formatTaka(row.recentlyCollected)} collected
                </span>
              </li>
            ))}
          </ul>

          <p className="border-t border-line px-4 py-3 text-micro text-muted">
            Whether a payout has reached your bank is not something the couriers
            tell this system. Check the figures above against your own
            statements.
          </p>
        </>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Where the orders come from, and how many come back.
 *
 * The source is written down when an order is typed in by hand; a blank one is
 * the storefront doing its job unaided. Worth a place on the first screen
 * because it is the only answer to "is answering messages worth the time".
 */
export function SourcesCard({
  sources,
  returns,
}: {
  sources: ApiOverview["sources"];
  returns: ApiOverview["returns"];
}) {
  const total = sources.reduce((sum, row) => sum + row.orders, 0);

  /* A rate needs a denominator. Nothing settled means no rate exists — not
     zero percent, which would read as "nothing came back" in a range where
     nothing finished either. */
  const returnRate =
    returns.settled > 0
      ? Math.round((returns.returned / returns.settled) * 100)
      : null;

  return (
    <Card>
      <CardHeader title="Where orders come from" />

      {total === 0 ? (
        <p className="px-4 py-6 text-center text-caption text-muted">
          No orders in this range.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5 p-4">
          {sources.map((row) => {
            const share = Math.round((row.orders / total) * 100);
            return (
              <li key={row.source ?? "storefront"}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-caption text-ink">
                    {row.source ?? "Website checkout"}
                  </span>
                  <span className="tnum shrink-0 text-micro text-muted">
                    {row.orders} · {share}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface">
                  <div
                    className={
                      row.source ? "h-full bg-warn" : "h-full bg-ink-soft"
                    }
                    style={{ width: `${share}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="border-t border-line px-4 py-3 text-micro text-muted">
        {returnRate === null
          ? "Nothing finished delivering in this range, so there is no return rate yet."
          : `${returnRate}% came back — ${returns.returned} returned of ${returns.settled} finished.`}
      </p>
    </Card>
  );
}
