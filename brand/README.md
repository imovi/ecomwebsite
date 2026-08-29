# Brand

The shop's wordmark, kept here because the copy the storefront actually serves
lives inside the `uploads` Docker volume — and a volume is not a backup. If that
volume is ever lost, re-upload `hinar-wordmark.png` from **Admin → Branding**.

| File | What it is |
|---|---|
| `hinar-wordmark.svg` | Source of truth. Letters are outlines, not text, so it renders identically without Geist installed. |
| `hinar-wordmark.png` | 720×125, transparent. This exact file is what is uploaded as the store logo. |

**HINAR** set in Geist Medium, uppercase, with 0.30em of tracking — the wide
spacing is the whole mark, so keep it if the wordmark is ever redrawn. The
colour is `#101010`, matching `--color-ink`, not pure black.

The header sizes the logo from its own dimensions and caps it at 40px tall, so a
wider or narrower redraw needs no code change — only the width and height
recorded alongside it, which the upload does automatically.

Regenerating it needs the Geist TTF and `opentype.js`; both are external to this
repo, which is why the outlined SVG is committed rather than a build step.
