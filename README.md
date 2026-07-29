# gng

A mobile-first gadget storefront for the Bangladesh market. Cash on delivery,
guest checkout, no accounts.

Built with Next.js 16 (App Router), React 19.2, TypeScript and Tailwind v4.
**Frontend-only**: all data is served from in-memory mocks behind a repository
layer, so swapping in Postgres is a change in one directory.

```bash
npm run dev     # http://localhost:3000
npm run build
npm start
```

---

## What's here

| Surface | Route | Notes |
|---|---|---|
| Home | `/` | Banner, categories, new arrivals, trending. ISR 5m |
| Category | `/category/[slug]` | `all` is a virtual category |
| Product | `/product/[slug]` | Sticky buy bar, variant sheet, JSON-LD. ISR 5m |
| Search | `/search?q=` | noindex |
| Cart | `/cart` | localStorage, prices resolved server-side |
| Checkout | `/checkout` | `?mode=buynow` bypasses the cart |
| Order success | `/order/success/[id]` | |
| Track order | `/track` | Order number + phone |
| Policies | `/policies/[slug]` | delivery, returns, warranty, terms, privacy, about, contact |
| Admin | `/admin` | Dashboard, orders, products, stock |

## Architecture

```
src/
  app/
    (shop)/          storefront routes + shell
    (admin)/         admin routes + shell
    actions.ts       server actions — the only write path
    admin-actions.ts admin mutations
  components/
    ui/              Button, Badge, Price, Field, Sheet, Toaster, Icon, Layout
    product/         Gallery, VariantPicker, QtyStepper, StickyBuyBar, ProductCard
    home/            BannerSlider, CategoryRail
    cart/ checkout/ shop/ admin/
  lib/
    data/            REPOSITORY LAYER — the only module that touches storage
    stores/          zustand: cart, toast
    geo.ts           delivery-zone resolution
    pricing.ts       all order arithmetic
    catalog-utils.ts pure helpers, safe on client and server
    copy.ts          every user-facing string
  data/              mock tables (products, orders, categories, policies…)
```

### Rules the codebase follows

- **Money is always an integer number of taka.** Never a float. Formatting
  happens only in `formatTaka`.
- **Discount percentages are derived, never stored.** A stored percentage goes
  stale the first time someone edits a price.
- **The cart stores only `{ productId, variantId, qty }`.** Prices are
  re-resolved from the catalog on render and re-validated server-side at order
  placement, so a stale cart can never buy at a stale price.
- **Order items carry snapshots** of title, price and image. Editing a product
  must never rewrite order history.
- **No component hardcodes user-facing text.** It all lives in `lib/copy.ts`,
  so switching the UI to Bangla is one file.
- **`lib/data/*` is `server-only`.** Client components get a trimmed projection
  (`toCatalogMap`), not full product objects.

---

## Two decisions worth understanding

### Delivery zone is confirmed, never inferred

`lib/geo.ts` matches free-typed area text against thana, neighbourhood and
district lists to **pre-select** a zone. The customer's confirmed selection is
what gets stored on the order.

A naive `text.includes("dhaka")` is wrong in both directions, and each mistake
costs money at the doorstep:

- `"Dhanmondi"`, `"Mirpur 10"`, `"Uttara Sector 7"` — inside Dhaka, but the
  word "Dhaka" never appears.
- `"Savar, Dhaka"`, `"Keraniganj, Dhaka"`, `"Tongi, Gazipur"` — contain "Dhaka"
  but couriers bill them at the outside-city rate.

Hence the check order in `suggestZone`: outside-overrides → inside-Dhaka areas
→ districts → bare "dhaka". Bangla script and common misspellings are mapped.

```bash
node --experimental-strip-types --no-warnings scripts/test-geo.mjs
```

### Trending counts delivered orders, with decay

`getTrending` scores products by `qty × 0.5^(daysAgo / 14)` over **delivered**
orders only. On a COD store, counting *placed* orders lets refused and prank
orders decide what the homepage promotes. `pinnedRank` always outranks the
computed score — needed on day one before any sales exist, and during
campaigns.

---

## Order lifecycle

```
PENDING → CONFIRMED → PACKED → SHIPPED → DELIVERED
             ↓           ↓        ↓
         CANCELLED   CANCELLED  RETURNED
```

`PENDING → CONFIRMED` is the confirmation phone call, made an explicit logged
transition so "did anyone ring this customer?" is a fact, not a guess. Stock is
reserved at placement and released on cancel or return. Revenue and trending
count `DELIVERED` only. Illegal transitions are rejected by
`allowedTransitions` in `lib/data/orders.ts`.

---

## Performance

Measured against a production build, gzipped, homepage:

| | |
|---|---|
| Framework baseline (Next 16 + React 19.2) | ~187–190 KB |
| Application code on top of it | 12–19 KB per route |

The catalog does **not** ship to the client (verified — no product strings in
any client chunk). The `geo.ts` dataset is code-split into its own chunk and
only loads on checkout. The framework baseline is the dominant cost and is not
something the app code influences; if it needs to come down, that is a
framework version decision, not a refactor.

Other measures in place:

- Native CSS scroll-snap for the gallery, banner and rails — no carousel
  library, real iOS momentum, works before hydration.
- No icon package; `components/ui/Icon.tsx` is inline SVG.
- No `tailwind-merge`; variant maps never emit conflicting utilities.
- Only the first banner and first gallery frame use `preload`; everything else
  lazy-loads. (Next 16 deprecated `priority` in favour of `preload`.)
- AVIF/WebP with phone-first `deviceSizes`.
- All animation is `transform`/`opacity` and respects
  `prefers-reduced-motion`.

---

## Placeholder assets

`public/products/*` and `public/banners/*` are generated SVGs so the store runs
with no network access:

```bash
node scripts/generate-placeholders.mjs
```

Replace them with real 1:1 product photography — the paths come from
`data/products.ts`, so nothing else changes. At that point the
`dangerouslyAllowSVG` block in `next.config.ts` can be deleted.

---

## Before this goes live

1. **Authenticate `/admin`.** There is no auth today. It needs a real gate plus
   middleware protecting the route — deliberately not faked, so nobody mistakes
   it for protection that does not exist.
2. **Replace `lib/data/*` with real queries.** Every function there is already
   `async` and returns plain data; the mock tables in `src/data/` then go away.
   Schema notes are in `types/index.ts`.
3. **Real policy copy.** `data/policies.ts` is written for a BD COD store, but
   the terms are placeholders. Facebook Business verification checks these.
4. **Analytics.** Meta Pixel plus **Conversions API server-side** from
   `placeOrderAction` — browser-only pixels lose a large share of BD Purchase
   events. Worth firing: ViewContent, AddToCart, InitiateCheckout, Purchase.
5. **Set the real domain.** `metadataBase` in `app/layout.tsx`, `sitemap.ts`
   and `robots.ts` all point at `https://gng.com.bd`.
6. **Store settings.** Delivery charges, free-delivery threshold, hotline and
   WhatsApp number are in `data/store.ts`.

### Deliberately not built

Reviews and ratings (an empty review section hurts a new store more than it
helps — the product-page trust badges do that job instead), customer accounts,
online payment, and the admin categories/customers/coupons/banners screens.
