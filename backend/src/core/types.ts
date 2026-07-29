import type { Logger } from "pino";
import type { AdminRole } from "../db/schema/enums.js";

/**
 * Ambient Express type augmentation.
 *
 * Middleware attaches per-request state here. Declaring it globally means
 * `req.auth.adminId` is fully typed in every handler without casts, and
 * removing a middleware becomes a compile error at every place that relied on
 * what it set.
 */

/** Identity extracted from a verified access token. */
export interface AuthContext {
  adminId: string;
  email: string;
  role: AdminRole;
  /** JWT ID — correlates an access token with the log line that issued it. */
  tokenId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id, also echoed in the response body and header. */
      id: string;
      /** Child logger pre-bound with the request id. */
      log: Logger;
      /** Present only after `authenticate` has run. */
      auth?: AuthContext;
      /** Populated by `validate()` — the parsed, coerced, trusted input. */
      validated?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }

    interface Locals {
      requestId: string;
    }
  }
}

export {};
