# Plan — the counter system, and finding rows without reading the whole book

Two things were asked for. One of them is already built and working; the other
has a real gap in it that nothing would show you today.

Everything below is measured on the live server, not guessed.

---

## Part 1 — the bank counter system

### It already exists, and it already works that way

The counters are `pg.Pool` in `backend/src/db/client.ts:60`. Twenty of them in
production. A request that arrives when all twenty are busy does not open a
twenty-first — it waits for one to free up, then takes it. A finished request
hands its counter back.

Measured on the live server:

```
100 requests at once  →  peak connections: 20, never 21
                         100 of 100 answered 200
                         2.5 seconds for all of them
samples: 0 0 0 20 20 20 20 20 ... 20
300 requests at once  →  300 of 300 answered 200
```

At rest the API holds **zero** connections — idle counters close after 30
seconds and reopen on demand.

| | |
|---|---|
| Counters | 20 |
| What Postgres allows | 100 |
| Headroom | 5× |

**So there is nothing to build here.** What follows is the part that is missing
around it.

### 1a. The queue is invisible — this is the actual gap

`client.ts:79` exposes exactly the number that matters:

```ts
stats: () => ({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount })
```

Nothing reads it. It is dead code. `waitingCount` is *how many customers are
standing in the queue* — the one figure that tells you the counters are too few
— and today there is no way to see it, on any screen or in any log.

The first time it matters will be a night when the shop is slow and nobody can
say whether the database is the reason.

**Plan:**

- Add pool figures to the health endpoint the API already serves.
- Log a warning when `waitingCount` stays above zero across consecutive checks —
  not on a single spike, which is normal, but on a queue that persists.
- Show them on **Admin → Alerts**, beside the other "is this thing working"
  answers, in words rather than jargon: *"Database: 2 of 20 counters busy, no
  queue."*

Small change, and it converts "the site feels slow" from a guess into a reading.

### 1b. Twenty counters on a one-core server is worth questioning

Your VPS has **1 CPU and 4 GB RAM**. Postgres cannot genuinely run twenty
queries at once on one core — it timeslices between them, and past a point more
concurrency makes every query slower rather than the batch faster. The usual
rule of thumb is a few counters per core, not twenty.

But twenty handled 300 concurrent requests without a single failure, so this is
not broken and I am not going to "fix" it on a rule of thumb.

**Plan:** measure before changing. Run the same burst at pool sizes 8, 12 and 20
and compare median and worst-case response time. Change it only if the numbers
say so. If they do not, leave it and write down that it was tested — a setting
somebody once measured is worth more than one somebody guessed twice.

### 1c. What is NOT worth doing

**PgBouncer / an external pooler.** It solves a problem you do not have: many
application processes each holding their own pool, together exhausting Postgres.
You run one API process with one pool of twenty against a limit of a hundred.
Adding a pooler would add a component that can fail, in front of a thing that is
not failing.

Revisit if the API is ever run as several processes or on several machines.

---

## Part 2 — indexes

### Most of this is already done

| Table | Indexes |
|---|---|
| `orders` | **15** |
| `products` | **11** |
| `abandoned_checkouts` | 5 |
| `order_events`, `order_items`, `product_images` | 4 each |

Phone, order number, status+date, category, slug, SKU, full-text search, tags —
all covered. A new index on any of those would be a duplicate.

**Two things worth understanding before we add anything:**

**Postgres is currently ignoring most of them, and it is right to.** `orders` has
2 rows. Reading 2 rows directly is faster than opening an index to find them, so
the planner does the former — that is what those 1,283 sequential scans are.
This is correct behaviour, not a fault, and it will change by itself as the
table grows. **No index we add will make the shop faster today.** This work is
for the shop at 20,000 orders, and it is worth doing before then rather than
after.

**Fifteen indexes on `orders` is not free.** Every order placed writes fifteen
index entries as well as the row. Nine of them have never been used once:

```
orders_trash_idx           0 scans
orders_source_idx          0
orders_status_created_idx  0
orders_created_at_idx      0
orders_phone_idx           0
orders_customer_name_idx   0
orders_delivery_zone_idx   0
orders_payment_method_idx  0
```

Some of those are simply waiting for traffic (`phone` is used by order search;
nobody has searched yet). Others may be genuinely speculative. **Not proposing
to drop any of them now** — zero scans on a 2-row table proves nothing. Proposed
instead: re-read this list after a month of real orders and drop what is still
at zero. Dropping an index is instant and reversible; guessing now is not.

### 2a. The real finding: every report reads the whole table, and no index can help

This is the one thing in this document that is a defect rather than a tuning
question.

Every report — Profit, Performance, the recovery report — filters dates like
this (`profit.service.ts:74`):

```sql
(created_at at time zone 'Asia/Dhaka')::date  between  '2026-08-01' and '2026-08-31'
```

The column is wrapped in a conversion. **A plain index on `created_at` cannot be
used for that.** Postgres can only use an index when the indexed expression
appears bare on one side of the comparison; here it is inside a function, so the
planner has no choice but to read every row and convert each one.

Confirmed: there is no index anywhere in the database on that expression.

Today it costs nothing — 2 rows. At 20,000 orders every load of the Profit page
converts 20,000 timestamps before it can start adding anything up, and it will
do it again for every date range the owner clicks.

**Two ways to fix it. I recommend the second.**

**Option A — expression indexes.** Add indexes matching `shopDay()` exactly:

```sql
CREATE INDEX orders_shop_day_idx ON orders (((created_at at time zone 'Asia/Dhaka')::date));
```

Works, but needs one per column per table (orders.created_at, delivered_at,
abandoned_checkouts.created_at, recovery_coupons.created_at, …), each has to
match the expression character for character, and each is another index to write
on every insert.

**Option B — stop wrapping the column.** Compute the range boundaries as
timestamps in TypeScript and compare the raw column:

```ts
// "1 Aug to 31 Aug, Dhaka time" becomes a plain timestamp range
created_at >= '2026-07-31T18:00:00Z' AND created_at < '2026-08-31T18:00:00Z'
```

Same answer, same timezone correctness, and it uses `orders_created_at_idx` —
which already exists. No new indexes, nothing extra to write on insert, and it
is faster than Option A because a range scan on a plain btree beats an
expression index lookup.

The cost is care: the boundary arithmetic has to be right, including the
half-open end (`< next day`, not `<= last day`), and Dhaka has no daylight
saving so the offset is a constant +6 — which is what makes this safe to do at
all. It touches `shopDay()` and every caller, and every report figure must be
checked against the current output before and after, because a report that
silently shifts by a day is worse than a slow one.

### 2b. Small gaps worth closing at the same time

- `coupon_redemptions.order_id` has no index. Harmless now; it is the join used
  to answer "which orders used coupons".
- `recovery_coupons` is filtered on `status` together with `expires_at`; the
  existing index covers `status` only. Worth a combined one once there are
  thousands of coupons.

Both are one line each and belong with the report work, not before it.

---

## What I would do, in order

1. **Surface the pool figures** (1a). Small, immediately useful, no risk.
2. **Measure pool sizes 8/12/20** (1b) and set it from the result, or leave it
   and record that it was tested.
3. **Fix the date filters** (2a, Option B) with before/after comparison of every
   report figure. This is the real work and the only part that touches money
   numbers.
4. **Add the two small indexes** (2b).
5. **In a month**, re-read the index usage list and drop what is still unused.

Steps 1 and 2 are independent of 3 and 4 and can ship separately.

## Honest summary

- The counter system you described **is what is running**, and it is measured.
- The indexing you asked for is **largely already there**.
- The thing actually worth fixing is one neither of us was looking for: the
  reports are written in a way that no index can ever help, and it will not show
  up until the shop is busy enough for it to hurt.

No code has been written. Say the word and I will start at step 1.
