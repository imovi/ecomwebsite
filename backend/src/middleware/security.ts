import cors, { type CorsOptions } from "cors";
import helmet from "helmet";
import type { RequestHandler } from "express";
import { config } from "../config/index.js";
import { ForbiddenError } from "../core/errors.js";

/**
 * Security headers.
 *
 * This is a JSON API, not an HTML app, so the policy is tuned accordingly: a
 * CSP that forbids everything (nothing should ever be rendered from an API
 * response), and `crossOriginResourcePolicy` relaxed only because uploaded
 * files are served from this origin and consumed by the storefront on another.
 */
export const securityHeaders: RequestHandler = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      "default-src": ["'none'"],
      "frame-ancestors": ["'none'"],
      "base-uri": ["'none'"],
      "form-action": ["'none'"],
      /* Uploaded images are served from this origin. */
      "img-src": ["'self'"],
    },
  },

  /* Uploads are fetched cross-origin by the storefront. */
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,

  /* Force HTTPS for a year, including subdomains. Only meaningful over TLS,
     which is why it is gated on production. */
  strictTransportSecurity: config.isProduction
    ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
    : false,

  referrerPolicy: { policy: "no-referrer" },
  /* Stops a browser from MIME-sniffing a JSON response into something
     executable — the main XSS vector an API can actually create. */
  noSniff: true,
  xFrameOptions: { action: "deny" },
  /* Do not advertise the stack. */
  hidePoweredBy: true,
});

/**
 * CORS.
 *
 * An explicit allow-list, never a reflected origin, because the API sends
 * credentials (the refresh cookie) and reflecting `Origin` with
 * `Allow-Credentials: true` lets any site on the internet call this API as a
 * logged-in admin.
 *
 * Requests with no `Origin` header — server-to-server, curl, health probes —
 * are allowed: CORS is a browser mechanism and blocking them protects nobody.
 */
const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    if (config.cors.origins.includes(origin)) {
      return callback(null, true);
    }

    callback(new ForbiddenError(`Origin ${origin} is not allowed by CORS policy.`));
  },
  credentials: config.cors.credentials,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
  exposedHeaders: ["X-Request-Id", "Retry-After"],
  maxAge: 600,
  optionsSuccessStatus: 204,
};

export const corsMiddleware: RequestHandler = cors(corsOptions);
