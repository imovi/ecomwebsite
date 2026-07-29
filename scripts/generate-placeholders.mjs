/**
 * Generates square product placeholders and banner artwork as SVG.
 *
 * These exist so the storefront renders completely without a CDN or any
 * network access. Replace `public/products/*` with real 1:1 photography and
 * nothing else in the codebase needs to change — the paths are already
 * whatever `data/products.ts` says they are.
 *
 *   node scripts/generate-placeholders.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productsDir = resolve(root, "public/products");
const bannersDir = resolve(root, "public/banners");
mkdirSync(productsDir, { recursive: true });
mkdirSync(bannersDir, { recursive: true });

/* --- Parse the catalog ---------------------------------------------------- */

const source = readFileSync(resolve(root, "src/data/products.ts"), "utf8");

const entries = [
  ...source.matchAll(
    // Titles may contain escaped quotes (e.g. MacBook Air 13\" M3).
    /slug: "([^"]+)",\s*\n\s*title: "((?:[^"\\]|\\.)+)",\s*\n\s*brand: "([^"]+)",\s*\n\s*categoryId: "([^"]+)",[\s\S]*?images: images\("[^"]+", (\d+)\)/g,
  ),
].map(([, slug, title, brand, categoryId, count]) => ({
  slug,
  title: title.replace(/\\"/g, '"'),
  brand,
  categoryId,
  count: Number(count),
}));

if (entries.length === 0) {
  console.error("No products parsed — check the regex against data/products.ts");
  process.exit(1);
}

/* --- Palette -------------------------------------------------------------- */

/** Muted, premium tints. Never competes with the real photography later. */
const TINTS = [
  ["#f2f4f7", "#e3e7ee"],
  ["#f4f2f0", "#e9e4df"],
  ["#f0f4f3", "#dfe9e6"],
  ["#f3f1f6", "#e6e1ef"],
  ["#f5f3ef", "#ebe5da"],
  ["#eef3f6", "#dde8f0"],
];

const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/* --- Device silhouettes --------------------------------------------------- */

/** Each returns SVG markup drawn inside a 0 0 400 400 viewBox. */
const shapes = {
  "cat-phones": (a) => `
    <rect x="150" y="88" width="100" height="196" rx="16" fill="${a}" opacity="0.9"/>
    <rect x="158" y="96" width="84" height="180" rx="10" fill="#fff" opacity="0.55"/>
    <rect x="184" y="102" width="32" height="7" rx="3.5" fill="${a}" opacity="0.5"/>`,
  "cat-audio": (a) => `
    <path d="M118 214v-24a82 82 0 0 1 164 0v24" fill="none" stroke="${a}" stroke-width="18" stroke-linecap="round" opacity="0.9"/>
    <rect x="100" y="204" width="40" height="66" rx="18" fill="${a}"/>
    <rect x="260" y="204" width="40" height="66" rx="18" fill="${a}"/>`,
  "cat-watches": (a) => `
    <rect x="156" y="86" width="88" height="52" rx="16" fill="${a}" opacity="0.55"/>
    <rect x="156" y="262" width="88" height="52" rx="16" fill="${a}" opacity="0.55"/>
    <rect x="144" y="130" width="112" height="140" rx="34" fill="${a}"/>
    <rect x="156" y="142" width="88" height="116" rx="26" fill="#fff" opacity="0.5"/>`,
  "cat-laptops": (a) => `
    <rect x="112" y="126" width="176" height="116" rx="10" fill="${a}"/>
    <rect x="122" y="136" width="156" height="96" rx="5" fill="#fff" opacity="0.55"/>
    <path d="M92 250h216l16 28H76z" fill="${a}" opacity="0.85"/>`,
  "cat-speakers": (a) => `
    <rect x="140" y="96" width="120" height="208" rx="34" fill="${a}"/>
    <circle cx="200" cy="222" r="38" fill="#fff" opacity="0.5"/>
    <circle cx="200" cy="222" r="18" fill="${a}" opacity="0.55"/>
    <rect x="176" y="132" width="48" height="8" rx="4" fill="#fff" opacity="0.5"/>`,
  "cat-cameras": (a) => `
    <path d="M96 150h44l18-26h84l18 26h44a14 14 0 0 1 14 14v104a14 14 0 0 1-14 14H96a14 14 0 0 1-14-14V164a14 14 0 0 1 14-14z" fill="${a}"/>
    <circle cx="200" cy="218" r="52" fill="#fff" opacity="0.5"/>
    <circle cx="200" cy="218" r="28" fill="${a}" opacity="0.6"/>`,
  "cat-power": (a) => `
    <rect x="112" y="140" width="176" height="120" rx="24" fill="${a}"/>
    <path d="M208 168l-32 44h24l-8 34 32-46h-24z" fill="#fff" opacity="0.7"/>
    <rect x="288" y="180" width="20" height="40" rx="7" fill="${a}" opacity="0.7"/>`,
  "cat-gaming": (a) => `
    <path d="M136 154h128a58 58 0 0 1 56 71l-11 47a34 34 0 0 1-58 15l-22-25h-58l-22 25a34 34 0 0 1-58-15l-11-47a58 58 0 0 1 56-71z" fill="${a}"/>
    <rect x="140" y="196" width="34" height="9" rx="4.5" fill="#fff" opacity="0.65"/>
    <rect x="152" y="184" width="9" height="34" rx="4.5" fill="#fff" opacity="0.65"/>
    <circle cx="248" cy="196" r="9" fill="#fff" opacity="0.65"/>
    <circle cx="272" cy="214" r="9" fill="#fff" opacity="0.65"/>`,
};

const escapeXml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* --- Product images ------------------------------------------------------- */

let written = 0;

for (const entry of entries) {
  const h = hash(entry.slug);
  const [from, to] = TINTS[h % TINTS.length];
  const accent = `hsl(${(h >> 3) % 360} 16% 62%)`;
  const shape = shapes[entry.categoryId] ?? shapes["cat-phones"];

  for (let i = 1; i <= entry.count; i++) {
    // Each subsequent image is a rotated/zoomed variation so the swipeable
    // gallery reads as multiple angles rather than the same picture 4 times.
    const angle = (i - 1) * 14 - 7;
    const scale = 1 - (i - 1) * 0.06;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400" role="img" aria-label="${escapeXml(entry.title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/>
      <stop offset="1" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="url(#bg)"/>
  <circle cx="${300 + (i % 2) * -180}" cy="${96 + i * 14}" r="120" fill="#fff" opacity="0.28"/>
  <g transform="translate(200 200) rotate(${angle}) scale(${scale.toFixed(2)}) translate(-200 -200)">
    ${shape(accent)}
  </g>
  <text x="24" y="372" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="15" font-weight="600" fill="#0b0b0c" opacity="0.42">${escapeXml(entry.brand)}</text>
  <text x="376" y="372" text-anchor="end" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="13" fill="#0b0b0c" opacity="0.26">${i} / ${entry.count}</text>
</svg>
`;

    writeFileSync(resolve(productsDir, `${entry.slug}-${i}.svg`), svg, "utf8");
    written++;
  }
}

/* --- Banners -------------------------------------------------------------- */

const BANNERS = [
  {
    id: 1,
    eyebrow: "Now in stock",
    headline: "iPhone 15 Pro Max",
    sub: "Titanium. A17 Pro. Cash on delivery nationwide.",
    from: "#101114",
    to: "#33363d",
    fg: "#ffffff",
    accent: "#8e9099",
    shape: "cat-phones",
  },
  {
    id: 2,
    eyebrow: "Up to 25% off",
    headline: "Sound, upgraded",
    sub: "AirPods, Sony and Soundcore — this week only.",
    from: "#f6f2ec",
    to: "#e6dccd",
    fg: "#0b0b0c",
    accent: "#b9a68c",
    shape: "cat-audio",
  },
  {
    id: 3,
    eyebrow: "Free delivery",
    headline: "On orders over ৳20,000",
    sub: "Inside or outside Dhaka. No code needed.",
    from: "#eef2f7",
    to: "#d9e2ee",
    fg: "#0b0b0c",
    accent: "#93a3b8",
    shape: "cat-laptops",
  },
];

function bannerSvg({ w, h, banner, mobile }) {
  const pad = mobile ? 44 : 72;
  const headlineSize = mobile ? 46 : 60;
  const subSize = mobile ? 19 : 22;
  const eyebrowSize = mobile ? 15 : 16;
  const artScale = mobile ? 1.15 : 1.35;
  const artX = mobile ? w / 2 : w - 300;
  const artY = mobile ? h - 250 : h / 2;
  const textY = mobile ? pad + 90 : h / 2 - 40;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${escapeXml(banner.headline)}">
  <defs>
    <linearGradient id="bg${banner.id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${banner.from}"/>
      <stop offset="1" stop-color="${banner.to}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg${banner.id})"/>
  <circle cx="${mobile ? w * 0.85 : w * 0.62}" cy="${mobile ? h * 0.12 : h * 0.2}" r="${mobile ? 150 : 190}" fill="${banner.fg}" opacity="0.05"/>
  <g transform="translate(${artX} ${artY}) scale(${artScale}) translate(-200 -200)" opacity="0.9">
    ${shapes[banner.shape](banner.accent)}
  </g>
  <text x="${pad}" y="${textY}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="${eyebrowSize}" font-weight="600" letter-spacing="1.4" fill="${banner.fg}" opacity="0.65">${escapeXml(banner.eyebrow.toUpperCase())}</text>
  <text x="${pad}" y="${textY + headlineSize + 10}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="${headlineSize}" font-weight="700" letter-spacing="-1.6" fill="${banner.fg}">${escapeXml(banner.headline)}</text>
  <text x="${pad}" y="${textY + headlineSize + subSize + 34}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="${subSize}" fill="${banner.fg}" opacity="0.7">${escapeXml(banner.sub)}</text>
</svg>
`;
}

for (const banner of BANNERS) {
  writeFileSync(
    resolve(bannersDir, `banner-${banner.id}.svg`),
    bannerSvg({ w: 1600, h: 640, banner, mobile: false }),
    "utf8",
  );
  writeFileSync(
    resolve(bannersDir, `banner-${banner.id}-mobile.svg`),
    bannerSvg({ w: 900, h: 760, banner, mobile: true }),
    "utf8",
  );
  written += 2;
}

console.log(`Generated ${written} placeholder assets for ${entries.length} products.`);
