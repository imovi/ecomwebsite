# Order Management module (Phase 3)

Guest checkout, cash on delivery, and the admin order desk for a Bangladeshi
gadget store.

Built on Phases 1 and 2. Existing modules were touched in four additive places
only: mounting the new routers in `routes/v1.ts`, re-exporting the new tables
from `db/schema/index.ts`, adding order relations to `db/schema/relations.ts`,
and adding configurable checkout rate limits to `config/`.

---

## Database schema

Four new tables. Money is an **integer number of taka** throughout.

### `store_settings` — one row

Delivery charges must be configurable, and invoices need the store's own
details. Both live here.

| Column | Notes |
|---|---|
| `id` | `smallint`, `CHECK (id = 1)` — "single row" is a database guarantee |
| `delivery_charge_inside_dhaka` | default 80 |
| `delivery_charge_outside_dhaka` | default 130 |
| `free_delivery_threshold` | 0 disables the rule |
| `minimum_order_value` | 0 disables the rule |
| `max_quantity_per_item` | blunts joke orders on a COD store |
| `store_name` / `phone` / `email` / `address` / `invoice_footer` | invoice header |

A typed single row rather than a key/value table: every consumer wants the
whole set at once, and a typed row makes a missing setting a compile error
instead of an `undefined` that surfaces as a zero delivery charge in
production.

### `orders`

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `order_number` | `GNG-10042`, unique case-insensitively, from a **sequence** |
| `customer_name`, `phone`, `address`, `area_text` | denormalised — there are no accounts |
| `delivery_zone` | `inside_dhaka` \| `outside_dhaka`; **stored**, never re-derived on read |
| `subtotal`, `delivery_charge`, `grand_total` | all persisted |
| `item_count`, `total_quantity` | denormalised so the list needs no join |
| `payment_method` | enum, `cod` today |
| `status` | 8-state enum, below |
| `internal_notes`, `cancellation_reason` | staff only |
| `version` | optimistic concurrency token |
| `idempotency_key` | partial-unique where not null |
| `customer_ip`, `user_agent` | forensics on refused COD parcels |
| `confirmed_at` … `returned_at` | stamped per transition |

Two CHECK constraints enforce arithmetic at the write:

```sql
grand_total = subtotal + delivery_charge
subtotal >= 0 AND delivery_charge >= 0 AND grand_total >= 0
```

Cheap insurance that catches a totals bug at the statement rather than in a
month-end report.

**Why a sequence for order numbers.** `nextval` is atomic and lock-free.
`max(order_number) + 1` races two concurrent checkouts into the same number,
and the unique index then fails one of them at random. Sequences are not
transactional, so a rolled-back order burns a number — a gap is cosmetic, a
duplicate order number is a support incident.

### `order_items` — the snapshot rule

Every field an invoice needs is **copied at order time**: name, slug, SKU,
variant label, unit price, image key. The FKs to `products` and
`product_variants` exist for stock adjustment and reporting — they are *not*
the source of display data, and both are `ON DELETE SET NULL`.

This is the most important property in the module. Renaming a product,
repricing it, or deleting it must never change what a past order says it was or
what the customer agreed to pay. Joining to `products` at read time would
silently rewrite history the first time someone ran a sale.

```sql
CHECK (quantity > 0)
CHECK (unit_price >= 0)
CHECK (line_total = unit_price * quantity)
```

### `order_events` — the immutable audit log

| Column | Notes |
|---|---|
| `seq` | `bigserial` — **the ordering key** |
| `type` | enum: `order_created`, `status_changed`, `customer_updated`, `phone_updated`, `address_updated`, `quantity_updated`, `variant_updated`, `delivery_charge_updated`, `totals_recalculated`, `note_added`, `order_cancelled`, `order_delivered`, `order_returned`, `item_removed` |
| `field` | dotted path, e.g. `customer.phone` |
| `previous_value`, `new_value` | `jsonb` — one shape covers a status string, an integer, a money amount and an address object |
| `admin_id` | `ON DELETE RESTRICT` — an audit entry never loses its author |
| `actor_name` | snapshot, so the log reads correctly forever |
| `note` | optional operator context |
| `created_at` | `clock_timestamp()`, for display |

The repository exposes **no update and no delete**. A correction is a new
event, never an edit of an old one — an audit trail that can be rewritten is
not an audit trail. A test asserts no endpoint exists to modify or remove one.

**Ordering is by `seq`, not by time.** One edit writes several events inside a
single transaction. `now()` returns the *transaction start* time, so every one
of them would share a timestamp and the log would have no defined order —
"address changed" could render after the recalculation it caused.
`clock_timestamp()` advances within a transaction but still collides at
microsecond resolution under a fast writer. A `bigserial` is immune to both,
and to clock adjustments. `created_at` remains for display.

---

## Relationships

```
orders        1 ──── n order_items      CASCADE
orders        1 ──── n order_events     CASCADE
order_items   n ──── 1 products         SET NULL   (deleting a product must not
order_items   n ──── 1 product_variants SET NULL    delete the orders in it)
order_events  n ──── 1 admins           RESTRICT   (audit keeps its author)
```

Declared to Drizzle in `db/schema/relations.ts`, which is what lets an order
detail — header, items and timeline — be one statement rather than three.

---

## Order lifecycle

```
pending ──► confirmed ──► processing ──► packed ──► shipped ──► delivered
   │            │              │            │           │            │
   └────────────┴──────────────┴────────────┘           │            │
                    cancelled                           └──► returned ◄┘
```

The transition table (`ORDER_STATUS_TRANSITIONS`) is the authority; an illegal
move is a 409 that names what *is* allowed. Notable edges:

- **Cancellation is possible up to and including `packed`.** Once `shipped`,
  the parcel is with the courier and the only failure path is `returned`.
- **`delivered` can still become `returned`** — a customer can send an item
  back after a successful delivery.
- `cancelled` and `returned` are terminal.

### Side effects per transition

| Transition | Effect |
|---|---|
| → `cancelled` | reserved stock returns to the catalogue |
| → `returned` | stock returns **and** the recorded sale is reversed |
| → `delivered` | `recordProductSale()` per line — the Phase 2 metrics seam |

Revenue on a cash-on-delivery store is recognised at **delivery**, not at
placement. That is what makes Best Selling and Trending reflect money actually
collected rather than orders that were later refused.

Editing is blocked once an order reaches `shipped`, `delivered` or `returned`.

---

## Stock handling

All of it lives in `stock.service.ts` and every function requires a transaction
executor. Three invariants, enforced by construction:

**1. Stock can never go negative.** Decrements are a single conditional UPDATE:

```sql
UPDATE product_variants
SET stock_quantity = stock_quantity - $qty
WHERE id = $id AND stock_quantity >= $qty
RETURNING id
```

Zero rows back means insufficient stock. A read-then-check in application code
loses to two concurrent checkouts: both read 1, both decide it is fine, both
write 0, and the store has sold the same phone twice.

**2. Deadlocks are avoided by lock ordering.** Two orders containing the same
two products in opposite order deadlock if each locks in payload order. Every
batch is sorted by id first, so all transactions acquire row locks in the same
sequence.

**3. The denormalised product total stays in step.** `products.stock_quantity`
is the sum of active variants (Phase 2 keeps it that way so listing queries
need no aggregate join). Any variant movement re-derives it in the same
transaction.

Two ordering decisions that matter:

- A quantity change applies a **delta**, not release-then-reserve. An increase
  that cannot be satisfied fails without first having handed the original units
  back.
- A variant swap **reserves the new variant first**. If it cannot be satisfied
  the transaction rolls back and the customer keeps the variant they had — the
  reverse order would release the original units and then fail, leaving the
  order holding nothing.

---

## Delivery charge

`lib/geo/delivery-zone.ts` resolves a zone from free-typed area text. It is
**not** `text.includes("dhaka")`, which is wrong in both directions:

| Input | Naive result | Correct |
|---|---|---|
| `Dhanmondi`, `Mirpur 10`, `Uttara Sector 7` | no match | **inside** |
| `Savar, Dhaka`, `Keraniganj, Dhaka`, `Tongi, Gazipur` | inside | **outside** |

So the check order is: outside-overrides → inside-Dhaka areas → districts →
bare "dhaka" (low confidence). Bangla script and common misspellings are
mapped.

Inference only ever **suggests**. An explicit `deliveryZone` always wins, and
placing an order with an unrecognised area and no explicit zone is a 422 rather
than a guess — silently defaulting to "inside Dhaka" undercharges every rural
order.

The charge itself comes from `store_settings` on every quote and every
recalculation, so an operator's change takes effect on the next order rather
than after a deploy.

---

## Admin order editing

| Edit | Recalculates |
|---|---|
| Name, phone, address | nothing — applied immediately |
| Area / thana / district | zone → **delivery charge → grand total** |
| Quantity | **stock → subtotal → delivery charge → grand total** |
| Variant | **old variant stock restored, new reserved**, price follows the new variant, then subtotal → total |
| Internal notes | nothing |

Delivery charge is recomputed on a quantity change too, because a
free-delivery threshold means the charge can move when the subtotal does.

**Totals are recomputed, never patched.** `recalculateOrderTotals` re-aggregates
the items inside a single UPDATE using correlated subqueries. No code path
adjusts a total by a delta, so an arithmetic slip cannot accumulate — and the
CHECK constraint catches it if one ever did.

It is written through Drizzle's query builder rather than a raw
`execute(sql\`…\`)` deliberately: a raw execute returns driver rows with
snake_case keys and no type mapping, so `row.grandTotal` is `undefined`. That
produced audit entries recording a **null new value** while the API response —
re-read from the database — looked perfectly correct. A regression test asserts
the audited total matches the order.

**Every edit writes one audit entry per changed field**, inside the same
transaction as the change. If the event insert fails, the change rolls back
with it. A no-op edit writes nothing, keeping the log free of noise.

### Concurrency

`orders.version` is an optimistic concurrency token. Send `expectedVersion`
with any edit; a mismatch is a **409** rather than a silent overwrite. Two
operators editing the same order during a confirmation call is routine, and
without this the second save discards the first.

---

## API endpoints

### Public — `/api/v1/checkout`

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/checkout/quote` | Price a cart; returns the inferred zone |
| `POST` | `/checkout/order` | Place an order |
| `GET` | `/checkout/areas?q=` | Area autocomplete |

`POST /checkout/order` accepts an **`Idempotency-Key` header**. A replay
returns the original order with `200` and `replayed: true` instead of creating
a second — a flaky mobile connection retrying the POST must not produce two
orders.

There is deliberately **no public order-lookup endpoint**. Order numbers are
sequential and an order record holds a name, a phone number and a home address;
exposing lookup would turn a guessable identifier into a customer-data leak.

### Admin — `/api/v1/admin/orders` (authenticated, `manager`+)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | List, search, filter, paginate |
| `GET` | `/status-counts` | Badge numbers for the status tabs |
| `GET` | `/:identifier` | Detail by uuid or order number |
| `GET` | `/:id/timeline` | The audit log on its own |
| `GET` | `/:identifier/invoice` | `?format=json\|html` |
| `PATCH` | `/:id/customer` | Name, phone, address, area, zone |
| `PATCH` | `/:id/items/:itemId/quantity` | Quantity |
| `PATCH` | `/:id/items/:itemId/variant` | Variant |
| `PATCH` | `/:id/status` | Status transition |
| `POST` | `/:id/cancel` | Cancel — reason required |
| `PATCH` | `/:id/notes` | Internal notes |

Name, phone, address and area share one endpoint because they are edited
together during a confirmation call; four endpoints would mean four requests,
four version bumps and four chances to half-apply a correction. Each changed
field still gets its own audit entry.

### Settings — `/api/v1/admin/settings`

`GET` requires `manager`; `PATCH` requires `admin` — changing what the store
charges for delivery is a commercial decision, not queue work.

### Query parameters — `GET /admin/orders`

| Parameter | Notes |
|---|---|
| `page`, `perPage` | `perPage` capped at 100 |
| `q` | order number, phone, or customer-name prefix |
| `status` | `pending,confirmed` or repeated keys |
| `paymentMethod`, `deliveryZone` | |
| `dateFrom`, `dateTo` | ISO date or datetime; a bare `dateTo` covers the **whole day** |
| `minTotal`, `maxTotal` | |
| `sort` | `newest` (default), `oldest`, `total_desc`, `total_asc` |

Search routes each input shape to an index: order number → unique index, digits
→ phone index, anything else → `lower(customer_name)` with `text_pattern_ops`
for prefix matching. LIKE metacharacters in the term are escaped, so a customer
named `100%` cannot turn the search into a full scan.

---

## Validation rules

### Checkout

| Field | Rule |
|---|---|
| `customerName` | 3–120 chars |
| `phone` | accepts `01712345678`, `+8801712345678`, `8801712345678`, spaces/dashes → **normalised to `01XXXXXXXXX`**; must match `^01[3-9]\d{8}$` |
| `address` | 8–500 chars |
| `areaText` | 2–200 chars |
| `deliveryZone` | optional; inferred from `areaText`, 422 if neither resolves |
| `items` | 1–50 lines; duplicates rejected |
| `items[].quantity` | 1–1000, and ≤ `max_quantity_per_item` |

**No price field exists on the request.** `.strict()` rejects `price`,
`subtotal`, `deliveryCharge` and `grandTotal` outright — the only public write
in the API cannot be told what to charge.

Product-level checks: the product must exist, be `active` and visible; a
product with variants requires a `variantId` belonging to it and active; a
product without variants must not be sent one; `discontinued` is refused.

### Admin edits

All bodies are `.strict()`; an empty PATCH is a 422. `expectedVersion` is
optional but should always be sent by a UI. Cancellation requires a reason —
on a COD store it is the only thing separating "customer changed their mind"
from "suspected fake order" when the numbers are reviewed.

---

## Invoice

Built from the **current** order row on every request. There is no stored
invoice document and no snapshot of one — the requirement is that an invoice
always reflects the latest edits, and the only way to guarantee that is to have
nothing else to fall out of date.

Line prices are still the prices captured at order time, because those live on
`order_items`. Repricing a product today does not change what a past invoice
says the customer owes.

`?format=html` returns a self-contained printable document — inline CSS, print
stylesheet, auto-print on load (`?autoprint=0` suppresses it). All customer
text is HTML-escaped; a test asserts a `<script>` in a customer name comes out
inert.

The order number **is** the invoice number. A separate sequence would mean two
identifiers for one transaction and a support call every time they were quoted
interchangeably.

---

## Notification hooks

`lib/events/order-events.ts` — a typed emitter with three events and **no
transports**, which were out of scope for this phase.

```ts
orderEvents.on("order.created",          (e) => { … });
orderEvents.on("order.status_changed",   (e) => { … });
orderEvents.on("order.customer_updated", (e) => { … });
```

Three properties:

- **Typed payloads** — a subscriber cannot read a field the emitter never sends.
- **Emitted after commit, never inside a transaction** — an SMS must not go out
  for an order that then rolls back, and a handler must not hold a transaction
  open.
- **Handler failures are contained** — a broken provider is logged and
  swallowed. A test asserts a throwing subscriber does not fail checkout.

Adding SMS later touches only a new subscriber file.

---

## Analytics readiness

Not implemented, as required. The schema supports it without migration:

- `orders.delivered_at` with a **partial index** `WHERE status = 'delivered'` —
  daily and monthly sales group on exactly this.
- `orders.grand_total`, `subtotal`, `delivery_charge` all persisted.
- `order_items.product_id` indexed — units per product.
- Best-selling already flows through `product_metrics.units_sold`, fed by
  `recordProductSale()` on delivery.

---

## Performance

| Concern | Approach |
|---|---|
| Order list | **One** statement: filters + `count(*) over()` for the total, no separate COUNT |
| Order detail | **One** statement — Drizzle relations compile `with` into lateral joins |
| Search | Each input shape routed to an index; LIKE metacharacters escaped |
| Totals | Recomputed in SQL, not fetched and re-added in JavaScript |
| Status tabs | One `GROUP BY`, not eight COUNTs |
| Stock | Conditional UPDATE — no SELECT-then-UPDATE round trip, no row locks held across statements |
| Concurrency | `version` column; deadlock-safe lock ordering |
| Page size | Capped at 100 |

---

## Testing

```bash
npm test          # 175 tests: 26 auth + 78 catalog + 71 orders
npm run verify    # typecheck + lint + test
npm run smoke     # end-to-end against a RUNNING server (see below)
```

`npm run smoke` drives the flow over real HTTP against the **compiled build** —
place an order as a guest, edit it as an admin, then assert the audit log,
totals, stock and invoice all moved correctly. The integration suite covers far
more; this proves the built and deployed artefact behaves, not just the sources
under the test runner.

```bash
npm run build && npm run db:migrate && npm run db:seed
node --env-file-if-exists=.env dist/server.js &
npm run smoke
```

`tests/orders.test.ts` runs the real stack — real HTTP, real Postgres, real
transactions. Coverage includes every endpoint above, plus: price tampering
rejected, phone normalisation across four formats, zone inference including the
`Savar, Dhaka` trap, idempotent replay decrementing stock once, a whole order
rolling back when one line is short, stock restored on cancel, sale recorded on
delivery and reversed on return, a refused cancellation leaving no cancellation
reason behind, stale-version writes rejected, edits blocked after shipment,
audit entries never collapsed or rewritten, a recalculation never logging a
null new value, the audit order being stable and causally correct, an invoice
reflecting later edits, HTML escaping of customer input, and a throwing event
subscriber not breaking checkout.

---

## Known limitations

- **Rate-limit store is per-process memory.** The effective checkout limit
  multiplies by the replica count. Swap in `rate-limit-redis` before scaling
  horizontally — one `store` option in `order.routes.ts`.
- **No partial refunds or line removal.** An order can be cancelled or
  returned in full; removing a single line from a multi-line order is not
  modelled. The `item_removed` event type exists for when it is.
- **`internal_notes` is a single text field**, not threaded comments. Changes
  are audited, but two operators editing it concurrently rely on
  `expectedVersion` rather than merging.
- **No courier integration.** `shipped` is a status, not a consignment.
