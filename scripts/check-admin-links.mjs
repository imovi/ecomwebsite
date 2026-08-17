/**
 * Checks that every `/admin/...` link in the panel points at a page that exists.
 *
 *   node scripts/check-admin-links.mjs
 *
 * WHY THIS EXISTS
 * ---------------
 * `<Link href="/admin/abandoned">` compiles, type checks, lints and builds even
 * when no such route exists. The App Router resolves routes from the shape of
 * the `src/app` directory at request time, so a wrong href is only discovered
 * by clicking it — which is how the overview's "Call list" button reached
 * production pointing at a page that was named `incomplete`. The API called it
 * "abandoned" and the panel called it something else, and nothing was in a
 * position to notice the two words had drifted apart.
 *
 * Sibling of check-admin-proxy-paths.mjs: same failure, other half of the
 * request. That one checks the API path the browser asks for; this one checks
 * the page the browser is sent to.
 *
 * Exits non-zero and names the offenders, so it can gate a deploy.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

const APP_ROOT = "src/app";
const SEARCH_ROOT = "src";

/* ---------------------------------------------------------------------- */

/** Every route the App Router will actually serve, as a matcher. */
function pageRoutes() {
  const routes = [];

  const walk = (dir, url) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        /* `(admin)` and friends group files without adding a URL segment. */
        const isGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
        /* `_components` and `@slot` are not routes either. */
        const isPrivate = entry.name.startsWith("_") || entry.name.startsWith("@");
        if (isPrivate) continue;
        walk(full, isGroup ? url : `${url}/${entry.name}`);
      } else if (entry.name === "page.tsx" || entry.name === "page.ts") {
        routes.push(url || "/");
      }
    }
  };

  walk(APP_ROOT, "");

  return routes.map((route) => ({
    route,
    rx: new RegExp(
      `^${route
        .replace(/\[\.\.\.[^\]]+\]/g, ".+") /* catch-all */
        .replace(/\[[^\]]+\]/g, "[^/]+")}$` /* one dynamic segment */,
    ),
  }));
}

/** Every literal `/admin/...` href written anywhere in the source. */
function adminLinks() {
  const found = new Map();

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (![".ts", ".tsx"].includes(extname(entry.name))) continue;

      const text = readFileSync(full, "utf8");
      /* `href="/admin/x"`, `href={"/admin/x"}`, `href: "/admin/x"`, and the
         template form up to its first hole — a link built from a variable is
         not something this can decide, so it stops at the literal part. */
      for (const match of text.matchAll(/href[=:]\s*\{?\s*["`](\/admin[^"`?#$]*)/g)) {
        const href = match[1].replace(/\/+$/, "") || "/admin";
        if (!found.has(href)) found.set(href, new Set());
        found.get(href).add(full);
      }
    }
  };

  walk(SEARCH_ROOT);
  return found;
}

/* ---------------------------------------------------------------------- */

const routes = pageRoutes();
const links = adminLinks();
const broken = [];

for (const [href, files] of [...links].sort()) {
  if (!routes.some(({ rx }) => rx.test(href))) broken.push({ href, files: [...files] });
}

console.log(`${routes.length} page routes, ${links.size} distinct /admin links.`);

if (broken.length === 0) {
  console.log("Every /admin link resolves to a real page.");
  process.exit(0);
}

console.error(`\n${broken.length} link(s) pointing at a page that does not exist:\n`);
for (const { href, files } of broken) {
  console.error(`  ${href}`);
  console.error(`    linked from: ${files.join(", ")}`);
}
console.error(`\nEither fix the href or add the page under ${APP_ROOT}.`);
process.exit(1);
