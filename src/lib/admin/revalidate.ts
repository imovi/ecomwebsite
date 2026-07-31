"use server";

import { updateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/data/catalog";

/**
 * Drops the storefront's cached catalogue reads after an admin write.
 *
 * WHY THIS EXISTS
 * ---------------
 * Storefront reads are cached with a five-minute ISR window. Without explicit
 * invalidation an admin who publishes a product, opens the shop and sees nothing
 * concludes the publish failed — and publishes it again. Paying for ad traffic
 * to a catalogue that has not caught up is worse still.
 *
 * WHY `updateTag` AND NOT `revalidateTag`
 * ---------------------------------------
 * `revalidateTag(tag, "max")` marks the entry stale and serves stale-while-
 * revalidate, so the very next visit — the admin checking their own change —
 * would still show the OLD page. `updateTag` expires immediately and makes that
 * next request wait for fresh data, which is precisely the read-your-own-writes
 * behaviour needed here.
 *
 * The tradeoff is deliberate: one blocking refetch after an edit, in exchange for
 * never showing an admin a change they just made as if it had not happened.
 *
 * WHY A SERVER ACTION AND NOT THE PROXY ROUTE
 * -------------------------------------------
 * `updateTag` may only be called from a Server Action. Every admin write already
 * goes through `adminApi`, which calls this once the API has confirmed the write.
 */

export type RevalidateScope = "products" | "categories" | "settings" | "banners";

export async function revalidateStorefront(scope: RevalidateScope): Promise<void> {
  switch (scope) {
    case "products":
      /* Product detail pages carry `product:<slug>` as well, but they also carry
         the coarse `products` tag, so one call covers listings and detail alike
         and the slug never has to be recovered from the response. */
      updateTag(CACHE_TAGS.products);
      return;

    case "categories":
      /* A renamed or reordered category changes the rail on every page, and the
         listings hanging off it. */
      updateTag(CACHE_TAGS.categories);
      updateTag(CACHE_TAGS.products);
      return;

    case "settings":
      /* The logo lives in settings and is rendered by the header on every page. */
      updateTag(CACHE_TAGS.settings);
      return;

    case "banners":
      updateTag(CACHE_TAGS.banners);
      return;
  }
}
