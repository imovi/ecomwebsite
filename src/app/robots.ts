import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Private or worthless-to-index surfaces. The admin panel is also
      // noindex'd via metadata, but it must never be crawled at all.
      disallow: ["/admin", "/cart", "/checkout", "/order/", "/search"],
    },
    sitemap: "https://gng.com.bd/sitemap.xml",
  };
}
