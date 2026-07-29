import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { config } from "./config/index.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { globalRateLimit } from "./middleware/rate-limit.js";
import {
  attachRequestLogger,
  requestContext,
  requestLogger,
} from "./middleware/request-context.js";
import { corsMiddleware, securityHeaders } from "./middleware/security.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { v1Router } from "./routes/v1.js";

/**
 * Express application assembly.
 *
 * Separated from `server.ts` so the app can be constructed without binding a
 * port — which is what makes integration testing possible without a live
 * socket.
 *
 * MIDDLEWARE ORDER IS THE CONTRACT. Each step below depends on the previous
 * one having run, and reordering them introduces subtle security holes rather
 * than loud failures.
 */
export function createApp(): Express {
  const app = express();

  /* 1. Proxy trust. Must precede anything reading `req.ip` — rate limiting and
        audit logging both do. Set to a hop count, never `true`: trusting every
        proxy lets a client forge X-Forwarded-For and bypass IP rate limits. */
  app.set("trust proxy", config.server.trustProxy);

  /* Do not advertise Express. */
  app.disable("x-powered-by");
  /* Reject `?a[b]=c` object-notation query strings — the simple parser avoids
     prototype-pollution and parameter-shape surprises in validation. */
  app.set("query parser", "simple");
  app.set("etag", "strong");

  /* 2. Correlation id, before logging so every line can carry it. */
  app.use(requestContext);

  /* 3. Security headers, before any route can produce a response. */
  app.use(securityHeaders);

  /* 4. CORS, before body parsing: a preflight OPTIONS has no body and should
        be answered without doing any further work. */
  app.use(corsMiddleware);

  /* 5. Request logging. After correlation, before handlers, so both the
        success and error paths are logged exactly once. */
  app.use(requestLogger);
  app.use(attachRequestLogger);

  /* 6. Body parsing, with a hard size cap. Multipart is handled per-route by
        multer, which has its own separate limits. */
  app.use(express.json({ limit: config.server.bodyLimit, strict: true }));
  app.use(
    express.urlencoded({ extended: false, limit: config.server.bodyLimit }),
  );
  app.use(cookieParser());

  /* 7. Health checks, before rate limiting — a throttled probe reads as an
        outage and can pull a healthy instance from rotation. */
  app.use("/health", healthRouter);

  /* 8. Global rate limit, after health and before business routes. */
  app.use(globalRateLimit);

  /* 9. Static uploads. `dotfiles: deny` and `index: false` stop directory
        listing and hidden-file access; immutable caching is safe because
        stored filenames are content-addressed random names that are never
        reused. */
  app.use(
    config.upload.publicPath,
    express.static(config.upload.dir, {
      dotfiles: "deny",
      index: false,
      maxAge: "30d",
      immutable: true,
      fallthrough: false,
    }),
  );

  /* 10. Versioned API. */
  app.use("/api/v1", v1Router);

  /* 11. Terminal handlers, in this order. `notFoundHandler` converts an
         unmatched route into an AppError; `errorHandler` renders every error
         through the single response envelope. */
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
