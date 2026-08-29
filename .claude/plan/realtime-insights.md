# Implementation Plan: Real-time Insights (live visitors)

> Planning document. No code written.

## The short answer

Yes — and it fits this codebase better than it usually would, because the two hard parts
are already solved here: there is an established browser→server path (server actions), and
the client's real IP already reaches the API through `forwardClientHints`.

The design below is deliberately the *small* one. This shop has 3 products and 33 orders;
concurrent visitors will be single digits to low tens. A design that would be right for
10,000 concurrent users would be a liability on a 2-vCPU box that is also rendering the
shop.

---

## DECISIONS TAKEN (2026-08-17)

1. **Heartbeat every 10s.**
2. **Full IP, resolved city, and the page they are on** — shown per visitor.
3. **History is in scope**, not deferred.
4. **A separate "Real-time Insights" admin section**, plus a **trending graph** of which
   pages draw the most visitors.

### What those answers change

**(a) Storage is now BOTH, not one.** §B argued for memory-only, and that argument only
held while nothing was kept. With history in scope the design splits:

- **Memory** — live presence. Who is on the site right now, ephemeral, swept on read.
- **Postgres** — history. One row per PAGE VISIT, written on enter and closed on leave with
  its duration. **Not one row per heartbeat.** At 10s a single 5-minute visit would
  otherwise be 30 rows for one fact; the heartbeat's job is to keep memory warm and to
  detect the leave, not to be the record.

Volume stays small: a 1,000-page-view day is 1,000 rows. Raw rows pruned after a window,
daily rollups kept — that is what makes the trending graph cheap to draw.

**(b) City needs a source this repo does not have.** The existing geo library resolves a
city from *typed address text*, for ad matching. A live visitor has typed nothing. So a
city means one of:

| Option | Cost |
|---|---|
| Local GeoIP database (MaxMind GeoLite2) | Free, but a licence key, a ~60MB file in the image, a reader dependency, and a refresh job |
| External lookup per IP | A third-party dependency in the request path, and every visitor's IP sent off-box |
| Country only, from a CDN header | Not available — Caddy terminates directly, no Cloudflare |

Recommendation: **the local database.** The external option means handing visitor IPs to
someone else, which is the wrong trade when the point of the feature is knowing your own
traffic.

**(c) The city will often be wrong, and in a specific direction.** Most of this shop's
traffic is mobile, and Bangladeshi carriers NAT their subscribers through a small number of
gateways — so a visitor in Rajshahi on Grameenphone commonly resolves to Dhaka. The column
will look authoritative and will not be. It should be labelled as approximate, or it will be
used to make decisions it cannot support.

**(d) Retention becomes a real question.** Full IP plus page history plus timestamps is
personal data about identifiable people, kept. The shop already stores `customer_ip` on
orders, so this is not a new category — but it is a much larger volume, about visitors who
never bought anything. A stated retention window is needed (raw rows 30–90 days is the
recommendation), and it should be in the plan rather than discovered later.

## A. What the codebase already gives us

| Need | Already there |
|---|---|
| Browser → server write path | Server actions in [src/app/actions.ts](src/app/actions.ts) — `recordIncompleteCheckoutAction` is the precedent |
| Client IP reaching the API | `forwardClientHints` ([actions.ts:6](src/app/actions.ts:6)), plus the `X-Customer-Ip` handling Caddy strips at the edge |
| Admin screen scaffolding | `AdminShell`, `Card`, and the `useLoad` hook ([use-load.ts](src/lib/admin/use-load.ts)) |
| Per-product view counts | `product_metrics` — **overlaps**, see §F |
| Blocked-IP hit counts | `blocked_ips.hit_count` |
| Ad attribution on orders | `orders.fbc` / `orders.fbp` |

The browser **never** talks to the API directly — only `/uploads` and the courier webhook
are public. So the heartbeat goes through a server action, not a new public endpoint. That
is not a workaround; it is the architecture this shop already has.

---

## B. Where live presence should live: in the API's memory

Not Postgres, and not Redis. Reasoning, because this is the decision everything else rests on:

- **Postgres** would mean an UPDATE per visitor every ~15 seconds, forever, for data whose
  entire lifetime is 30 seconds. On the box that also serves the shop, that is pure churn
  for no durability anybody wants.
- **Redis** is the textbook answer and is genuinely available — the host's 6379 belongs to
  another project, but gng's own Redis container would talk over the private compose
  network and need no host port at all. It still costs a container and ~30MB for something
  a `Map` does, and it only starts paying when there is a second API replica. There is one.
- **In-memory** in the single API process: a `Map<visitorId, { path, startedAt, lastSeen,
  source, device }>`. Losing it on deploy is *correct* — nobody was on the site five
  minutes ago in a way that matters afterwards.

The one rule: sweep expired entries **on read**, never on a timer. A background interval on
this box is a small permanent tax; a sweep during a request the admin already asked for is
free.

**When to revisit:** a second API replica, or a request for history (§E).

---

## C. How the browser reports

A tiny client component mounted once in the shop layout:

```
on mount           → heartbeat(path)          // "I am here"
every 15s          → heartbeat(path)          // only while the tab is VISIBLE
on route change    → heartbeat(newPath)       // closes the old page's timer
on tab hidden      → stop                     // a backgrounded tab is not a visitor
on unload          → sendBeacon(leave)        // best effort
```

Three things worth stating plainly:

- **Pausing on hidden is what makes "time on page" honest.** Without it, every abandoned
  background tab reads as an engaged shopper, and the number quietly becomes fiction.
- **Time on page will still be approximate.** Mobile browsers freeze background tabs and
  `unload` is unreliable, so the last interval before someone leaves is a guess bounded by
  the heartbeat period. Reported as "about", not to the second.
- **The visitor id is a random value in `sessionStorage`**, not the IP and not a durable
  cookie. It dies with the tab, which is exactly the lifetime of the thing being counted.

Cost at this shop's size: 50 concurrent visitors at one beat per 15s is ~3.3 requests a
second through Next. Comfortable. It must still be rate-limited per IP, because the
endpoint is reachable by anyone who can open the site.

---

## D. How the admin sees it: poll, don't stream

A 3–5 second poll on the admin screen, using the existing `useLoad` pattern with an
interval added.

SSE is the more impressive answer and the wrong one here: the stream would have to survive
the Next admin proxy ([route.ts](src/app/api/admin/[...path]/route.ts)) and Caddy, and it
buys sub-second latency for a screen one person looks at occasionally. Polling is a few
lines, degrades to nothing when the tab is closed, and can be swapped for SSE later without
changing the data model.

---

## E. What to show — ranked by what this shop can act on

### Tier 1 — build these

| Panel | Why it earns its place here |
|---|---|
| **Live visitor count** | The thing asked for |
| **Who is on which page** | Path, count, and how long each has been there |
| **Someone is in checkout** | The highest-value signal on a cash-on-delivery shop: the order desk learns a sale is happening *while* it happens, and an abandoned one is already recorded in `abandoned_checkouts` |
| **Where they came from** | fb / ig / direct / organic, from the referrer and the `fbclid`. This shop runs Meta ads and already stores `fbc`/`fbp` on orders — knowing which source is driving live traffic is the most commercially useful number on the screen |
| **What is being viewed right now** | Product-level, so a spike is visible while it is still worth acting on |

### Tier 2 — cheap additions once the above exists

- **Live orders feed** — today's orders appearing as they land, no refresh
- **Device split** — phone vs desktop, from the user agent
- **New vs returning** — a durable cookie, distinct from the session id
- **Right-now funnel** — on site → viewing a product → cart → checkout, as live counts
- **Geography** — from `customer_ip`, at delivery-zone granularity (inside/outside Dhaka), which is the only resolution this shop's pricing cares about

### Tier 3 — deliberately deferred

- **History and trends** ("visitors over 24h/7d"). This is a *different feature*: it needs a
  table, a rollup job and a retention policy, and none of it is real-time. Live and history
  should not be built as one thing — §B's in-memory choice is only correct because nothing
  is being kept.
- **Per-visitor session replay / path trails** — a privacy question, not an engineering one.

---

## E2. Advanced ideas — ranked by value to THIS shop

Ordered by return, not by how impressive they sound. The first four are, in my view, worth
more than everything in Tier 2 combined.

### 1. "Call them now" — the live checkout desk
The shop already records incomplete checkouts *with the phone number the customer typed*
([abandoned_checkouts](backend/src/db/schema/abandoned-checkouts.ts)). Today that becomes a
call list for later. Joined to live presence it becomes: **this person is on the checkout
page right now, here is their number, they have been there 90 seconds.** On a
cash-on-delivery shop where the confirmation call is already part of the process, catching
someone *before* they close the tab is the single highest-value thing this feature can do.
No new data needed — it is a join between two things that already exist.

### 2. Live search terms, especially the ones that find nothing
What people type into search right now, and which searches return zero results. A
zero-result search is a customer telling you exactly what to stock, in their own words.
Cheap: the search endpoint already exists; this is recording the term.

### 3. Ad spend against live traffic
`expenses` (ads) and `product_ad_spend` already exist. Overlay today's spend on live
visitors and you get **cost per visitor, now** — whether the ad running this hour is working,
instead of finding out tomorrow. This is the number that changes what they do today.

### 4. One IP, forty pages a minute — with a block button
`blocked_ips` and its `hit_count` already exist, and the Caddyfile's own comments say order
spam that reserves real stock is a live concern. A live view that surfaces an abusive
pattern and offers one-click block reuses the whole existing defence rather than adding one.

### 5. Stock against live demand
Five people viewing a product with two left is an alert worth having. `stock_quantity` and
`low_stock_threshold` are already there.

### 6. Telegram alerts, through the existing bot
Order alerts already go to Telegram. Extend the same plumbing: "three people in checkout",
"traffic spike", "someone is on checkout with a phone number". No new channel, no new
credential — the shop is already watching that chat.

### 7. A baseline beside the live number
"23 visitors" means nothing alone. "23 now, +40% vs this time yesterday" is a decision.
Once history exists this is nearly free, and it is what makes the trending graph honest.

### 8. Scroll depth per page
One extra field on the heartbeat answers a question the shop cannot currently ask: does
anyone ever reach the description, the specs, the related products? Directly informs whether
the product page's order is right.

### 9. Real user performance, per page
The same beacon can carry Web Vitals. Given the LCP work already done on the gallery and the
banner, measuring what real phones on real Bangladeshi mobile data actually experience closes
that loop — instead of trusting a laptop's numbers.

### 10. Visitor trail, not just current page
With history rows per page visit, a visitor's walk (home → product → cart → left) is already
in the data. Showing the trail turns "12 people on site" into "where they are giving up".

### Deliberately NOT recommending
- **Session replay / mouse tracking.** Enormous privacy cost, heavy payloads, and it answers
  questions scroll depth and trails already answer.
- **A second analytics vendor.** GTM and the Meta pixel are already loaded; adding a third
  script to a shop optimised this hard for LCP would undo real work.

## F. Three things that will bite

**Bots will inflate the count.** Meta's and Google's crawlers hit product pages constantly.
A JS heartbeat already excludes most of them, but not headless ones; filter on user agent
as well and expect the number to still be a little generous. A live counter that is wrong
in an obvious direction is worse than none, because it gets quoted.

**This overlaps `product_metrics`.** That table already counts product views and drives the
Trending rail. The live view must not double-count into it, and the two will disagree —
`product_metrics` counts server renders, presence counts browsers with JS running. Decide
which is authoritative for "views" and say so in the UI, or the two screens will be
compared and mistrusted.

**Privacy.** Presence in memory stores nothing, which is the cleanest possible answer and
worth keeping that way. The moment Tier 3 history is built, IP and path history become
retained personal data and need a stated retention window. Keep the live feature free of
that by not persisting.

---

## G. Phases

**Phase 1 — presence, end to end.** In-memory registry + `heartbeat`/`leave` server actions
+ admin read endpoint. Deliverable: live count and per-page list, on a new `/admin/live`
screen. No history, no charts.

**Phase 2 — the commercial signals.** Traffic source, in-checkout alert, live product views.

**Phase 3 — Tier 2 polish.** Orders feed, device split, funnel, zone.

Each phase is independently useful and independently revertible. Phase 1 with the flag off
is a nav item nobody visits and a `Map` nobody writes to.

---

## H. Key files

| File | Operation |
|---|---|
| `backend/src/modules/presence/*` | Create — registry, service, admin route |
| [src/app/actions.ts](src/app/actions.ts) | Modify — add `heartbeatAction` / `leaveAction` beside the existing ones |
| `src/components/shop/PresenceBeacon.tsx` | Create — the client heartbeat |
| `src/app/(shop)/layout.tsx` | Modify — mount the beacon once |
| `src/app/(admin)/admin/live/page.tsx` | Create |
| `src/components/admin/LiveInsights.tsx` | Create |
| [src/components/admin/AdminShell.tsx](src/components/admin/AdminShell.tsx) | Modify — one nav entry |
| Database | **Untouched in Phase 1** — no migration |

## I. Revised phases, after the decisions above

**Phase 1 — presence + history spine.** Memory registry, 10s heartbeat action, one table of
page visits (enter/leave/duration), `/admin/live` with the live list: full IP, page, and time
on page. City deferred one phase so the GeoIP dependency does not block the useful part.
*Migration: one table.*

**Phase 2 — city, and the graph.** GeoIP database into the API image, city on each visitor,
daily rollups, and the trending-pages graph.
*Migration: one rollups table.*

**Phase 3 — the commercial layer.** Live checkout desk with phone numbers (E2 §1), live
search terms (§2), traffic source.

**Phase 4 — the rest of E2** by whatever turns out to matter after they have watched the
screen for a week. That is deliberate: which of §3–§10 is worth building is much clearer
once real traffic has been observed than it is now.

## J. Open questions

1. **Heartbeat interval** — 15s is my recommendation (accuracy vs load). 30s halves the
   traffic and coarsens "time on page" to within half a minute.
2. **Does "who is on the page" need to identify anyone**, or is a count enough? Showing a
   truncated IP or a city is a different privacy posture than an anonymous count.
3. **History (Tier 3) — wanted now or later?** It changes §B's answer, because durable
   history means a table either way.
4. **Should the live screen be visible to `manager`**, or `admin` and above? The order desk
   is the audience for the checkout alert, but traffic-source data is commercial.

## Sessions

`/multi-plan`'s Codex/Gemini legs did not run — the `ccg-workflow` runtime is not installed
on this machine. This plan comes from reading the storefront's action layer, the admin
shell, the API's module layout and the deployment's constraints.

- CODEX_SESSION: n/a
- GEMINI_SESSION: n/a
