# Brand

The shop's wordmark, kept here because the copy the storefront actually serves
lives inside the `uploads` Docker volume — and a volume is not a backup. If that
volume is ever lost, re-upload `hinar-wordmark.png` from **Admin → Branding**.

| File | What it is |
|---|---|
| `hinar-wordmark.svg` | Source of truth. Letters are outlines, not text, so it renders identically without Geist installed. |
| `hinar-wordmark.png` | 900×142, transparent. This exact file is what is uploaded as the store logo. |
| `build-wordmark.mjs` | Regenerates both. Needs `opentype.js` and `Geist-400.ttf` beside it. |

## The mark

**HINAR** in Geist Regular, uppercase, tracked out to 0.40em, in `#101010` —
`--color-ink`, not pure black.

Weight and tracking are the whole design, and they are not guesses. They were
measured off the reference the shop wanted to sit beside, as ratios of cap
height so the comparison survives any resolution:

| | reference | this mark |
|---|---|---|
| stroke weight | 13.2% of cap | 12.7% |
| letter gap | 75.4% of cap | 77.5% |

A first cut in Geist Medium at 0.30em came out at 15.2% and 59.4% — visibly
heavier and tighter, and the two marks did not read as siblings. If the wordmark
is ever redrawn, keep those two ratios and it will still belong.

The header sizes the logo from its own dimensions and caps it at 40px tall, so a
wider or narrower redraw needs no code change — only the width and height
recorded alongside it, which the upload does automatically.

## One trap

`build-wordmark.mjs` rounds the pen position at every letter. Left to
accumulate, it reached `399.40000000000003` by the last letter, and
opentype.js 2.0.0 emits `NaN` into the curve for that value while handling a
clean `399.4` — the R came out as a solid wedge. That reads as an odd design
choice rather than a broken file, so the script now refuses to write an SVG
containing a non-finite coordinate.
