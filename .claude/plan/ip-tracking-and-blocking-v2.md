# Implementation Plan v2: Order Origin IP, IP Directory, and Blocking

> Supersedes `ip-tracking-and-blocking.md`. Planned 2026-08-11.
>
> The `ccg-workflow` runtime is not installed, so there is no Codex/Gemini
> cross-check. In its place this revision was reviewed by two specialist agents
> — `database-reviewer` on the aggregate query design and `security-reviewer` on
> the block enforcement path. **Both found real defects in v1.** They are fixed
> below and marked ⚠ where the v1 design was wrong.

## What changed from v1

The requirement grew in three places:

1. The order detail shows not just *how many* other orders share the IP, but
   **the orders themselves** — number, date, name, phone, status, total.
2. The "blocked list" becomes a full **IP directory**: every address ever seen,
   not only the blocked ones, with location, and block/unblock inline. That is
   where a block is found again in order to be lifted.
3. Location appears in **both** places — the order page and the directory.

---

## Verified starting point

| Fact | Evidence |
|---|---|
| `orders.customer_ip` already holds **real shopper IPs** in production | `count(*) = count(customer_ip) = 17`; values are Bangladeshi ISP ranges (`103.80.3.19`, `118.179.20.104`, `115.127.204.28`, `37.111.214.180`) plus `161.142.124.85` (Malaysia) |
| Two old rows hold the Docker gateway (`::ffff:172.19.0.1`) | Written before the `X-Forwarded-For` fix. Not backfillable |
| The IP is never displayed anywhere | `toOrderDto` — `order.types.ts:179` — does not map it |
| `abandoned_checkouts` has no IP column | `backend/src/db/schema/abandoned-checkouts.ts` |
| The IP already *reaches* the abandoned endpoint and is discarded | `forwardClientHints` is applied to `recordIncompleteCheckoutAction`, `src/app/actions.ts:347` |
| No index on `customer_ip` | `orders.ts:147-167` |
| `blocked_ips` does not exist yet | Greenfield — so its column types can still be chosen correctly, for free |

---

## The thing that can go badly wrong

**In Bangladesh an IP address is not a person.** Grameenphone, Robi and
Banglalink run carrier-grade NAT — hundreds of real customers behind one public
address. This is already documented in `backend/src/config/env.ts`, and it is
why the rate limits were *raised* rather than lowered.

> Blocking `103.80.3.19` because one person placed four fake orders can stop
> every Grameenphone customer in a district from checking out — mid-campaign,
> with no error you would ever see.

The whole design bends around this:

- **The distinct-phone count is the most important number on the page.** Four
  orders from one number is an abuser. Four orders from four numbers is a tower.
  It sits directly above the Block button.
- Blocks **expire by default** (7 days). Permanent is a deliberate choice.
- Unblocking is one click, and blocks are **soft-deleted**, so a lifted block is
  still findable with who lifted it and when.
- Blocking never touches browsing. A blocked address can still open the shop,
  search, and price a cart. Only *writes* are refused.
- **IP blocking stops casual abuse, not a determined fraudster.** One SIM
  reconnect gives a new address. Say this out loud so the feature is not trusted
  for more than it does.

---

## Design decisions

### D1 ⚠ Store IPs as `inet`, not `text` — and `blocked_ips` as `cidr`

v1 said "text is fine". It is not, and the /64 requirement is the proof: IPv6
has several valid spellings of one address (`::` compression, leading zeros,
case), so text comparison silently misses matches, and truncating a *string* to
N characters does not express a /64 bit boundary at all.

- `abandoned_checkouts.customer_ip` — created as `inet` from day one. No
  migration cost; it does not exist yet.
- `orders.customer_ip` — migrate now, at 17 rows, while it is free:
  `ALTER TABLE orders ALTER COLUMN customer_ip TYPE inet USING customer_ip::inet;`
  **Audit first** — one malformed value fails the whole statement:
  `SELECT id, customer_ip FROM orders WHERE customer_ip IS NOT NULL AND customer_ip !~ '^[0-9a-fA-F:.]+$';`
- `blocked_ips.ip` — **`cidr`**, not `inet`. `cidr` enforces "this row is a
  network", which is what "block this /64" means. `inet` would happily store a
  host address carrying a netmask, which is a different thing. Matching then
  uses the containment operator `>>=` rather than string equality.

### D2 ⚠ The IP directory aggregate: `UNION ALL` then one `GROUP BY`

v1 hand-waved this. The obvious implementation is wrong:

> Joining raw `orders` to raw `abandoned_checkouts` on `customer_ip` and *then*
> aggregating fans out. An IP with 5 orders and 20 abandoned checkouts produces
> 100 rows before `SUM` runs, and revenue comes out 20× too high. On today's 17
> rows it would look perfectly correct.

Correct shape — tag each source, union, aggregate once:

```sql
WITH seen AS (
  SELECT customer_ip AS ip, phone, grand_total, created_at AS at, 'order' AS src
    FROM orders
   WHERE customer_ip IS NOT NULL AND deleted_at IS NULL
  UNION ALL
  SELECT customer_ip, phone, 0, last_seen_at, 'abandoned'
    FROM abandoned_checkouts
   WHERE customer_ip IS NOT NULL AND recovered_order_id IS NULL
),
ip_stats AS (
  SELECT ip,
         count(*) FILTER (WHERE src = 'order')      AS order_count,
         count(*) FILTER (WHERE src = 'abandoned')  AS incomplete_count,
         count(DISTINCT phone)                      AS distinct_phones,
         sum(grand_total)                           AS revenue,
         min(at) AS first_seen,
         max(at) AS last_seen
    FROM seen
   GROUP BY ip
)
SELECT s.*, b.id AS block_id, b.expires_at,
       count(*) OVER () AS total_ips
  FROM ip_stats s
  LEFT JOIN blocked_ips b ON b.ip >>= s.ip AND b.unblocked_at IS NULL
 WHERE ($prefix IS NULL OR host(s.ip) LIKE $prefix || '%')
 ORDER BY <sort> DESC, s.ip
 LIMIT $perPage OFFSET $offset;
```

Three traps this closes, each of which would have shipped:

- **`WHERE customer_ip IS NOT NULL` inside each branch, before the union.** SQL
  groups all NULLs together, so without this every no-IP row collapses into one
  fake "IP" with a huge bogus revenue total.
- **`deleted_at IS NULL`** on the orders branch. Otherwise trashed orders inflate
  the very numbers the page exists to be trusted for.
- **`recovered_order_id IS NULL`** on the abandoned branch. A customer who
  abandoned once and then bought would otherwise be counted twice — once as a
  sale, once as an unresolved abandonment.

`count(*) OVER ()` works here because it is applied to the **grouped** rows, one
per IP — the house pagination style from `listOrders` (`order.repository.ts:433`),
just layered on a CTE. Every sort needs `s.ip` appended as a tiebreak, matching
`buildOrderBy` (`order.repository.ts:405`); ties are guaranteed (many IPs at
zero revenue, several sharing an order count) and without it rows repeat and
vanish across pages.

### D3 ⚠ `count(DISTINCT …) OVER ()` does not exist in PostgreSQL

The order-detail panel cannot get its distinct-phone count via the house window
trick — Postgres rejects `DISTINCT` inside a window function. Use a shared CTE
so the list and the stats can never drift apart:

```sql
WITH matches AS (
  SELECT * FROM orders
   WHERE customer_ip = $ip AND deleted_at IS NULL AND id <> $currentOrderId
),
stats AS (
  SELECT count(*) AS total, count(DISTINCT phone) AS distinct_phones FROM matches
)
SELECT m.*, s.total, s.distinct_phones
  FROM (SELECT * FROM matches ORDER BY created_at DESC, id LIMIT 5) m
 CROSS JOIN stats s;
```

The current order is excluded from **both** the list and the counts, so opening
an order never inflates its own IP's statistics.

### D4 Indexes

```sql
CREATE INDEX orders_customer_ip_idx ON orders (customer_ip, created_at DESC)
  WHERE deleted_at IS NULL AND customer_ip IS NOT NULL;

CREATE INDEX abandoned_checkouts_customer_ip_idx
  ON abandoned_checkouts (customer_ip, last_seen_at DESC)
  WHERE customer_ip IS NOT NULL;
```

Partial on both predicates, matching the house style. The orders one is **not
optional**: the order-detail panel runs on every order an admin opens, which for
someone working through a day's orders is a hot path. The directory page is
occasional and can tolerate more.

No covering `INCLUDE` columns — the detail panel returns five rows; a fat index
would tax every checkout write for an unmeasurable read win.

### D5 Location: offline database, resolved on read

| Option | Verdict |
|---|---|
| **Offline MMDB (DB-IP City Lite)** — free, CC-BY 4.0, no account, ~60 MB, monthly | **Recommended.** No outbound call, no rate limit, no customer IP leaving the server, microsecond lookups |
| External HTTP API | Sends every customer's IP to a third party, and rate-limits exactly when a campaign makes the panel busy |
| Freeze country/city onto the order at checkout | Puts a lookup in the checkout hot path and locks in whatever the database said that day |

Resolved **on read**, so a newer file improves old orders too. **Optional** — if
`GEOIP_DB_PATH` is unset or missing, the API returns `location: null` and the UI
shows the bare IP. Mounted as a volume, not baked into the image, so a monthly
refresh is a file copy rather than a rebuild. Attribution line in the panel
footer, as the licence requires.

### D6 What a block refuses, and what it never touches

Refused — the two public **write** endpoints only:

- `POST /api/v1/checkout/order`
- `POST /api/v1/checkout/incomplete`

Never refused: browsing, search, cart quoting, order tracking, `/admin/*`,
`/auth/*`, `/health`. Blocking browsing gains nothing against an abuser and is
pure collateral damage under CGNAT.

### D7 The 403, honestly assessed

The response is a neutral 403 with the hotline number — not "your IP is
blocked", which is an invitation to rotate.

**But be clear about what that buys:** a script only needs the status code
(403 vs 201) to know to rotate. The neutral wording helps a human, not a bot.

The stronger alternative — **shadow-accept**: return the same 201, but reserve
no stock, hand nothing to the courier, fire no Telegram alert and **no Meta
Purchase event**, and drop the order into a review queue. It denies the attacker
any signal at all.

**Recommendation: ship the flat 403 first.** Shadow-accept has real surface to
get wrong, and a bug that leaks a fake order into stock or into Meta attribution
is worse than the problem it solves — this repo has already spent commits fixing
exactly that class of leak. Recorded here as considered and deferred, not
overlooked.

### D8 ⚠ Security fixes the v1 design needed

| # | Problem in v1 | Fix |
|---|---|---|
| 1 | **Nothing stopped an admin from blocking a private/loopback address.** If `127.0.0.1` or the Docker subnet landed in `blocked_ips` and the runtime ever fell through to the socket address, *the entire shop's checkout* would be refused at once — a self-inflicted, revenue-stopping outage | The create endpoint **rejects with 400** any loopback, RFC1918, link-local, ULA, unspecified or broadcast address. Reuse the existing `isPrivateAddress()` — the primitive is already there, v1 simply never applied it to the write path |
| 2 | **An unhandled rejection in the 5-minute refresh timer crashes the Node process.** A transient pool hiccup becomes a full API outage | `try/catch` inside the timer, log and continue, keep serving the last known-good set |
| 3 | Cold-start behaviour undefined | **Fail open.** For a COD shop, availability beats catching one order in a one-second startup window. Stated, not left implicit |
| 4 | `hit_count` written synchronously on every blocked request | Debounced in-memory counter flushed periodically. The 403 never waits on a write |
| 5 | `blockGuard` ordering unspecified | Mounted **after** the existing rate limiter, so a blocked flood is capped like anyone else's before it can reach the counter |
| 6 | `ipKeyGenerator`'s /64 collapse — built for a *recoverable* rate-limit bucket — reused for a *punitive, possibly permanent* block, invisibly | The confirm dialog states the actual range: "this will block `2400:1234:5678:9abc::/64`, not one address" |
| 7 | Unblock was a hard `DELETE`, destroying the audit trail exactly when a wrongful block is disputed | Soft delete: `unblocked_by`, `unblocked_at`. Also what makes a lifted block still findable — which is what was asked for |
| 8 | No IP format normalisation between write and lookup | One `normalizeIp()` used by both. A format mismatch means a block silently never matches — worse than no block, because it creates false confidence |
| 9 | No emergency path if the person who can unblock is themselves blocked | A documented break-glass SQL command in `docs/`, independent of the panel |

**Accepted, documented risks** (not fixed, because fixing them means re-architecting the storefront↔API trust model):

- Any process on the VPS host can reach the API on loopback and forge
  `x-customer-ip`, because `isPrivateAddress()` trusts `127.0.0.1`. That needs
  host access — already game over — but a future Caddyfile catch-all would widen
  it. **Cheap hardening, folded into Phase 4:** a shared secret header between
  the `web` and `api` containers, so "internal caller" means *that* caller
  rather than any private peer. This strengthens the rate limiter at the same
  time.
- A compromised storefront container can call `api:4000` directly with any
  `x-customer-ip`. Inherent to the topology; worth stating because this feature
  raises the stakes of it.

### D9 Roles

Viewing IPs and the directory: `manager` — it is part of vetting an order on the
confirmation call. Creating or lifting a block: `admin` — it can refuse revenue.

---

## Implementation steps

### Phase 1 — Show the IP already being recorded

**Ships alone. No migration, no dependency, answers the question for every order
in the database today.**

1. `OrderDto` gains `customerIp: string | null`.
2. `toOrderDto` maps it.
3. `countOrdersByIp` / the shared-`matches` query from **D3** in
   `order.repository.ts`.
4. `getByIdentifier` returns `sameIp: { total, distinctPhones, recent: [...] }`.
5. **Origin card** in `OrderDetail.tsx`, under Customer: the IP, and — when
   `total > 0` — a compact table of the other orders (number, date, name, phone,
   status, total), each row linking to that order. The **distinct-phone count is
   rendered as the headline**, worded so it reads as a judgement and not a
   statistic: *"4 orders from this address — but 4 different phone numbers,
   which is normal on a shared mobile network."*
6. Order list filter `?customerIp=`, so the card's "see all" is one click.

### Phase 2 — Incomplete checkouts

7. Migration: `abandoned_checkouts.customer_ip inet` + the partial index.
8. **New** `backend/src/lib/net/client-ip.ts` — `clientIp(req)` and
   `normalizeIp(value)`. Same trust rule as `customerKey`, raw address instead of
   a bucket key. `customerKey` is rewritten to delegate, so **one** function
   decides who the shopper is.
9. `abandoned.routes.ts` record handler passes it in; the service writes it on
   insert *and* on the upsert path, so the row holds the most recent address.
10. `AbandonedDto` gains `customerIp`; `/admin/incomplete` shows the same card.
11. ⚠ **`order.controller.ts:69` currently passes `req.ip` directly.** It is
    correct today only because the storefront forwards a single-entry
    `X-Forwarded-For` and `TRUST_PROXY_HOPS=1` happens to line up. Route it
    through `clientIp(req)` so the guarantee is explicit rather than incidental.

### Phase 3 — Location

12. `maxmind` dependency; `backend/src/lib/geo/ip-location.ts` opens the MMDB
    once at boot, returns `null` for private addresses and when unconfigured,
    and **never throws** — a geolocation failure must not fail an admin page.
13. `GEOIP_DB_PATH` in `config/env.ts`; one startup log line saying whether
    lookup is on.
14. Volume mount in `docker-compose.yml`; refresh command in
    `.env.deploy.example`.
15. `location: { country, countryCode, city } | null` on the order DTO, the
    abandoned DTO, and every directory row.

### Phase 4 — The IP directory, and blocking

16. Migration + schema `blocked_ips`: `id`, `ip cidr` unique, `reason`,
    `blocked_by` → admins, `created_at`, `expires_at` nullable,
    `unblocked_by`, `unblocked_at`, `hit_count`, `last_hit_at`.
17. `backend/src/modules/security/ip-directory.service.ts` — the **D2** query.
18. `blocked-ip.service.ts` — in-memory set, rebuilt on write and on a 5-minute
    `unref`'d timer (same pattern as `products/metrics.scheduler.ts`), wrapped in
    `try/catch` per **D8-2**, filtered `expires_at IS NULL OR expires_at > now()`.
    Matching via `>>=` so a /64 covers its hosts.
19. `middleware/block-guard.ts` — mounted **after** the rate limiter on the two
    public write routers. Debounced counter.
20. `blocked-ip.routes.ts` under `/admin/ips` — directory list, block, unblock.
    `requireRole("admin")` on the two writes, `manager` on the read. Mounted in
    `routes/v1.ts`.
21. **`/admin/ips` page** — the directory. Every address ever seen, with
    location, order count, distinct phones, revenue, incomplete count, first and
    last seen, and block state. Filter tabs: **All / Blocked / Expired**, so a
    lifted or lapsed block is still findable. Search by IP prefix. Unblock inline.
22. Block dialog — reason, expiry (7 days / 30 days / permanent), and **above the
    confirm button**: the distinct-phone count, the location, and, for IPv6, the
    exact `/64` range being blocked.
23. `AdminShell.tsx` nav entry.
24. Shared internal-caller secret between `web` and `api` (**D8**, accepted-risk
    hardening).
25. `docs/` — the break-glass unblock command.

---

## Key files

| File | Operation | Description |
|---|---|---|
| `backend/src/lib/net/client-ip.ts` | **New** | `clientIp` + `normalizeIp` — one source of truth |
| `backend/src/middleware/rate-limit.ts:116` | Modify | `customerKey` delegates to `clientIp` |
| `backend/src/modules/orders/order.controller.ts:69` | Modify | `req.ip` → `clientIp(req)` |
| `backend/src/db/schema/orders.ts:87,147` | Modify | `customer_ip` → `inet`, partial index |
| `backend/src/db/schema/abandoned-checkouts.ts` | Modify | `customer_ip inet` + index |
| `backend/src/db/schema/blocked-ips.ts` | **New** | `cidr`, soft delete, hit counter |
| `backend/src/modules/orders/order.repository.ts:422` | Modify | `sameIp` CTE query, `customerIp` filter |
| `backend/src/modules/orders/order.types.ts:71,179` | Modify | `customerIp`, `location`, `sameIp` |
| `backend/src/modules/orders/abandoned.{routes,service}.ts` | Modify | Capture and expose the IP |
| `backend/src/lib/geo/ip-location.ts` | **New** | MMDB reader, null-safe, never throws |
| `backend/src/modules/security/ip-directory.service.ts` | **New** | The D2 aggregate |
| `backend/src/modules/security/blocked-ip.{service,routes}.ts` | **New** | Cache, CRUD, guards |
| `backend/src/middleware/block-guard.ts` | **New** | Refuses public writes |
| `backend/src/config/env.ts` | Modify | `GEOIP_DB_PATH`, internal secret |
| `backend/src/routes/v1.ts:90` | Modify | Mount `/admin/ips` |
| `backend/migrations/0022…0024_*.sql` | **New** | Hand-written — `db:generate` is broken (snapshots 0011–0020 missing) |
| `src/components/admin/OrderDetail.tsx:674` | Modify | Origin card + same-IP order table |
| `src/app/(admin)/admin/incomplete/page.tsx` | Modify | Same card |
| `src/app/(admin)/admin/ips/page.tsx` | **New** | The directory |
| `src/components/admin/AdminShell.tsx:39` | Modify | Nav entry |
| `src/lib/api/types.ts` | Modify | Mirror the DTOs |
| `docker-compose.yml` | Modify | GeoIP volume, internal secret |

---

## Risks and mitigation

| Risk | Mitigation |
|---|---|
| **CGNAT — one block stops a whole carrier** | Distinct-phone count above the confirm button; 7-day default expiry; one-click unblock; `hit_count` reveals a block catching far too much |
| Blocking a private address takes the shop down | Write-time 400 on any private/loopback/ULA/broadcast address |
| Refresh timer crash takes the API down | `try/catch`, log and continue, last known-good set |
| Revenue figures silently 20× too high | Aggregate per source, then combine — never join raw rows |
| Trashed orders inflating the fraud signal | `deleted_at IS NULL` in both queries |
| Recovered checkouts double-counted | `recovered_order_id IS NULL` |
| Rows repeating across pages | `ip` appended as tiebreak on every sort |
| Aggregate too slow as data grows | Live query now; escalate to a `REFRESH MATERIALIZED VIEW CONCURRENTLY` (15–60 min) once combined rows pass ~300–500k **or** `EXPLAIN ANALYZE` exceeds ~300–500 ms — measure, do not guess. Create the unique index on the view *before* needing `CONCURRENTLY` |
| A /64 block silently denies far more than intended | The range is spelled out in the dialog |
| `hit_count` write storm | Guard mounted after the rate limiter; debounced counter |
| Blocked customer simply lost | 403 carries the hotline, so the order arrives by phone |
| Abuser rotates IP | Stated as a known limit. IP blocking is for casual abuse; repeat fraud needs phone/address signals |
| Wrongful block disputed later | Soft delete keeps who blocked, who lifted, and when |
| `ALTER TYPE … USING …::inet` fails on one bad row | Audit the 17 rows first; normalise at the write boundary so it cannot recur |
| Storing customer IPs long-term | Personal data. Recommend nulling `customer_ip` on orders older than 12 months in the same job that purges the trash, and a 12-month review even for permanent blocks |

---

## Test strategy

- **Forgery** — a forged `x-customer-ip` from a *public* caller is ignored;
  honoured from a private one. This is the exact forgery that once poisoned the
  rate limits, `orders.customer_ip` and Meta attribution; it must not return
  through a new door.
- **Scope** — a blocked address gets 403 on both write endpoints and **200 on
  browsing, search, quoting and tracking**. Admin and auth are never refused.
- **Expiry** — an expired block does not refuse.
- **IPv6** — blocking `2001:db8:1:2::/64` refuses `2001:db8:1:2::999`.
- **Self-protection** — blocking `127.0.0.1`, `10.0.0.5`, `::1` and
  `172.19.0.1` each return 400.
- **Aggregate correctness** — the one that catches the expensive bug: an IP with
  3 orders *and* 4 abandoned checkouts reports revenue equal to the sum of the 3
  orders, not 12× anything. Plus: a trashed order is excluded; a recovered
  checkout is excluded; two IPs with identical order counts paginate stably.
- **Geo** — `lookupIp` returns `null` and does not throw with no database
  configured, and for `127.0.0.1` / `::1` / `172.19.0.1`.
- **Leakage** — order detail exposes `customerIp`; the public confirmation and
  public tracking responses do not. Assert on the serialised body, so a future
  `...order` spread cannot quietly regress it.

---

## Suggested delivery order

**Phase 1 alone is worth shipping.** The data is already there, it needs no
migration and no dependency, and it answers "who ordered from which IP" for
every order in the database today.

**Phase 4 goes last.** It is the only part that can hurt a real customer, and it
should not go out until the distinct-phone counts from Phase 1 have been watched
on real traffic for a few days. That number is what tells you whether blocking
an address in this country is ever safe — and on a Grameenphone range, it may
well tell you it is not.

---

## SESSION_ID

- CODEX_SESSION: *(unavailable — `ccg-workflow` not installed)*
- GEMINI_SESSION: *(unavailable — `ccg-workflow` not installed)*

Reviewed instead by: `database-reviewer` (agent `aad3f1ec7a49d0a4f`),
`security-reviewer` (agent `a3ec85efb901d41aa`).
To enable multi-model planning: `npx ccg-workflow`
