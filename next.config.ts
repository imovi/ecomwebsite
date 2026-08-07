import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

/**
 * This file is evaluated BEFORE Next populates `process.env` from the `.env*`
 * files, so reading `process.env.API_URL` here would see `undefined` and the
 * image allowlist below would silently come out empty — which shows up much
 * later as a 400 from the image optimiser rather than as a config error.
 *
 * `loadEnvConfig` is the documented way to load them early from a root config
 * file. It is the same loader Next uses internally, so precedence between
 * `.env`, `.env.local` and `.env.production` is identical.
 */
loadEnvConfig(process.cwd());

/**
 * Product photos are served by the API (or, in production, by whatever object
 * store it is configured to write to), so `next/image` has to be told that host
 * is allowed — it refuses unknown remote hosts by design, since an open image
 * optimiser is an open proxy.
 *
 * Derived from `API_URL` rather than hardcoded, so the same config works for
 * localhost, staging and production without edits. `IMAGE_HOST` overrides it for
 * the case where uploads are served from a CDN on a different domain than the
 * API.
 */
function imagePatterns(): NonNullable<NextConfig["images"]>["remotePatterns"] {
  const sources = [process.env.IMAGE_HOST, process.env.API_URL].filter(
    (value): value is string => Boolean(value),
  );

  const patterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [];

  for (const source of sources) {
    try {
      const url = new URL(source);
      patterns.push({
        protocol: url.protocol.replace(":", "") as "http" | "https",
        hostname: url.hostname,
        ...(url.port ? { port: url.port } : {}),
        /* Scoped to the upload path: the optimiser should not be usable to
           fetch arbitrary URLs from the API host. */
        pathname: "/uploads/**",
      });
    } catch {
      /* A malformed URL should not take the build down — the app's own config
         validation reports it with a far better message. */
    }
  }

  return patterns;
}

const nextConfig: NextConfig = {
  /**
   * Emits `.next/standalone` with a self-contained `server.js` and only the
   * `node_modules` actually reachable at runtime. That is what keeps the
   * production image small enough to redeploy quickly on a modest VPS — the
   * alternative is shipping the full dependency tree to run `next start`.
   */
  output: "standalone",

  images: {
    remotePatterns: imagePatterns(),

    /**
     * Next 16 refuses to optimise an upstream image whose host resolves to a
     * private or loopback address, because an image optimiser that will fetch
     * `http://169.254.169.254/...` on request is an SSRF gadget.
     *
     * In development the API genuinely is on localhost, so the guard has to be
     * lifted — but only there. In production `API_URL` points at a real host and
     * this stays off, which is the whole point of scoping it to `NODE_ENV`.
     */
    dangerouslyAllowLocalIP: process.env.NODE_ENV === "development",

    /**
     * The one remaining SVG is `/placeholder-product.svg`, shown when a product
     * has no photo yet. Next refuses to optimise SVG without this flag because a
     * hostile SVG can carry script; this one is ours, committed to `public/`,
     * and the CSP below sandboxes it regardless.
     */
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",

    /** Phone-first breakpoints — no point generating 3840px variants. */
    deviceSizes: [360, 414, 640, 828, 1080, 1280, 1600],
    imageSizes: [64, 96, 128, 180, 256, 384],

    /**
     * WebP only. AVIF is deliberately NOT enabled.
     *
     * AVIF encodes perhaps 10-20% smaller than WebP and costs several times the
     * CPU to produce — a trade that makes sense where a build farm or a CDN does
     * the encoding, and not on the single modest VPS that is also rendering the
     * shop and serving the admin panel. There are thirteen breakpoints above, so
     * every product photo is that many encodes, and the first request for each
     * competes with page rendering for the same cores.
     *
     * The source images are already WebP: the API decodes, resizes and
     * re-encodes every upload at quality 82 before storing it, so the remaining
     * gain from AVIF is on top of an image that is not large to begin with.
     */
    formats: ["image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },

  experimental: {
    /** Faster cold compiles across restarts during development. */
    turbopackFileSystemCacheForDev: true,
  },
};

export default nextConfig;
