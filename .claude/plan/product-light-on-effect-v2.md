# Implementation Plan v2: "The light turns on" — scoped to the Light category, built to be undone

> Supersedes `product-light-on-effect.md`. Planning document only; no production code modified.
> Changes in v2: scope decided (Light category), reversibility promoted to a design constraint,
> and the real product data pulled down from the VPS for the localhost trial.

## Your three answers, and what they change

1. **Scope** — the shown product *or* anything in the Light category → **key on the category**, not the product.
2. **Reversibility** — must be able to put things back the way they were → this is now a **constraint on the design**, not a note at the end. It rules out one whole class of implementation (see below).
3. **Local data** — pull the product and its images from the VPS → **done**, see "Trial data".

---

## Scope: verified against the live database

```
categories on the VPS:   gadget (1 product) · islamic (1) · light (1)
the light category:      led-magnetic-desk-lamp — "LED Magnetic Desk Lamp
                         Touch & Remote Control", 7 images, no variants
```

So today "the Light category" and "the product you showed" are the same single product —
but keying on the category means the next lamp you add is covered with no code change.

### One correctness trap, already found

The storefront's `Product` object carries **`categoryId` (a UUID), not the slug**
([types/index.ts:82](src/types/index.ts:82)). Hard-coding that UUID would work on the
VPS and silently fail on localhost, because the two databases mint different ids —
the effect would simply never appear during the trial and we would go looking for a
bug in the animation.

So the category is resolved **by slug, on the server**: `page.tsx` already runs at
build/revalidate time, `getCategories()` ([catalog.ts:48](src/lib/data/catalog.ts:48))
is already cached and tagged, and the page is `revalidate = 300` — so this costs
nothing per visitor. It passes a plain boolean down.

---

## Reversibility — three ways out, in order of effort

This is the requirement that shapes the code, so it is stated first.

| | How to undo | Effort | What it leaves behind |
|---|---|---|---|
| **1. Switch off** | `LIGHT_CATEGORY_SLUGS = []` — one line | seconds + one deploy | Dead code, zero runtime effect |
| **2. Revert the commit** | `git revert <sha>` | seconds + one deploy | Nothing |
| **3. Never merge it** | Build it on a branch, trial on localhost, delete the branch | nothing | Nothing |

**Recommended: (3) then (2).** Build on a branch, judge it on localhost, and only
merge if you like it. If it merges and later annoys you, `git revert` puts the page
back exactly — no migration to unwind, no data to fix, no admin setting left stranded.

### The design rules that make those three actually true

- **Nothing in the backend.** No new column, no migration, no API field, no admin
  toggle. This is the class of implementation reversibility rules out: a stored
  `effect` flag would mean a migration to write and a migration to undo, and the
  undo is the part people skip. The category already exists and already carries the
  meaning "this is a lamp".
- **No product data is touched.** Nothing is written to any product row, so there is
  nothing to clean up.
- **Purely additive in the frontend.** Two new files, plus a handful of lines in two
  existing ones. No logic inside `Gallery.tsx` changes.
- **`Gallery.tsx`, `ProductCard.tsx`, `BannerSlider.tsx` are not touched at all** —
  they still hold your uncommitted LCP work (see the warning below).
- **Off means genuinely absent.** Loaded through `next/dynamic`, so a non-Light
  product page never downloads the chunk — no glow, no slider, no timers, and no
  extra JavaScript. Reverting cannot leave a performance tail behind.
- **One isolated commit**, touching nothing else, so the revert cannot conflict.

---

## Trial data — already downloaded from the VPS

Pulled read-only into the scratchpad. **Deliberately catalogue tables only** —
`admins` (password hashes) and `settings` (courier key, Telegram bot token, Meta CAPI
token) were excluded; there is no reason for production secrets to sit on this laptop.

| File | Contents |
|---|---|
| `…/scratchpad/vps-catalog/catalog-data.sql` | `--data-only --inserts`: 3 categories, 3 products, 17 product images, 0 variants |
| `…/scratchpad/vps-catalog/uploads.tar.gz` | 2.6 MB, 35 files (20 product photos incl. the lamp's 7) |

The lamp's seven storage keys are confirmed present in the archive.

**Loading it locally** (execution step, not done yet):

```bash
# 1. schema, then the real catalogue on top
npm --prefix backend run db:migrate
#    apply catalog-data.sql to the PGlite database at backend/.pglite

# 2. the photos, where the local API expects them (UPLOAD_DIR=./uploads)
tar -xzf uploads.tar.gz -C backend/uploads
```

Local runs on **PGlite** (`DATABASE_DRIVER=pglite`), so no Docker and no Postgres
server — and production is never touched by the trial.

---

## Implementation steps

1. **Branch** — `feat/product-light-scene`, so step 3 of the reversibility table is
   available for free.

2. **`src/lib/product-light.ts`** — the switch and the rule, in one small file:
   ```ts
   /** Empty this array to turn the effect off everywhere. */
   export const LIGHT_CATEGORY_SLUGS = ["light"];

   export function isLightProduct(
     product: Product,
     categories: Category[],
   ): boolean {
     if (LIGHT_CATEGORY_SLUGS.length === 0) return false;
     const slug = categories.find((c) => c.id === product.categoryId)?.slug;
     return slug != null && LIGHT_CATEGORY_SLUGS.includes(slug);
   }
   ```
   *Deliverable:* the whole scoping decision in one greppable place.

3. **`src/lib/hooks/use-light-scene.ts`** — brightness level, the arrival sequence,
   and its three suppression rules (reduced motion, once per tab, bfcache restore).
   Unchanged from v1.

4. **`src/components/product/LightScene.tsx`** — glow layer, subject wrapper, and the
   dimmer, all driven by one CSS custom property. Renders `children`, so it knows
   nothing about galleries. Unchanged from v1.

5. **Wire it up** — `page.tsx` resolves the boolean; `ProductPurchase.tsx` wraps
   `<Gallery>` at [line 203](src/components/product/ProductPurchase.tsx:203):
   ```tsx
   // page.tsx  (server)
   const categories = await getCategories();          // already cached + tagged
   const lit = isLightProduct(product, categories);
   <ProductPurchase product={product} lit={lit} />

   // ProductPurchase.tsx  (client)
   const LightScene = dynamic(() => import("./LightScene"));   // off ⇒ never fetched
   ...
   {lit ? <LightScene><Gallery … /></LightScene> : <Gallery … />}
   ```
   *Deliverable:* effect on Light products, every other page byte-identical.

6. **Load the trial data** and run both dev servers.

7. **Measure** — LCP and CLS before/after on a throttled mobile profile, and a look
   in the Facebook in-app browser, which is where this shop's traffic actually is.

8. **Your verdict** — merge, or delete the branch.

---

## Key files

| File | Operation | Description |
|---|---|---|
| `src/lib/product-light.ts` | Create | The switch + category rule |
| `src/lib/hooks/use-light-scene.ts` | Create | Level state, arrival sequence, suppression |
| `src/components/product/LightScene.tsx` | Create | Glow, subject wrapper, dimmer |
| [page.tsx:59](src/app/(shop)/product/[slug]/page.tsx:59) | Modify (+2 lines) | Resolve the category slug server-side |
| [ProductPurchase.tsx:203](src/components/product/ProductPurchase.tsx:203) | Modify (+4 lines) | Conditional dynamic wrapper |
| [globals.css:177](src/app/globals.css:177) | Modify | Reduced-motion rule beside the existing block |
| `Gallery.tsx` / `ProductCard.tsx` / `BannerSlider.tsx` | **Untouched** | Your uncommitted work lives here |
| Backend, migrations, product data | **Untouched** | Nothing to undo |

## ⚠️ Still outstanding from v1

`Gallery.tsx`, `ProductCard.tsx` and `BannerSlider.tsx` have **49 lines of
uncommitted LCP work** in your tree (`preload` → `fetchPriority`, corrected `sizes`
maths). This plan avoids those files entirely, but step 7 measures precisely the
metric those edits move — so they should be committed first, or the before/after
number will be measuring two changes at once and crediting the wrong one.

## Risks and mitigation

| Risk | Mitigation |
|---|---|
| Hard-coded category UUID would work on the VPS and fail on localhost | Resolved by slug, server-side — the trap is already designed out |
| It reads as a gimmick and costs sales | Trial on a branch; once per tab; under a second; never covers the Buy button |
| Filter janks on mid-range Android inside the Facebook in-app browser | One element filtered, only `filter`/`opacity` transitioned; tested there specifically in step 7 |
| Hero is the LCP element; a dark first paint reads as slower | The image loads and paints exactly as now, only filtered. Measured in step 7 |
| Effect silently spreads to a non-lamp put in the Light category | That is the intended behaviour of a category rule — worth knowing, not fixing |
| Local trial data drifts from production | It is a snapshot for looking at, never written back; production is untouched |

## Test plan

- [ ] Light product: arrival plays once, dimmer works by mouse, touch and keyboard
- [ ] `LIGHT_CATEGORY_SLUGS = []`: page identical to today, chunk not downloaded
- [ ] Gadget and Islamic products: no glow, no slider, no extra JS
- [ ] Reduced-motion on: renders fully lit, no transition, dimmer still usable
- [ ] Second visit in the same tab, and bfcache back-navigation: no replay, no dark flash
- [ ] 390px: nothing overlaps the price or the sticky Buy bar
- [ ] LCP / CLS before and after, throttled mobile
- [ ] Facebook in-app browser on a real mid-range Android
- [ ] `git revert` of the single commit restores the page exactly

## Sessions

`/multi-plan`'s Codex/Gemini legs did not run — the `ccg-workflow` runtime is not
installed on this machine. This plan comes from reading the code, and from the live
database and uploads on the VPS.

- CODEX_SESSION: n/a
- GEMINI_SESSION: n/a
