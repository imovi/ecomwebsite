# Plan — Meta CAPI Event Match Quality (2.5/10 → 6+)

> Produced WITHOUT the `ccg-workflow` dual-model pass — `~/.claude/bin/codeagent-wrapper`
> and `~/.claude/.ccg/prompts/*` are not installed on this machine, and the `ace-tool`
> MCP is not connected. Context was gathered with the documented fallback (Glob /
> Grep / Read). There are therefore **no Codex or Gemini sessions to resume**; see the
> SESSION_ID section at the foot.

## Task Type

- [x] Backend (the bulk of it)
- [x] Frontend (`fbc` / `fbp` capture only)
- [x] Database migration

---

## Diagnosis — confirmed against the code

The brief's diagnosis is correct. Verified:

`backend/src/modules/marketing/meta-capi.service.ts:192`

```ts
user_data: hashedPhone ? { ph: [hashedPhone] } : {},
```

One match key. Meta grades match quality on how many keys it can resolve to a
person, so a single unverified-in-BD signal scoring 2.5/10 is the expected
result, not a mystery.

Two further facts the brief did not have, both of which change the plan:

**1. The order event does not carry what the payload needs.**
`backend/src/lib/events/order-events.ts` — `OrderCreatedEvent` carries
`customerName`, `phone`, `address`, `areaText`, `deliveryZone` … but **not**
`customerIp` and **not** `userAgent`. Both exist on the order row
(`backend/src/db/schema/orders.ts:87-88`) and are set at
`backend/src/modules/orders/checkout.service.ts:447-448`. So step 3 of the
brief's Fix 1 is required, not conditional.

**2. `placeOrderSchema` is `.strict()`.**
`backend/src/modules/orders/order.validation.ts` rejects any unknown body field
outright. Adding `fbc` / `fbp` to the request body without adding them to the
schema does not silently ignore them — it **422s every checkout**. This is the
single most dangerous step in the whole plan and it is on the money path.

---

## Already done, not yet shipped

The brief's closing note — *InitiateCheckout should not fire until name and phone
are given* — **is already implemented** in the working tree
(`src/components/checkout/CheckoutForm.tsx`), verified in a browser:

| State | Fires? |
|---|---|
| Checkout opened, nothing typed | no |
| Name only | no |
| Name + partial phone | no |
| Name + complete phone | **yes**, once |

It is **uncommitted and undeployed**. It belongs in Phase 0 below rather than
being re-planned.

Note it gates GA4 `begin_checkout` too, since one function fires both.

---

## Technical Solution

Three phases, deliberately ordered so each one can ship and be measured before
the next. Phase 1 is cheap and safe; Phase 2 touches the checkout write path and
carries real risk; Phase 3 is optional and needs a decision.

### Phase 0 — ship what is already written

No new code. Commit and deploy the InitiateCheckout gate so the funnel numbers
stop being contaminated while the rest of this work lands.

### Phase 1 — send what the database already has (backend only, no migration)

Target `user_data`:

| Meta field | Source | Hashed |
|---|---|---|
| `ph` | `orders.phone` (already) | SHA-256 |
| `fn` | first token of `customer_name` | SHA-256 |
| `ln` | remaining tokens of `customer_name` | SHA-256 |
| `country` | literal `bd` | SHA-256 |
| `ct` | derived city — **see decision D1** | SHA-256 |
| `external_id` | same normalised phone — **see decision D2** | SHA-256 |
| `client_ip_address` | `orders.customer_ip` | **RAW** |
| `client_user_agent` | `orders.user_agent` | **RAW** |

Normalisation before hashing: trim, lowercase, strip punctuation. `hashPhone()`
already does the phone-specific form; add a sibling `hashField()` rather than
generalising `hashPhone` — the phone rule (E.164 without `+`) is not the same
rule as the text rule and merging them is how the phone match silently breaks.

Omit any field whose source is empty. Never send an empty string — Meta treats
`""` as a supplied-but-unmatchable key.

**Data-quality note:** `orders.customer_ip` is only trustworthy as of the
X-Forwarded-For fix deployed earlier today. Before that it could hold a
client-forged value. Only new orders are reported, so this is a non-issue — but
it does mean `client_ip_address` would have been actively harmful a week ago.

### Phase 2 — capture and send `fbc` / `fbp`

The strongest single signal, because `_fbc` encodes the exact ad click.

Flow: browser cookie → server action → API body → `orders` row → order event →
CAPI payload.

Storage is required rather than passing straight through: the CAPI send happens
on the order event bus after commit, and a value held only in the request would
be lost on any retry or replay.

### Phase 3 — the fake AddToCart (optional, decision D3)

`src/lib/analytics/pixel.tsx:49` calls `fbq('init', pixelId)` with Meta's
`autoConfig` left at its default of **on**, which enables automatic event
detection — Meta guessing at button clicks. That is the most likely source of
**3.2K AddToCart against 100 ViewContent**, a ratio no real funnel produces.

This is NOT a free fix — see D3.

---

## Implementation Steps

### Phase 0

1. Commit the InitiateCheckout gate. Deploy. — *funnel stops counting non-intent*

### Phase 1

2. `meta-capi.service.ts` — add `hashField(value: string): string | null`
   (trim → lowercase → strip punctuation → SHA-256; null on empty).
   — *unit-testable pure function*
3. `meta-capi.service.ts` — extend `PurchaseEvent` with
   `customerName?`, `city?`, `clientIp?`, `userAgent?`. All optional, so
   the existing test callers keep compiling. — *type change only*
4. `meta-capi.service.ts` — build `user_data` from every present field,
   raw for the two `client_*` keys. — *the actual payload*
5. `order-events.ts` — add `customerIp: string | null` and
   `userAgent: string | null` to `OrderCreatedEvent`. — *the missing carrier*
6. `checkout.service.ts` — populate both on the `orderEventBus.emit` call from
   `created.order`. — *data reaches the bus*
7. `meta.subscriber.ts` — pass the new fields into `trackPurchase()`.
   — *end of the wire*
8. Backend `npm run verify` (typecheck + lint + 326 tests). — *green*

### Phase 2

9. `orders.ts` schema — add `fbc: text("fbc")` and `fbp: text("fbp")`, both
   nullable. — *columns*
10. `npm run db:generate` → review the emitted SQL → commit it as
    `migrations/0021_meta_click_ids.sql`. — *reviewed DDL, per this repo's convention*
11. `order.validation.ts` — add `fbc` and `fbp` to `placeOrderSchema` as
    `safeString({ max: 255 }).nullish()`. **Without this the `.strict()` schema
    422s every order.** — *the dangerous one*
12. `checkout.service.ts` — persist both on insert, alongside `customerIp`.
    — *stored*
13. `order-events.ts` + `meta.subscriber.ts` + `meta-capi.service.ts` — carry
    them through and send RAW (never hashed). — *sent*
14. `src/lib/analytics/fb-click-id.ts` (new) — read `_fbc` / `_fbp` cookies;
    synthesise `fb.1.<ms>.<fbclid>` from the `fbclid` search param when `_fbc`
    is absent. — *client helper, unit-testable*
15. `CheckoutForm.tsx` — read both at submit, pass to `placeOrderAction`.
    `src/app/actions.ts` — add to `CheckoutInput` and the request body.
    — *frontend wired*
16. Full verify: backend tests, `tsc --noEmit` both apps, `next build`.
17. **Place one real test order on a staging or live shop with a
    `test_event_code` set**, confirm field count in Events Manager → Test events.

### Phase 3 (only if D3 is approved)

18. `pixel.tsx` — `fbq('set', 'autoConfig', false, pixelId)` before `init`.

---

## Key Files

| File | Operation | Description |
|---|---|---|
| `backend/src/modules/marketing/meta-capi.service.ts:47-56` | Modify | `PurchaseEvent` gains 4 optional fields |
| `backend/src/modules/marketing/meta-capi.service.ts:65-76` | Add | `hashField()` beside `hashPhone()` |
| `backend/src/modules/marketing/meta-capi.service.ts:192` | Replace | full `user_data` |
| `backend/src/modules/marketing/meta.subscriber.ts:29-41` | Modify | pass new fields |
| `backend/src/lib/events/order-events.ts:28-64` | Modify | event carries ip / ua / fbc / fbp |
| `backend/src/modules/orders/checkout.service.ts:~447` | Modify | persist fbc/fbp; emit ip/ua |
| `backend/src/modules/orders/order.validation.ts` | Modify | **`.strict()` — must accept fbc/fbp** |
| `backend/src/db/schema/orders.ts:84-89` | Modify | two nullable text columns |
| `backend/migrations/0021_*.sql` | Add | generated, reviewed, committed |
| `src/lib/analytics/fb-click-id.ts` | Add | cookie reader + fbclid synthesis |
| `src/components/checkout/CheckoutForm.tsx` | Modify | read cookies at submit |
| `src/app/actions.ts` | Modify | `CheckoutInput` + body |
| `src/lib/analytics/pixel.tsx:49` | Modify | Phase 3 only |

---

## Risks and Mitigation

| Risk | Severity | Mitigation |
|---|---|---|
| `.strict()` rejects `fbc`/`fbp` → **every checkout 422s** | **Critical** | Schema change in the same commit as the client change; place a real test order before deploy; keep the two client fields `.nullish()` so an old cached bundle still works |
| Hashing `client_ip_address` / `client_user_agent` | High | They are the only two raw fields — assert it in a unit test, not just a comment |
| `event_id` dedup broken → double-counted sales | High | `event_id` stays `orderNumber`; do not touch. Verify count does not jump after deploy |
| Migration on a live DB | Medium | Two nullable columns, no default, no backfill — non-locking on Postgres 17 |
| Old browser bundle posts without fbc/fbp after deploy | Low | Fields optional end-to-end |
| Empty-string fields sent as match keys | Medium | `hashField()` returns null on empty; omit rather than send `""` |
| Match quality does not move | Medium | 24–48h lag is expected. Judge on the Test-events field count first (1 → 7-9), not on the score |

---

## Decisions needed before implementation

**D1 — what to send as `ct` (city).**
The brief says `area_text`. That is free text the customer typed
("Dhanmondi, Dhaka"); Meta normalises `ct` by lowercasing and stripping spaces,
so it becomes `dhanmondidhaka` and matches nothing. Options:

- **(a)** Send raw `area_text` as specified. Simple, probably never matches.
- **(b) Recommended.** Derive it: `deliveryZone === "inside_dhaka"` → `dhaka`;
  otherwise use the district token `suggestDeliveryZone()` already resolves
  (`backend/src/lib/geo/delivery-zone.ts` holds all 64 districts plus Bangla and
  misspelling aliases). Requires exporting a small helper from that module.
- **(c)** Omit `ct` entirely and rely on the other six keys.

**D2 — send `external_id`?**
Hashed phone can be sent as both `ph` and `external_id`. Meta counts it as a
separate key, so it can lift the score. It is the same underlying data, so it is
not new information about the customer — no additional privacy cost, but also
arguably gaming the metric. Include or not?

**D3 — turn off `autoConfig` to kill the fake AddToCart?**
It would stop Meta's automatic event detection — almost certainly the source of
the 3.2K phantom AddToCart. **But the same flag also disables Automatic Advanced
Matching**, which scrapes form fields and sends them hashed with *browser*
events, and that is a match-quality feature you are currently trying to increase.
Options:

- **(a) Recommended.** Leave the code alone; turn off *automatic events* only,
  from Events Manager → pixel settings, where the two are separate toggles.
  Keeps Advanced Matching.
- **(b)** Set `autoConfig:false` in code. Kills both. Cleaner AddToCart numbers,
  weaker browser-side matching.
- **(c)** Do nothing — AddToCart is not what any campaign optimises on today.

---

## Out of scope (from the brief, agreed)

- The "prices are the same for all Purchase events" warning — one product, one
  price. Not a bug.
- No browser-side Purchase — server-only stays, dedup risk not worth it.
- No campaign optimisation change to Purchase (7 events; ~50/week needed).
  InitiateCheckout is the next step **after** match quality is fixed — and note
  the Phase 0 gate will reduce that 47 somewhat, since it now counts intent
  rather than arrival.

---

## Verification

1. Events Manager → Test events, with `metaTestEventCode` set in admin settings:
   `user_data` field count **1 → 7-9**.
2. Events Manager → Purchase → Event match quality: **2.5 → 6+**, allow 24-48h.
3. Purchase event count must **not** rise — dedup intact.
4. Backend `npm run verify` green (326 tests), both apps typecheck, `next build`
   passes.
5. After deploy: place one real order; confirm it appears once in Events Manager
   and once in the admin panel.

---

## SESSION_ID (for `/ccg:execute`)

- CODEX_SESSION: *not available — `ccg-workflow` runtime not installed*
- GEMINI_SESSION: *not available — `ccg-workflow` runtime not installed*

To get the dual-model pass, run `npx ccg-workflow` first, then re-run
`/multi-plan`. This plan is executable as-is without it.
