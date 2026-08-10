# Implementation Plan: Order Origin IP, Location, and IP Blocking

> Planned 2026-08-11. Research done with built-in tools only — the `ccg-workflow`
> runtime (`~/.claude/bin/codeagent-wrapper`, `~/.claude/.ccg/prompts/`) is not
> installed, so there are no Codex/Gemini sessions to resume. See the last
> section.

## Requirement

1. See which IP each order came from, and where that IP is.
2. The same for incomplete (abandoned) checkouts.
3. Block an IP that keeps placing fake orders.
4. Block and unblock, with the list visible and reversible.

---

## What already exists (verified, not assumed)

| Fact | Evidence |
|---|---|
| `orders.customer_ip` column already exists | `backend/src/db/schema/orders.ts:87` |
| Production is already storing **real shopper IPs** | `select count(*), count(customer_ip) from orders` → **17 / 17**; values are `103.80.3.19`, `118.179.20.104`, `115.127.204.28`, `37.111.214.180` (Bangladeshi ISPs) plus `161.142.124.85` (Malaysia, 8 orders) |
| Two old rows hold the Docker gateway (`::ffff:172.19.0.1`) | Placed before the `X-Forwarded-For` fix landed. Not backfillable — that address is genuinely all we recorded |
| The IP is **never shown anywhere** | `toOrderDto` (`order.types.ts:179`) does not map `customerIp`; no admin UI reads it |
| `abandoned_checkouts` has **no IP column at all** | `backend/src/db/schema/abandoned-checkouts.ts` |
| The shopper's IP already *reaches* the abandoned endpoint | `forwardClientHints` is applied to `recordIncompleteCheckoutAction` (`src/app/actions.ts:347/409/488/565`) — it is received and thrown away |
| The canonical "who is this shopper" resolver already exists | `customerKey()` — `backend/src/middleware/rate-limit.ts:116` |

**So part 1 is mostly a display job, not a capture job.** The data has been
collecting all along. That is the cheapest win here and it should ship first.

---

## The one thing that can go badly wrong

**In Bangladesh an IP address is not a person.** The mobile carriers run
carrier-grade NAT — Grameenphone, Robi and Banglalink put hundreds or thousands
of real customers behind a handful of public addresses. This is already written
up in `backend/src/config/env.ts`, and it is why the rate limits were *raised*
rather than lowered.

The direct consequence for this feature:

> Blocking `103.80.3.19` because one person placed four fake orders can silently
> stop every Grameenphone customer in a district from checking out — during an
> ad campaign, with no error you would ever see.

The design below does not pretend this away. It makes the block **informed,
reversible, and self-expiring by default**:

- Before blocking, the panel shows **how many distinct phone numbers and orders
  came from that IP**. Four orders from one number is an abuser; four orders
  from four numbers is a shared tower.
- A block **carries an expiry**, defaulting to 7 days. Permanent is available
  and is a deliberate choice, not the path of least resistance.
- Unblock is one click, and the block list is a page of its own — not a setting
  buried where nobody looks.
- Blocking never touches browsing. A blocked address can still open the shop,
  see products, and price a cart. Only *writes* are refused.

---

## Design decisions

### D1 — Geolocation: offline database, resolved on read

**Recommended: an offline MMDB file, looked up when the admin views the page.**

| Option | Verdict |
|---|---|
| **Offline MMDB (DB-IP City Lite)** — free, CC-BY 4.0, no account needed, ~60 MB, monthly refresh, read with the `maxmind` npm package | **Recommended.** No outbound call, no rate limit, no customer IP leaving the server, works offline, microsecond lookups |
| External HTTP API (ip-api.com, ipinfo.io) | Zero setup, but sends every customer's IP to a third party, rate-limits exactly when a campaign makes the panel busy, and adds a network call to a page render |
| Freeze country/city onto the order at checkout | Puts a lookup in the checkout hot path, and locks in whatever the database said that day |

**Resolved on read, not stored.** A newer database file then improves *old*
orders too, and no schema column has to be kept in sync.

**The file is optional.** If `GEOIP_DB_PATH` is unset or the file is missing,
the API returns `location: null` and the panel shows the bare IP. The feature
degrades; it does not break. Attribution line ("IP Geolocation by DB-IP") goes
in the panel footer, as the licence requires.

### D2 — What a block refuses

Only the two **public write** endpoints:

- `POST /api/v1/checkout/order` — placing an order
- `POST /api/v1/checkout/incomplete` — recording an abandoned checkout

Deliberately **not** blocked: product browsing, search, cart quoting, order
tracking, and everything under `/admin` or `/auth`. Blocking browsing gains
nothing against an abuser and is pure collateral damage under CGNAT.

### D3 — What a blocked visitor sees

A neutral 403:

> "We can't accept this order right now. Please call us on 09612000000."

It gives a real customer caught by CGNAT a way through, and tells an abuser
nothing they can act on. Not "your IP is blocked" — that is an invitation to
rotate.

### D4 — IPv6 is blocked as a /64

A single residential IPv6 allocation gives one person 2^64 addresses. Blocking
one of them accomplishes nothing. `ipKeyGenerator` in `express-rate-limit`
already collapses to /64 and is the function to reuse.

### D5 — Who may block

`admin` and above, not `manager`. Blocking can refuse revenue; it belongs with
the person who owns that decision. Viewing the IP and its history stays at
`manager`, because it is part of vetting an order on the confirmation call.

---

## Implementation steps

### Phase 1 — Show the IP that is already being recorded

**Deliverable:** every order detail page shows where the order came from.

1. `OrderDto` gains `customerIp: string | null` and `customerIpOrderCount: number`
   (how many other orders share it). Detail only, never the list projection —
   a column of IPs in the list is noise, and the count needs a query.
2. `toOrderDto` maps `row.customerIp`.
3. New repository query `countOrdersByIp(ip)`.
4. `getByIdentifier` fills the count.
5. Admin `OrderDetail.tsx` gains an **Origin** card under Customer: IP,
   location (Phase 3), "N orders from this address", and — once Phase 4 lands —
   a Block button.
6. New admin list filter `?customerIp=` so clicking the IP shows every order
   from it. This is the actual fraud workflow: one click from a suspicious
   order to the pattern.

### Phase 2 — Capture and show the IP for incomplete checkouts

**Deliverable:** the call list shows where each lead came from.

7. Migration: `alter table abandoned_checkouts add column customer_ip text`.
   Nullable, no backfill — existing rows genuinely have no IP recorded.
8. `abandoned-checkouts.ts` schema gains `customerIp`.
9. **New shared helper** `backend/src/lib/net/client-ip.ts` exporting
   `clientIp(req): string | null` — the same trust rule `customerKey` uses
   (honour `x-customer-ip` only from a caller on the private network), but
   returning the raw address rather than a rate-limit bucket key.
   `customerKey` is then rewritten to call it, so there is exactly one place
   that decides who the shopper is.
10. `abandoned.routes.ts` `record` handler passes `clientIp(req)` into
    `service.record()`; the service writes it on both insert and the upsert
    path, so the row always holds the **most recent** address seen.
11. `AbandonedDto` gains `customerIp`; the `/admin/incomplete` UI shows it in
    the same shape as the order card.
12. **Also fix `order.controller.ts:69`** — it currently passes `req.ip`
    directly. That works today only because the storefront forwards a
    single-entry `X-Forwarded-For` and `TRUST_PROXY_HOPS=1` happens to make
    `req.ip` correct. Routing it through `clientIp(req)` makes the guarantee
    explicit instead of incidental, and stops a future proxy change from
    silently poisoning the fraud trail.

### Phase 3 — Location

**Deliverable:** "Dhaka, Bangladesh (Grameenphone)" next to the IP.

13. Add `maxmind` to `backend/package.json`.
14. `backend/src/lib/geo/ip-location.ts` — opens the MMDB once at boot, caches
    the reader, exposes `lookupIp(ip): { country, countryCode, city } | null`.
    Returns `null` for private/loopback addresses and when no database is
    configured. Never throws: a geolocation failure must not fail an admin page.
15. `GEOIP_DB_PATH` in `config/env.ts`, optional. A single startup log line
    saying whether location lookup is on.
16. Docker: download DB-IP City Lite into the image (or mount it as a volume,
    which makes a monthly refresh a file copy rather than a rebuild — **prefer
    the volume**). Documented in `.env.deploy.example` alongside a one-line
    refresh command.
17. Order and abandoned DTOs gain `location: { country, countryCode, city } | null`.

### Phase 4 — Block and unblock

**Deliverable:** an IP can be refused, and un-refused, from the panel.

18. Migration + schema: `blocked_ips`
    - `id`, `ip` (text, the /64 prefix for IPv6), unique
    - `reason` (text, free)
    - `blocked_by` → `admins.id`, `on delete set null`
    - `created_at`
    - `expires_at` (nullable — null means permanent)
    - `hit_count`, `last_hit_at` — so you can see whether a block is still
      doing anything, or is just sitting there blocking a tower
19. `backend/src/modules/security/blocked-ip.service.ts`
    - `isBlocked(ip)` reads an **in-memory Set**, not the database. A database
      round trip on every checkout is a cost paid by every honest customer to
      catch a rare one.
    - The set is rebuilt on every write and refreshed on a timer (5 min,
      `unref`'d — same pattern as `products/metrics.scheduler.ts`), so it also
      picks up expiries.
20. `backend/src/middleware/block-guard.ts` — mounted on `checkoutPublicRouter`
    and `abandonedPublicRouter` **after** the rate limiter. Increments
    `hit_count` asynchronously; never blocks the response on that write.
21. `backend/src/modules/security/blocked-ip.routes.ts` — `/admin/blocked`:
    list, create, delete. `requireRole("admin")`. Mounted in `routes/v1.ts`.
22. Admin page `/admin/blocked`: the list, with reason, who blocked it, when it
    expires, how many attempts it has stopped, and an Unblock button.
23. Block button on the order and incomplete cards, opening a small dialog:
    reason, and expiry (7 days / 30 days / permanent). The dialog shows the
    shared-address count from Phase 1 **before** the confirm button, because
    that is the number that should stop a bad block.
24. `AdminShell.tsx` nav entry.

---

## Key files

| File | Operation | Description |
|---|---|---|
| `backend/src/lib/net/client-ip.ts` | **New** | Single source of truth for "which address is this shopper" |
| `backend/src/middleware/rate-limit.ts:116` | Modify | `customerKey` delegates to `clientIp` |
| `backend/src/modules/orders/order.controller.ts:69` | Modify | `req.ip` → `clientIp(req)` |
| `backend/src/modules/orders/order.types.ts:71,179` | Modify | `OrderDto` gains `customerIp`, `location`, `customerIpOrderCount` |
| `backend/src/modules/orders/order.repository.ts` | Modify | `countOrdersByIp`, `customerIp` list filter |
| `backend/src/db/schema/abandoned-checkouts.ts` | Modify | `customer_ip` column |
| `backend/src/modules/orders/abandoned.routes.ts:81` | Modify | Pass `clientIp(req)` into `record` |
| `backend/src/modules/orders/abandoned.service.ts:125` | Modify | Persist it on insert and upsert |
| `backend/src/lib/geo/ip-location.ts` | **New** | MMDB reader, null-safe |
| `backend/src/config/env.ts` | Modify | `GEOIP_DB_PATH` (optional) |
| `backend/src/db/schema/blocked-ips.ts` | **New** | The block table |
| `backend/src/modules/security/blocked-ip.{service,routes}.ts` | **New** | Cache, CRUD, role guard |
| `backend/src/middleware/block-guard.ts` | **New** | Refuses public writes |
| `backend/src/routes/v1.ts:90` | Modify | Mount `/admin/blocked` |
| `backend/migrations/0022_*.sql`, `0023_*.sql` | **New** | Hand-written — `db:generate` is broken (snapshots 0011–0020 missing) |
| `src/components/admin/OrderDetail.tsx:674` | Modify | Origin card |
| `src/app/(admin)/admin/incomplete/page.tsx` | Modify | Same card on the call list |
| `src/app/(admin)/admin/blocked/page.tsx` | **New** | Block list and unblock |
| `src/components/admin/AdminShell.tsx:39` | Modify | Nav entry |
| `src/lib/api/types.ts` | Modify | Mirror the DTO changes |
| `docker-compose.yml` | Modify | Mount the GeoIP database |

---

## Risks and mitigation

| Risk | Mitigation |
|---|---|
| **CGNAT — one block silently stops a whole carrier's customers** | Show the distinct-phone and order count before confirming; default to a 7-day expiry; one-click unblock; a `hit_count` that reveals a block catching far too much |
| A blocked real customer just disappears | The 403 gives the hotline number, so the order arrives by phone instead of being lost |
| Blocking yourself or the storefront container | The guard never applies to `/admin`, `/auth`, or private-network callers; a startup assertion refuses to block a private address |
| Database lookup on every checkout | In-memory Set, refreshed on write and on a 5-minute unref'd timer |
| 60 MB GeoIP file in the image / stale data | Mount as a volume, not baked in — refresh is a file copy, no rebuild |
| Customer IPs sent to a third party | Offline lookup by design; no outbound call |
| `db:generate` produces a destructive cumulative migration | Hand-write both migrations and the journal entries, as `0021_meta_click_ids.sql` already had to be |
| Expiry never fires because nothing sweeps | `isBlocked` checks `expires_at` at read time; the timer only refreshes the set |
| Storing IPs is personal data | Already stored today. Worth a retention decision — recommend purging `customer_ip` on orders older than 12 months, in the same job that purges the trash |

---

## Test strategy

- `clientIp` — forged `x-customer-ip` from a **public** caller is ignored;
  honoured from a private one. This is the same forgery that poisoned the rate
  limits before, and it must not come back through a new door.
- `blocked_ips` — a blocked address gets 403 on `POST /checkout/order` and on
  `/checkout/incomplete`, and **200 on product browsing and cart quoting**.
- An expired block does not refuse.
- An IPv6 address is blocked as its /64: blocking `2001:db8:1:2::1` also
  refuses `2001:db8:1:2::999`.
- Admin and auth routes are never refused, even from a blocked address.
- `lookupIp` returns `null` — and does not throw — with no database configured,
  and for `127.0.0.1` / `::1` / `172.19.0.1`.
- Order detail exposes `customerIp`; the **public** confirmation and tracking
  responses do not. An order's origin IP is operational data, not something to
  hand back to whoever posts a phone number.

---

## Suggested order of delivery

Phase 1 alone is worth shipping on its own — the data is already there, it needs
no migration and no new dependency, and it answers "ke kon IP theke order korlo"
for every order in the database today. Phase 4 is the one that can hurt
customers, and should go out last, after the counts from Phase 1 have been
looked at for a few days on real traffic.

---

## SESSION_ID

- CODEX_SESSION: *(not available — `ccg-workflow` runtime not installed)*
- GEMINI_SESSION: *(not available — `ccg-workflow` runtime not installed)*

To enable multi-model planning: `npx ccg-workflow`
