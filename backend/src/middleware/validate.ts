import type { RequestHandler } from "express";
import type { ZodError, ZodType } from "zod";
import { ValidationError, type ErrorDetail } from "../core/errors.js";

/**
 * Request validation.
 *
 * Schemas describe `body`, `query` and `params` independently, and the parsed
 * result is written to `req.validated` — never back onto `req.query`, which is
 * a getter in Express 5 and throws on assignment.
 *
 * Handlers read `validated<T>(req).body`, which is typed. Reading `req.body`
 * directly in a handler bypasses validation and is the pattern this exists to
 * eliminate.
 *
 *   router.post(
 *     "/login",
 *     validate({ body: loginSchema }),
 *     (req, res) => {
 *       const { email } = validated<LoginInput>(req).body;
 *     },
 *   );
 */

export interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/** Flattens Zod issues into the API's field-level error detail shape. */
function toDetails(error: ZodError, source: keyof ValidationSchemas): ErrorDetail[] {
  return error.issues.map((issue) => {
    const path = issue.path
      .map((segment) => (typeof segment === "number" ? `[${segment}]` : String(segment)))
      .join(".")
      .replace(/\.\[/g, "[");

    return {
      field: path ? `${source}.${path}` : source,
      message: issue.message,
    };
  });
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    const details: ErrorDetail[] = [];
    const output: NonNullable<typeof req.validated> = {};

    for (const source of ["params", "query", "body"] as const) {
      const schema = schemas[source];
      if (!schema) continue;

      const result = schema.safeParse(req[source]);
      if (result.success) {
        output[source] = result.data;
      } else {
        /* Collect every source's issues before failing, so the client can fix
           a bad query param and a bad body field in one round trip. */
        details.push(...toDetails(result.error, source));
      }
    }

    if (details.length > 0) {
      next(new ValidationError(details));
      return;
    }

    req.validated = output;
    next();
  };
}

/**
 * Typed accessor for validated input.
 *
 * The cast is safe because `validate()` is the only writer of `req.validated`
 * and it writes exactly what the schema produced. Keeping the cast in one
 * place means handlers stay cast-free.
 */
export function validated<TBody = unknown, TQuery = unknown, TParams = unknown>(req: {
  validated?: { body?: unknown; query?: unknown; params?: unknown };
}): { body: TBody; query: TQuery; params: TParams } {
  const source = req.validated ?? {};
  return {
    body: source.body as TBody,
    query: source.query as TQuery,
    params: source.params as TParams,
  };
}
