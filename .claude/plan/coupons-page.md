# Plan — a Coupons page, and a coupon field people can see

Two unrelated pieces of work in one request. They share no code, so they can
ship separately and in either order.

- **A.** The checkout coupon field is too quiet — recolour it and make it bigger.
- **B.** A **Coupons** page in the admin sidebar: mint a code without a lead, and
  see every coupon in one list.

Nothing here was written yet. This is a plan.

> `/multi-plan`'s external runtime (`ccg-workflow` → `~/.claude/bin/codeagent-wrapper`
> and `~/.claude/.ccg/prompts/*`) is **not installed on this machine**, so the
> Codex/Gemini passes could not run. Planned with the built-in tools instead. To
> get the multi-model version later: `npx ccg-workflow`, then re-run the command.

---

## Decisions already taken

| Question | Answer |
|---|---|
| Where does Coupons live? | Its own sidebar page, not a tab inside Abandoned |
| What does "generate" mean there? | A coupon with **no lead behind it** — for a customer on the phone |

---

# Part A — the coupon field on checkout

## What is wrong

`src/components/checkout/OrderSummary.tsx:204-214`. Collapsed, it is one line of
grey text:

```tsx
className="mt-3 text-caption text-muted underline-offset-4 hover:text-ink hover:underline"
```

`--text-caption` is **13px** and `--color-muted` is **#6e6e73** — the same
treatment as the "Pay the courier when your order arrives" hint directly beneath
it. So the one tappable thing in that panel looks exactly like the label that is
not tappable, and a customer holding a code does not find it.

## What to change

**Colour → `positive` (green, `#06894a` / `#e8f5ee`).** Not chosen for
prettiness: the *applied* state is already green (`bg-positive-soft`,
`text-positive`), so tapping a green row and getting a green confirmation is one
continuous thing. Red (`sale`) is the price/discount colour on this shop and
would read as an error; orange (`warn`) is the warning colour.

**Size → `text-body` (15px) from `text-caption` (13px)**, medium weight.

**Shape → a full-width tinted row, not a bare text link.** A background and a
border are what make it read as pressable. Roughly:

```tsx
// collapsed state — pseudo-code, not final markup
<button
  type="button"
  onClick={() => setOpen(true)}
  className="mt-3 flex w-full items-center justify-center gap-2 rounded-sm
             border border-positive/30 bg-positive-soft px-3 py-2.5
             text-body font-medium text-positive hover:opacity-90"
>
  <Icon name="bolt" size={16} />
  কুপন কোড আছে?
</button>
```

**Open the input at `text-body` too**, so the code the customer is reading back
is not 13px.

## Points worth arguing about before it is built

1. **Bengali or English label.** Every other string in the checkout panel comes
   from `src/lib/copy.ts` and is English (`couponPlaceholder: "Coupon code"`).
   Putting one Bengali line in the middle of an English panel is inconsistent —
   but the WhatsApp message that carries the code is Bengali, so the customer
   arriving from it is reading Bengali seconds earlier. **Recommendation:**
   Bengali, and add it to `copy.ts` rather than inlining, so the panel has one
   place strings live.
2. **A green row shown to every shopper advertises a discount most of them do
   not have.** That is exactly the risk the collapsed grey line was avoiding —
   see the comment on `CouponField`. Louder is what was asked for, and it is the
   right call for the people who *were* sent a code; the cost is more shoppers
   leaving to hunt for one. **Mitigation worth taking:** keep it quiet on a cart
   nobody was messaged about, and go loud when the code arrived in the link
   (`?c=`) — that shopper already has one. One condition, `couponCode !== ""`.
   Flagged rather than assumed: say if you want it loud for everyone.

## Files

| File | Operation |
|---|---|
| `src/components/checkout/OrderSummary.tsx:204-214` | Recolour + resize the collapsed button |
| `src/components/checkout/OrderSummary.tsx:246-292` | Input and Apply to `text-body` |
| `src/lib/copy.ts:138-141` | Add the label string beside the existing coupon copy |

## Verification

- Browser, checkout with a cart: the row is visible at a glance beside the grey
  hint under it.
- Both states still work: Apply by button, and Enter — **which must still not
  submit the checkout form**. That was a real bug once already; re-check
  `outerFormSubmits === 0`.

---

# Part B — the Coupons page

## The good news: no migration is needed for the main feature

`recovery_coupons.abandoned_checkout_id` is **nullable**
(`backend/src/db/schema/recovery-coupons.ts:64`), and the one-active-per-lead
unique index is **partial**:

```sql
WHERE status = 'active' AND abandoned_checkout_id IS NOT NULL
```

So a coupon with no lead is already legal, and any number of them can be active
at once. The schema was built this way; nothing about it has to change.

## B1 — backend

### 1. Let `generate()` work without a lead

`backend/src/modules/orders/recovery-coupon.service.ts:153`. Today it takes
`{ checkoutId, actor }` and unconditionally loads the lead.

```ts
// pseudo-code
export async function generate(input: {
  checkoutId?: string | null;   // now optional
  note?: string;                // who it is for, when there is no lead
  actor: LeadActor;
}): Promise<{ coupon: CouponDto; created: boolean }> {

  if (!input.checkoutId) {
    // Standalone. No lead to check, so none of the lead guards apply:
    //   - no "already ordered" check      (no customer attached)
    //   - no "do not contact" check       (nobody was contacted)
    //   - no minimum-cart-value floor     (there is no cart to measure)
    // cartValue is 0 and MEANS zero here, not "a free basket".
    await sweepExpired(db);
    return insertWithRetry({ abandonedCheckoutId: null, cartValue: 0, note });
  }

  ...everything the lead path does today, unchanged...
}
```

**The min-cart floor silently not applying is the one thing to be deliberate
about.** The setting exists to stop the shop paying a delivery charge to rescue
a basket worth less than the courier. A standalone coupon has no basket, so the
rule has nothing to measure and cannot be enforced — the person typing it is
deciding by hand. The page should say so in one line rather than let an owner
believe the floor is protecting them.

### 2. A `note` column — migration 0032, additive

Without it the standalone list is a column of anonymous six-character codes and
the report answers nothing. One nullable text column:

```sql
ALTER TABLE "recovery_coupons"
  ADD COLUMN IF NOT EXISTS "note" text NOT NULL DEFAULT '';
```

Register in `backend/migrations/meta/_journal.json` **by hand** — `drizzle-kit
generate` on this repo produces a destructive migration, because only 13 of the
32 snapshots exist. (This bit the project once already.)

Add `note` to the schema file and to `CouponDto`.

### 3. `listCoupons()` — new reader

There is no coupon list reader; the old `recent()` was deleted as dead code.

```ts
// pseudo-code
export async function listCoupons(options: {
  state?: CouponState;           // filtered in SQL for used/cancelled,
                                 // and on expires_at for active/expired
  limit?: number;                // default 100
}): Promise<(CouponDto & {
  phone: string | null;          // from the lead, when there is one
  orderNumber: string | null;    // from the order it was spent on
})[]> {
  // left join abandoned_checkouts, left join orders
  // order by created_at desc
}
```

**Expiry must be derived from `expires_at`, not read from `status`** — the same
rule the rest of this feature follows, so the list agrees with itself whether or
not the nightly sweep has run.

### 4. Summary counts

`couponTotals()` already exists but is **private** inside
`backend/src/modules/reports/recovery.service.ts:170`. Export it, or move it
into the coupon service and have the recovery report import it. Moving it is
better — it is a fact about coupons, not about recovery.

### 5. Routes

New file or an addition to `abandoned.routes.ts`:

```
GET    /api/v1/admin/coupons?state=&limit=    list + summary
POST   /api/v1/admin/coupons                  { note? } → mint a standalone one
DELETE /api/v1/admin/coupons/:id              cancel — `cancel()` already exists
```

`manager` and above, like the rest of the desk's work.

### 6. **The proxy allow-list — do not forget this one**

`src/app/api/admin/[...path]/route.ts`. Add:

```ts
/^admin\/coupons(\/.*)?$/,
```

This is the exact step that was missed on the recovery report and shipped a
screen reading "Unknown admin endpoint" to production. The API had the route,
the tests hit the API directly, and the one hop in between was the one nothing
exercised. **Assert it, do not eyeball it** — the little script that tests each
path string against the parsed `ALLOWED_PATHS` caught it in seconds.

## B2 — frontend

| File | Operation |
|---|---|
| `src/app/(admin)/admin/coupons/page.tsx` | New route |
| `src/components/admin/CouponsPage.tsx` | New — generate form + list |
| `src/components/admin/AdminShell.tsx:41` | Nav entry, under Abandoned |
| `src/components/admin/RecoveryReport.tsx:179` | Drop the "Offers" block (see below) |

**Nav:** `{ href: "/admin/coupons", label: "Coupons", icon: "checkCircle" }`.
There is no ticket or tag glyph in `Icon.tsx`; `checkCircle` is free and reads
closest. Adding a proper ticket path to `Icon.tsx` is a small, separate job if
you would rather have one.

**The page:**

```
Coupons                                    [ All | Active | Used | Expired ]

┌ Make a coupon ─────────────────────────────────────────┐
│ Who is it for?  [ Rahim — phone order            ]      │
│ Free delivery · one use · 24 hours                      │
│ No minimum basket applies to a coupon made here.        │
│                                        [ Create ]       │
└─────────────────────────────────────────────────────────┘
        ↓ after creating
┌─────────────────────────────────────────────────────────┐
│  HN7K2P     Active · 24 hours left      [Copy]          │
└─────────────────────────────────────────────────────────┘

Created 12 · Running 3 · Used 5 · Ran out 4 · Cost ৳400

Code    For              Made      Expires   State   Order
J6GL4H  Rahim (phone)    30 Aug    31 Aug    Active   —
UR4GML  01715946491      29 Aug    30 Aug    Used     HINAR-10034
```

The **code is the largest thing on each row**, for the same reason the phone
number is largest on a lead card: it is what somebody reads out or copies.

## The overlap you should decide about

The Abandoned → Report tab already draws an **Offers** block with
created/running/used/expired/cancelled — the same five numbers this page will
show. Two screens, one set of figures, is the thing that was deliberately
avoided when the report was moved off Performance.

**Recommendation:** drop the Offers block from the recovery report and leave it
to say what it is uniquely about — how many leads came back, and by which route.
Coupons as objects belong on the Coupons page. Say if you would rather keep both.

## Risks

| Risk | Mitigation |
|---|---|
| Proxy allow-list missed again → "Unknown admin endpoint" | Assert every new path against the parsed list before shipping |
| Standalone coupons bypass the min-cart floor without anybody noticing | One line on the form saying so |
| `drizzle-kit generate` writes a destructive migration | Hand-write 0032 and the journal entry, as with 0029–0031 |
| Two screens showing the same coupon counts | Remove the Offers block from the recovery report |
| Codes minted with no note become unidentifiable | `note` column in the same migration, not "later" |

## Tests to add (`backend/tests/recovery.test.ts`)

- mints a coupon with no lead behind it
- a standalone coupon is spent exactly like a lead's, and refused twice
- the minimum-basket floor does not apply to one, and the lead path still obeys it
- several standalone coupons can be active at once — the one-per-lead index
  must not catch them
- the list reports expiry from the timestamp, before any sweep has run
- both new routes are closed to the public

## Order to build in

1. Part A alone — one file, visible immediately, no schema.
2. B1 migration + service + routes + **proxy allow-list**, with tests.
3. B2 page and nav.
4. Remove the Offers block from the recovery report.

Parts A and B touch no common file and can ship independently.

## SESSION_ID

None — the external multi-model runtime is not installed on this machine, so no
Codex or Gemini session was created. `/ccg:execute` will have nothing to resume;
build straight from this file.
