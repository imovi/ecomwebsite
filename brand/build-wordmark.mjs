/**
 * HINAR wordmark, fitted to the reference by measurement.
 *
 * Geist Regular at 0.40em tracking: 12.7% stroke weight and 77.5% letter gap
 * against cap height, versus the reference's 13.2% and 75.4%. Weight and
 * spacing are what make two wordmarks read as siblings, so both were measured
 * off the reference rather than eyeballed.
 *
 * The pen position is rounded at every step. Accumulating advances left it at
 * 399.40000000000003 by the last letter, and opentype.js 2.0.0 emits `NaN`
 * into the curve for that value while handling a clean 399.4 — the R rendered
 * as a solid wedge, which reads as a design choice rather than a broken file
 * until you measure it. The assertion below is there because that was silent.
 */
import opentype from "opentype.js";
import fs from "node:fs";

const TEXT = "HINAR";
const TRACKING = 0.4;
const SIZE = 100;
const COLOR = "#101010";

const font = opentype.parse(fs.readFileSync("Geist-400.ttf").buffer);
const track = TRACKING * SIZE;

let x = 0;
const parts = [];
let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;

for (const ch of TEXT) {
  const p = font.getPath(ch, x, SIZE, SIZE);
  const b = p.getBoundingBox();
  if (b.x1 < x1) x1 = b.x1;
  if (b.y1 < y1) y1 = b.y1;
  if (b.x2 > x2) x2 = b.x2;
  if (b.y2 > y2) y2 = b.y2;
  parts.push(p.toPathData(2));
  /* Rounded, not accumulated raw — see the note at the top. */
  x = Math.round((x + font.getAdvanceWidth(ch, SIZE) + track) * 100) / 100;
}

const w = x2 - x1;
const h = y2 - y1;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x1.toFixed(2)} ${y1.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}">
${parts.map((d) => `<path fill="${COLOR}" d="${d}"/>`).join("\n")}
</svg>`;

/* A wordmark that is silently wrong is worse than one that fails to build. */
if (/NaN|Infinity|undefined/.test(svg)) {
  throw new Error("Generated SVG contains a non-finite coordinate — refusing to write it.");
}
if (parts.length !== TEXT.length) {
  throw new Error(`Expected ${TEXT.length} letters, laid out ${parts.length}.`);
}

fs.writeFileSync("hinar-final.svg", svg);
console.log(
  `hinar-final.svg  ${w.toFixed(0)} x ${h.toFixed(0)}  ratio ${(w / h).toFixed(2)}:1  letters ${parts.length}  clean ✓`,
);
