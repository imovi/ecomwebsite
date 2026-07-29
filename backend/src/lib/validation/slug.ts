import { slugify } from "../utils/index.js";

/**
 * Slug generation with collision handling.
 *
 * Slugs are user-visible URLs and must be unique, but a merchant should not
 * have to invent one — deriving it from the name and appending a numeric
 * suffix on collision is what every catalogue does.
 *
 * The uniqueness check is passed in rather than imported so this stays usable
 * for both categories and products, and remains a pure function to test.
 */
export async function generateUniqueSlug(
  source: string,
  exists: (candidate: string) => Promise<boolean>,
  options: { maxAttempts?: number } = {},
): Promise<string> {
  const maxAttempts = options.maxAttempts ?? 50;
  const base = slugify(source) || "item";

  if (!(await exists(base))) return base;

  for (let suffix = 2; suffix <= maxAttempts; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!(await exists(candidate))) return candidate;
  }

  /* Deterministic suffixes exhausted. A short random tail always terminates,
     and is preferable to failing the request over a cosmetic field. */
  return `${base}-${Date.now().toString(36).slice(-5)}`;
}

/**
 * Normalises a caller-supplied slug.
 *
 * Applied even when the client sends one explicitly — accepting `My Product!`
 * verbatim produces URLs that need escaping and behave inconsistently across
 * clients.
 */
export function normalizeSlug(input: string): string {
  return slugify(input);
}
