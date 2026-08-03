import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/api/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Private or worthless-to-index surfaces. The admin panel is also
      // noindex'd via metadata, but it must never be crawled at all.
      disallow: ["/admin", "/cart", "/checkout", "/order/", "/search"],
    },
    /* This deployment's own origin. A fixed domain here sends every crawler
       that reads it to someone else's sitemap. */
    sitemap: `${siteConfig.url}/sitemap.xml`,
  };
}
