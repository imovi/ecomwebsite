# Implementation Plan: "The light turns on" — product page effect

> Planning document only. No production code has been modified.

## What is being asked

The shop sells an under-cabinet LED lamp. When a shopper opens that product page it
should feel as though a real light has just been switched on — not a decorative
animation bolted onto the page, but the product demonstrating itself.

## The idea, made concrete

The strongest version of this is **not** a flash on arrival. It is two things
working together:

1. **An arrival moment** — the hero photo begins dark and the light comes up over
   roughly 700ms, with a short settle at the start the way a real LED does. A warm
   glow spills from the gallery onto the page behind it.
2. **A dimmer the shopper can drag** — this product's actual selling feature is
   stepless touch dimming (it is on slide 5 of the gallery). A slider under the
   photo that really dims and warms the page is not decoration; it is a
   demonstration. This is what separates the feature from a gimmick, and it is the
   part worth building well.

The arrival moment alone is a trick a shopper sees once. The dimmer is a reason to
stay on the page and touch it — which is also the behaviour that sells.

## Task type

- [x] Frontend (storefront)
- [ ] Backend — **not required for the trial**; only for the "which products" question, see Step 5

---

## Technical approach

### How the "off" state is produced

Two options, and the choice decides how much work the shop owner has to do:

| | How | Cost | Fidelity |
|---|---|---|---|
| **A. Derived (recommended to start)** | Take the existing lit photo and render the off state with a CSS filter — `brightness(.32) saturate(.75)` plus a cool tint — then animate back to normal | No new photos, works for any product | Convincing, not perfect |
| **B. Photo pair** | Shop owner uploads a matched off/on pair; crossfade between them | A real photo shoot per product | Best possible |

Start with **A**. It needs no new uploads, no schema change, and no admin work, so it
can be judged on localhost tonight. **B** can be layered on later for this one
product without changing the component's shape.

### Why CSS filters and not a canvas/WebGL glow

The repo has no animation library and a deliberate bundle budget, this page's hero
is the LCP element, and a large share of traffic arrives inside the Facebook in-app
browser on mid-range Android. A filter transition on one element plus a radial
gradient stays on the compositor and adds no dependency. Anything heavier risks the
metric the page is currently optimised for.

### Where it lives

A new self-contained client component wrapping the gallery, so `Gallery.tsx` keeps
its single job (swiping) and this keeps its own (light).

```
src/components/product/LightScene.tsx     ← new: the glow layer + dimmer control
src/lib/hooks/use-light-scene.ts          ← new: brightness state, arrival sequence,
                                              reduced-motion + once-per-session guard
```

`ProductPurchase.tsx` renders `<LightScene>` around the existing `<Gallery>`
([ProductPurchase.tsx:203](src/components/product/ProductPurchase.tsx:203)).

### Pseudo-code

```tsx
// use-light-scene.ts
export function useLightScene({ enabled }: { enabled: boolean }) {
  // 0 = off, 1 = full. Starts dark ONLY when we are going to animate;
  // otherwise it starts lit so nothing ever renders dark and stays dark.
  const [level, setLevel] = useState(() =>
    enabled && shouldPlayArrival() ? 0 : 1,
  );

  useEffect(() => {
    if (level === 1) return;
    // One frame of "settle" then up to full — a real LED does not ramp linearly.
    const flicker = setTimeout(() => setLevel(0.55), 90);
    const settle  = setTimeout(() => setLevel(0.42), 170);
    const full    = setTimeout(() => setLevel(1),    260);
    markArrivalPlayed();                // sessionStorage: once per tab
    return () => [flicker, settle, full].forEach(clearTimeout);
  }, []);

  return { level, setLevel };           // setLevel is what the dimmer drives
}

// shouldPlayArrival(): false when
//   - prefers-reduced-motion is set, or
//   - this tab already played it (sessionStorage), or
//   - the page was restored from bfcache
```

```tsx
// LightScene.tsx  (client component)
<div style={{ "--light": level } as CSSProperties}>
  {/* Warm spill behind the photo. Pure paint, no layout. */}
  <div aria-hidden className="light-glow" />

  {/* The gallery, dimmed by the same variable */}
  <div className="light-subject">{children}</div>

  {/* The demonstration. A real range input — keyboard and screen reader
      get it for free, which a div-with-drag-handlers would not. */}
  <label>
    <span className="sr-only">Brightness</span>
    <input type="range" min={0.15} max={1} step={0.01}
           value={level} onChange={e => setLevel(+e.target.value)} />
  </label>
</div>
```

```css
.light-subject  { filter: brightness(calc(.32 + .68 * var(--light)))
                          saturate(calc(.75 + .25 * var(--light)));
                  transition: filter 420ms cubic-bezier(.2,.8,.2,1); }
.light-glow     { opacity: var(--light);
                  background: radial-gradient(60% 50% at 50% 40%,
                              oklch(88% .12 85 / .55), transparent 70%); }

@media (prefers-reduced-motion: reduce) {
  .light-subject { transition: none; }
}
```

---

## Implementation steps

1. **`use-light-scene.ts`** — level state, the arrival sequence, and all three
   suppression rules (reduced motion, once per tab, bfcache restore).
   *Deliverable:* a hook with no JSX, testable on its own.

2. **`LightScene.tsx`** — glow layer, subject wrapper, and the range input, driven by
   one CSS custom property. Renders `children` so it knows nothing about galleries.
   *Deliverable:* the component, working in isolation.

3. **Wire it into `ProductPurchase.tsx`** — wrap the existing `<Gallery>` at
   [line 203](src/components/product/ProductPurchase.tsx:203). One prop decides
   whether it is active; when inactive it renders `children` untouched and ships no
   glow, no slider, no timers.
   *Deliverable:* the effect live on the light product, every other product byte-identical.

4. **Guard the LCP** — confirm the hero image still loads eagerly at high priority
   and that the filter does not delay its paint or shift layout. Reserve the
   slider's height so nothing moves when it appears.
   *Deliverable:* before/after LCP and CLS on a throttled mobile profile.

5. **Decide which products get it** *(the one open question — see below)*.
   *Deliverable:* whichever mechanism you pick from the four in "Open question".

6. **Localhost trial** — API on PGlite + storefront dev server, walk the product page
   on desktop and at 390px.
   *Deliverable:* your verdict before anything is committed.

---

## Open question — which products get this?

This is the one decision I should not make for you, because the cheap answers are
hard to undo and the clean answer costs a migration.

| | Mechanism | Cost | When it stops being right |
|---|---|---|---|
| **i** | Hard-code the one slug in a frontend constant | minutes | The moment you sell a second lamp |
| **ii** | Any product in the "Lights" category | ~an hour, no schema change | If a non-lamp lands in that category |
| **iii** | Reuse a `specs` row as a flag | ~an hour, no schema change | It shows up in the customer-visible spec table — it would need hiding |
| **iv** | A real `effect` field on the product + admin toggle | backend migration, API field, admin UI, deploy | Nothing — this is the real answer |

**My recommendation:** do **(i)** for the trial — it costs minutes and proves the
idea — and promote straight to **(iv)** if you like it and want it on more products.
Skip (iii); a customer-facing table is the wrong place to hide a switch.

---

## Key files

| File | Operation | Description |
|---|---|---|
| `src/lib/hooks/use-light-scene.ts` | Create | Level state, arrival sequence, suppression rules |
| `src/components/product/LightScene.tsx` | Create | Glow layer, subject wrapper, dimmer |
| [ProductPurchase.tsx:203](src/components/product/ProductPurchase.tsx:203) | Modify | Wrap `<Gallery>` |
| [globals.css:177](src/app/globals.css:177) | Modify | Reduced-motion rule for the new classes, beside the existing block |
| `src/components/product/Gallery.tsx` | **Untouched** | Deliberate — see the warning below |

## ⚠️ Before any of this starts

`Gallery.tsx`, `ProductCard.tsx` and `BannerSlider.tsx` have **uncommitted changes in
your working tree right now** — 49 lines of LCP and `sizes` work (`preload` →
`fetchPriority`, corrected `sizes` maths on the gallery frame). They are good changes
and they are not committed anywhere.

This plan deliberately routes around `Gallery.tsx` so nothing collides. But that work
should be committed before we add more on top of it — losing it would be quiet and
annoying, and step 4 of this plan measures exactly the metric those edits improve.

## Risks and mitigation

| Risk | Mitigation |
|---|---|
| It reads as a gimmick and costs conversions | Once per tab, under a second, never covers the Buy button; the dimmer is opt-in and silent until touched |
| Filter on a large image janks on mid-range Android in the Facebook in-app browser — the traffic this shop actually gets | Filter one element only, transition only `filter`/`opacity`; test in that browser specifically before shipping |
| The hero is the LCP element; a dark first paint could be read as a slower LCP | The image loads and paints exactly as now — only a filter differs. Measure in step 4; if LCP moves, start at `.5` rather than `.32` |
| Fights the gallery's existing auto-advance | The effect never moves the rail; it only paints. Auto-advance logic untouched |
| A shopper leaves the dimmer at 15% and the product looks bad | Level resets on navigation; it is never persisted |
| Someone with reduced-motion set sees a dark page | The hook starts at full brightness in that case — the dark state is never rendered at all |

## Test plan

- [ ] Reduced-motion on: page renders fully lit, no transition, dimmer still works
- [ ] Second visit in the same tab: no arrival animation, page lit immediately
- [ ] Back/forward (bfcache) restore: no re-run, no dark flash
- [ ] Keyboard: dimmer reachable by Tab, operable by arrow keys, has an audible label
- [ ] 390px viewport: nothing overlaps the price or the sticky Buy bar
- [ ] LCP and CLS before/after on a throttled mobile profile (step 4)
- [ ] Every OTHER product page: byte-identical, no slider, no glow, no extra JS
- [ ] Facebook in-app browser on a real mid-range Android

## Sessions

`/multi-plan`'s Codex/Gemini legs did not run — the `ccg-workflow` runtime
(`~/.claude/bin/codeagent-wrapper`, `~/.claude/.ccg/prompts/*`) is not installed on
this machine. This plan comes from reading the product page, gallery, purchase
component and the repo's own performance and motion conventions.

- CODEX_SESSION: n/a
- GEMINI_SESSION: n/a
