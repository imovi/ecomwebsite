/**
 * Checks that every admin API path the panel calls is one the proxy allows.
 *
 *   node scripts/check-admin-proxy-paths.mjs
 *
 * WHY THIS EXISTS
 * ---------------
 * The admin panel reaches the API through `src/app/api/admin/[...path]`, which
 * matches the requested path against an allowlist and answers 404 to anything
 * else. That allowlist lives nowhere near the screens that depend on it, so
 * adding a screen and forgetting the entry produces a page that compiles, type
 * checks, lints, builds, deploys — and then 404s for real customers' data.
 *
 * It has happened three times: the customer list, the dashboard summary and the
 * whole "Blocked IPs" screen all shipped to production unreachable. Nothing in
 * the toolchain could have caught it, because both halves are correct on their
 * own; only their relationship is wrong.
 *
 * Exits non-zero and names the offenders, so it can gate a deploy.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

const ROUTE = "src/app/api/admin/[...path]/route.ts";
const SEARCH_ROOT = "src";

/* ---------------------------------------------------------------------- */

function allowlistPatterns() {
  const source = readFileSync(ROUTE, "utf8");
  const start = source.indexOf("const ALLOWED_PATHS");
  const end = source.indexOf("];", start);
  if (start === -1 || end === -1) {
    throw new Error(`Could not find ALLOWED_PATHS in ${ROUTE}`);
  }

  const block = source.slice(start, end);
  const literals = [...block.matchAll(/^\s*(\/\^.*\$\/),?\s*$/gm)].map((m) => m[1]);
  if (literals.length === 0) throw new Error("ALLOWED_PATHS looks empty — has its shape changed?");

  return literals.map((literal) => {
    const body = literal.slice(1, literal.lastIndexOf("/"));
    return { rx: new RegExp(body), literal };
  });
}

/** Every `adminApi.*("path")` and every hand-built `/api/admin/path`. */
function callSites() {
  const found = new Map(); // path expression -> Set of files

  const record = (raw, file) => {
    if (!found.has(raw)) found.set(raw, new Set());
    found.get(raw).add(file);
  };

  const patterns = [
    /adminApi\.\w+(?:<[^>]*>)?\(\s*[`"']([^`"']+)/g,
    /["'`]\/api\/admin\/([^`"'?\s]+)/g,
  ];

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (![".ts", ".tsx"].includes(extname(entry.name))) continue;
      if (full.replace(/\\/g, "/").includes("api/admin/[...path]")) continue;

      const text = readFileSync(full, "utf8");
      for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) record(match[1], full);
      }
    }
  };

  walk(SEARCH_ROOT);
  return found;
}

/**
 * What a path expression can look like at runtime.
 *
 * A template hole is either a path segment (`admin/ips/${id}`) or the start of
 * a query string (`admin/orders${qs({…})}`), and the source cannot say which.
 * So both readings are tried and the path passes if either is allowed — a
 * checker that guessed would report failures that are not real, and a checker
 * nobody trusts is worse than none.
 */
function candidates(raw) {
  const withoutQuery = raw.split("?")[0];
  return [
    /* the hole was a query string, or a trailing fragment of one */
    withoutQuery.replace(/\$\{[\s\S]*$/, "").replace(/\/+$/, ""),
    /* the hole was one path segment */
    withoutQuery.replace(/\$\{[^}]*\}/g, "PARAM").replace(/\/+$/, ""),
  ].filter(Boolean);
}

/* ---------------------------------------------------------------------- */

const patterns = allowlistPatterns();
const calls = callSites();
const blocked = [];

for (const [raw, files] of [...calls].sort()) {
  const forms = candidates(raw);
  /* Only paths that go through this proxy are its business. */
  if (!forms.some((f) => f.startsWith("admin/") || f.startsWith("auth/"))) continue;

  if (!forms.some((form) => patterns.some(({ rx }) => rx.test(form)))) {
    blocked.push({ raw, forms, files: [...files] });
  }
}

console.log(`${patterns.length} allowlist patterns, ${calls.size} call sites.`);

if (blocked.length === 0) {
  console.log("Every admin path the panel calls is allowed by the proxy.");
  process.exit(0);
}

console.error(`\n${blocked.length} path(s) the proxy would answer 404 to:\n`);
for (const { raw, forms, files } of blocked) {
  console.error(`  ${raw}`);
  console.error(`    tried:  ${forms.join("  |  ")}`);
  console.error(`    called from: ${files.join(", ")}`);
}
console.error(`\nAdd an entry to ALLOWED_PATHS in ${ROUTE}.`);
process.exit(1);
