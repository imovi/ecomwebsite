# Implementation Plan: Interactive Product Image System (ON/OFF)

> Planning document. No production code modified.
> Written against the spec of 2026-08-13, checked line by line against the codebase.

## Summary

The spec is clear and mostly buildable as written. Three things need your decision
before code starts, and four spec items describe a system slightly different from the
one this repo actually is. Everything else is straightforward.

---

## A. Things in the spec that do not exist here

Items 1 and 39 list functionality that must not break. Three of them are not in the
codebase at all, so there is nothing to preserve — flagging it only so you are not
expecting them later:

| Listed | Reality |
|---|---|
| Image zoom | **Does not exist.** The gallery is scroll-snap + thumbnails; no zoom anywhere |
| Wishlist | **Does not exist.** Zero references in the whole storefront |
| Reviews | **Deliberately absent** — [page.tsx:62](src/app/(shop)/product/[slug]/page.tsx:62) explains why, and `ProductPurchase` uses trust signals instead |

Everything else on those lists is real and will be preserved: title, price, gallery,
side thumbnails, navigation, description, variants, quantity, Add to Cart, Buy Now,
related products, spacing, responsive behaviour.

---

## DECISIONS TAKEN (2026-08-13)

1. **The existing gallery image is the ON state.** Confirmed by opening the lamp's own
   photos: every one of them shows the lamp lit. The admin uploads only the **OFF**
   (unlit) counterpart. Default state is ON, which therefore needs no new image at all
   — the page on first paint is exactly the page that exists today.
2. **Gallery gets one additive optional prop** (§C) rather than an overlay.
3. **WebP stays; no AVIF** (§D) — the note already in `next.config.ts` holds.
4. **Toggle labels come from the state row**, defaulting to ON/OFF, so the system stays
   generic per §33.

5. **Existing gallery images are never touched.** The feature is per product and opt-in:
   a product with it OFF renders exactly as today, loading no extra image and no extra
   JavaScript. A product with it ON keeps every existing photo exactly where it is and
   simply gains an OFF counterpart for the frames the admin uploads one for.

   A frame with no OFF image uploaded has no pair, so it shows no toggle. That needs no
   special rule — it is just the absence of a row.

## B. Decision 1 — is the gallery image the OFF image, or a third picture?

This is the one that changes the data model, the admin work, and what the shopper sees.

Spec §14 shows the admin uploading **both** an OFF and an ON image per pair, with the
gallery image only "automatically mapped". Read literally, an interactive product has
three pictures per slot: the original gallery photo, an OFF upload, and an ON upload —
and the main image area would show a picture that the thumbnail beneath it does not
match.

| | Option A — gallery image **is** the OFF image *(recommended)* | Option B — separate OFF and ON uploads, as written |
|---|---|---|
| Admin uploads | One image per pair (the ON version) | Two per pair |
| Thumbnail vs main | Always the same shot | Can differ, unless the admin uploads the gallery photo twice |
| Data | `on_image` per gallery image | `off_image` + `on_image` per gallery image |
| Existing lamp | 7 photos → 7 ON uploads | 7 photos → 14 uploads |
| Risk | None; OFF is already on the page | Admin must keep three pictures aligned per slot |

**Recommendation: A.** It halves the upload work, makes thumbnail and main image agree
by construction, and cannot drift. The DB stays future-proof either way (see §F): the
schema stores states as rows, so an explicit OFF row can be added later without a
migration if you ever want a distinct off-shot.

## C. Decision 2 — "existing gallery unchanged" is stricter than it can be

Spec §2 and §9 say the gallery component must not be modified. Worth being precise,
because the strict reading forces a worse result:

`Gallery.tsx` renders thumbnails **and** the main frames from the same `images` array
([Gallery.tsx:127](src/components/product/Gallery.tsx:127)). To show a different
picture in the main frame there are exactly two options:

- **Zero edits to Gallery** → the ON image must be an absolutely-positioned overlay on
  top of the rail. The rail scrolls horizontally, so during a swipe the overlay does
  not travel with the frame underneath it and the two visibly separate. It also has to
  be `pointer-events: none` or it eats the swipe.
- **One additive prop on Gallery** → an optional `mainImages` (defaulting to `images`)
  or an optional per-frame overlay slot. About five lines, no behaviour change when the
  prop is absent: same scroll-snap, same thumbnails, same auto-advance, same swipe.

**Recommendation: the additive prop.** It honours what §2 is actually protecting — the
gallery's *behaviour* — while the strict no-edit reading breaks swiping, which is the
behaviour §37 says to preserve.

## D. Decision 3 — AVIF conflicts with a decision this repo already made

Spec §27 asks for AVIF with WebP fallback. This repo **deliberately turned AVIF off**,
with the reasoning written down at [next.config.ts:128](next.config.ts:128): AVIF is
10–20% smaller than WebP and costs several times the CPU to encode; there are thirteen
breakpoints; the source images are already WebP at quality 82; and the same 2-vCPU box
renders the shop and the admin panel. First request for each size competes with page
rendering.

Related: §19 asks the backend to generate responsive sizes at upload. Next already
generates them on demand and caches them in a persistent volume
([docker-compose.yml](docker-compose.yml), `next-cache`), so doing it again at upload
would duplicate both the CPU and the storage.

**Recommendation: keep WebP-only and keep responsive sizes on demand.** Everything else
in §17–§32 is already true today: `optimizeImage`
([optimizer.ts:69](backend/src/lib/images/optimizer.ts:69)) decodes, validates, resizes
and re-encodes every upload to WebP at quality 82, and `next/image` emits `srcset` and
`sizes`. If you want AVIF anyway, it is one line in `next.config.ts` — but it should be
a deliberate choice against the note already in the file, not a side effect of this
feature.

---

## E. What is actually missing today

| Need | Status |
|---|---|
| Per-product on/off flag | **New** — one boolean column |
| Per-gallery-image state images | **New** — one table |
| Image ids reaching the storefront | **New** — `Product.images` is `string[]`, URLs only ([types/index.ts:86](src/types/index.ts:86)). Pairs must map to something stable |
| Upload + processing | **Exists** — reuse `optimizeImage` and local storage unchanged |
| Responsive delivery, caching, no-layout-shift | **Exists** — `next/image` + the gallery's fixed aspect frames |
| Admin image management UI | **Exists as a pattern** — [ProductImages.tsx](src/components/admin/ProductImages.tsx) (218 lines) is the model to follow |

### Mapping: by id, not by index

Spec §15 wants automatic mapping and §35 names `gallery_image_id`. Index-based mapping
breaks the moment an admin reorders or deletes a gallery image — §15 explicitly asks
for that to be robust. So pairs key on `product_images.id`, and the storefront needs
those ids: `Product.images` becomes an array of objects (or gains a parallel array).
That is an additive API change, and the one place existing types must widen.

---

## F. Proposed schema (additive only — nothing existing is altered)

```sql
-- One flag on the product.
ALTER TABLE products
  ADD COLUMN interactive_enabled boolean NOT NULL DEFAULT false;   -- §4: default OFF

-- One row per gallery image per state. Rows, not columns, so §33/§34's future
-- states (Warm, Natural, Day/Night, Before/After) need no migration at all.
CREATE TABLE product_image_states (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_image_id uuid NOT NULL REFERENCES product_images(id) ON DELETE CASCADE,
  state_key       text NOT NULL,          -- 'on' today; 'warm', 'night' later
  label           text,                   -- what the admin calls it
  storage_key     text NOT NULL,          -- the processed WebP
  width           integer NOT NULL,
  height          integer NOT NULL,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_image_id, state_key)
);
CREATE INDEX ON product_image_states (product_image_id);
```

`ON DELETE CASCADE` means deleting a gallery image takes its states with it — §15's
"handle add/remove/reorder robustly", handled by the database rather than by code that
has to remember.

Under **Option A**, OFF is the existing `product_images` row and only `state_key='on'`
is stored. Under Option B, an `off` row is stored too. Same table either way.

**Reversibility:** the migration only adds. Turning the feature off is the flag; a
revert of the frontend restores the page exactly; the column and table can sit unused
indefinitely, and dropping them later is a one-line migration with nothing depending on
it.

---

## G. Phases

Each phase is independently shippable and leaves the site working.

**Phase 1 — backend (no visible change)**
Migration; Drizzle schema; expose `interactiveEnabled` and image ids + states on the
product API; admin endpoints to upload/replace/remove a state image, reusing
`optimizeImage` and the existing storage layer untouched.
*Done when:* the API returns states for a product and the storefront is byte-identical.

**Phase 2 — admin (still no shopper-visible change)**
An "Interactive Product" panel on the product edit page: the ON/OFF feature switch, and
one row per existing gallery image with an upload slot, preview, and remove — following
`ProductImages.tsx`'s existing patterns. Mismatch warning per §21 when a state image's
aspect ratio differs from its gallery image.
*Done when:* you can turn it on for the lamp and upload its seven ON images.

**Phase 3 — storefront**
The optional Gallery prop; the pill toggle bottom-right inside the main frame; default
ON; reset to ON on thumbnail change (§8); 400–600ms opacity crossfade; per-index lazy
loading (§24); keyboard and screen-reader labels (§38). Loaded through `next/dynamic`
so a product with the feature off downloads none of it (§23).
*Done when:* the lamp behaves as §40 describes and every other product page is unchanged.

**Phase 4 — verification**
Localhost trial on the real data already pulled from the VPS; LCP/CLS before and after;
Facebook in-app browser on a real phone; then deploy.

---

## H. Risks

| Risk | Mitigation |
|---|---|
| `Product.images` widening from `string[]` breaks call sites | It is read in the gallery, the card, JSON-LD and OG metadata — all found and changed together in Phase 1; the type change makes the compiler list them |
| Toggle overlaps the sticky Buy bar on small phones | Bottom-right *inside* the image frame, which sits above the bar; checked at 320/390px in Phase 4 |
| Interactive product doubles image storage and encode time | Uploads are already resized and re-encoded once; the volume is 2.6 MB today, so this is not near any limit |
| Feature drifts into "always on" by accident | Column defaults to `false`; the storefront reads the flag server-side and ships nothing when off |
| Crossfade between mismatched shots looks like a glitch | §21's aspect-ratio warning in the admin, plus Option A which makes mismatch impossible for OFF |

## I. Open questions for you

1. **Option A or B** (§B) — one upload per image, or two?
2. **The additive Gallery prop** (§C) — acceptable, or must Gallery.tsx literally not change?
3. **AVIF** (§D) — keep the repo's WebP-only decision, or override it?
4. Toggle label — "ON/OFF", or the §13 wording ("Try Light" / "Light ON")? The system is
   generic (§33), so the label should probably come from the state's `label` column
   rather than being hard-coded to lighting.

## J. Still outstanding

`Gallery.tsx`, `ProductCard.tsx` and `BannerSlider.tsx` still hold **49 lines of
uncommitted LCP work**. Phase 3 edits `Gallery.tsx` and Phase 1 changes how images are
typed, which touches `ProductCard.tsx`. That work should be committed before Phase 1
starts, or it will be tangled into this feature's diff and cannot be reverted separately.
