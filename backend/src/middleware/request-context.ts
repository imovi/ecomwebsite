import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { pinoHttp } from "pino-http";
import { logger } from "../core/logger.js";
import { config } from "../config/index.js";

/** Header used to accept and echo a correlation id. */
export const REQUEST_ID_HEADER = "x-request-id";

/** UUID v4, loosely — enough to reject junk without being pedantic. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Assigns every request a correlation id.
 *
 * An inbound `x-request-id` is honoured so a trace started at the edge (or in
 * the storefront) stays intact across services — but only if it looks like a
 * UUID. Echoing arbitrary client input into every log line and response header
 * is a log-injection and header-splitting vector.
 */
export const requestContext: RequestHandler = (req, res, next) => {
  const inbound = req.get(REQUEST_ID_HEADER);
  const requestId = inbound && UUID_PATTERN.test(inbound) ? inbound : randomUUID();

  req.id = requestId;
  res.locals.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  next();
};

/**
 * Request/response logging.
 *
 * One structured line per completed request, with the level chosen by outcome
 * so a 500 is never buried at `info`. Health checks are silenced — a load
 * balancer probing every few seconds otherwise drowns the log.
 */
export const requestLogger: RequestHandler = pinoHttp({
  logger,
  genReqId: (req) => (req as { id?: string }).id ?? randomUUID(),
  quietReqLogger: true,

  customLogLevel: (req, res, error) => {
    if (error || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    if (req.url?.startsWith("/health")) return "silent";
    return "info";
  },

  customSuccessMessage: (req, res) => `${req.method} ${req.url} → ${res.statusCode}`,
  customErrorMessage: (req, res, error) =>
    `${req.method} ${req.url} → ${res.statusCode} (${error.message})`,

  /* Trim the default serialisers down to what is actually useful in an
     incident, and keep request bodies out of the log entirely — they contain
     passwords on exactly the routes most likely to be investigated. */
  /* pino-http types these as `any`; annotating the shapes we actually read
     keeps the strict lint rules satisfied and documents the contract. */
  serializers: {
    req: (req: { id?: unknown; method?: string; url?: string; remoteAddress?: string }) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      remoteAddress: config.isProduction ? undefined : req.remoteAddress,
    }),
    res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
  },
});

/**
 * Attaches a per-request child logger.
 *
 * Handlers use `req.log.info(...)` and the request id is included
 * automatically, which is what makes a single `requestId` grep return the
 * whole story of one request.
 */
export const attachRequestLogger: RequestHandler = (req, _res, next) => {
  req.log = logger.child({ requestId: req.id });
  next();
};
