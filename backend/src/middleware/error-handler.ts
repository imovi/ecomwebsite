import type { ErrorRequestHandler, RequestHandler } from "express";
import { MulterError } from "multer";
import { ZodError } from "zod";
import { config } from "../config/index.js";
import {
  AppError,
  BadRequestError,
  NotFoundError,
  ValidationError,
  toAppError,
  type ErrorDetail,
} from "../core/errors.js";
import { ErrorCode, HttpStatus } from "../core/http-status.js";
import { sendError } from "../core/response.js";

/**
 * Centralised error handling.
 *
 * Every failure in the application converges here, which is what makes the
 * error contract actually consistent: one place decides the status code, one
 * place decides what the client is told, one place logs.
 *
 * The governing rule is `isOperational`. Expected failures are described
 * honestly to the client. Unexpected ones are logged with their full stack and
 * reported as a bare 500 — because their messages routinely contain connection
 * strings, SQL fragments and filesystem paths.
 */

/** Postgres error codes worth translating into a meaningful client response. */
const PG_ERROR_CODES = {
  UNIQUE_VIOLATION: "23505",
  FOREIGN_KEY_VIOLATION: "23503",
  NOT_NULL_VIOLATION: "23502",
  CHECK_VIOLATION: "23514",
  INVALID_TEXT_REPRESENTATION: "22P02",
  CONNECTION_FAILURE: "08006",
} as const;

interface PostgresError {
  code: string;
  constraint?: string;
  detail?: string;
}

function isPostgresError(error: unknown): error is PostgresError {
  return (
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
  );
}

/** Body-parser attaches these on malformed JSON. */
function isBodyParserError(
  error: unknown,
): error is Error & { type?: string; status?: number } {
  return error instanceof Error && "type" in error;
}

/**
 * Maps a raw throw onto an AppError.
 *
 * Nothing in here leaks database internals: a unique violation becomes a
 * generic 409, not a message naming the constraint and the colliding value.
 */
function normalise(error: unknown): AppError {
  if (error instanceof AppError) return error;

  /* A Zod error escaping a service (rather than the validate middleware). */
  if (error instanceof ZodError) {
    const details: ErrorDetail[] = error.issues.map((issue) => ({
      field: issue.path.map(String).join(".") || "(root)",
      message: issue.message,
    }));
    return new ValidationError(details);
  }

  if (error instanceof MulterError) {
    switch (error.code) {
      case "LIMIT_FILE_SIZE":
        return new AppError({
          message: `File exceeds the ${config.upload.maxFileSizeBytes / (1024 * 1024)}MB limit.`,
          statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
          code: ErrorCode.FILE_TOO_LARGE,
        });
      case "LIMIT_FILE_COUNT":
      case "LIMIT_UNEXPECTED_FILE":
        return new AppError({
          message: `At most ${config.upload.maxFiles} files may be uploaded at once.`,
          statusCode: HttpStatus.BAD_REQUEST,
          code: ErrorCode.TOO_MANY_FILES,
        });
      default:
        return new BadRequestError(`File upload failed: ${error.code}.`);
    }
  }

  if (isBodyParserError(error) && error.type === "entity.parse.failed") {
    return new BadRequestError(
      "Request body is not valid JSON.",
      ErrorCode.MALFORMED_JSON,
    );
  }

  if (isBodyParserError(error) && error.type === "entity.too.large") {
    return new AppError({
      message: `Request body exceeds the ${config.server.bodyLimit} limit.`,
      statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      code: ErrorCode.PAYLOAD_TOO_LARGE,
    });
  }

  if (isPostgresError(error)) {
    switch (error.code) {
      case PG_ERROR_CODES.UNIQUE_VIOLATION:
        return new AppError({
          message: "A record with these details already exists.",
          statusCode: HttpStatus.CONFLICT,
          code: ErrorCode.ALREADY_EXISTS,
          cause: error,
        });
      case PG_ERROR_CODES.FOREIGN_KEY_VIOLATION:
        return new AppError({
          message: "A referenced record does not exist.",
          statusCode: HttpStatus.CONFLICT,
          code: ErrorCode.CONFLICT,
          cause: error,
        });
      case PG_ERROR_CODES.NOT_NULL_VIOLATION:
      case PG_ERROR_CODES.CHECK_VIOLATION:
      case PG_ERROR_CODES.INVALID_TEXT_REPRESENTATION:
        return new BadRequestError("The submitted data is not valid.");
      default:
        break;
    }
  }

  return toAppError(error);
}

/**
 * Terminal error middleware.
 *
 * Must declare four parameters — Express identifies error handlers by arity,
 * and dropping `_next` silently turns this into ordinary middleware that never
 * runs.
 */
export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req,
  res,
  _next,
) => {
  const appError = normalise(error);

  /* Log before responding, and log the original throw rather than the
     normalised one so the stack points at the real origin. */
  const logPayload = {
    err: error,
    statusCode: appError.statusCode,
    code: appError.code,
    method: req.method,
    path: req.originalUrl,
    adminId: req.auth?.adminId,
  };

  if (appError.isOperational) {
    /* Expected failures are not incidents. 5xx still warrants attention. */
    if (appError.statusCode >= 500) {
      req.log?.error(logPayload, appError.message);
    } else {
      req.log?.warn(logPayload, appError.message);
    }
  } else {
    req.log?.error(logPayload, `Unhandled error: ${appError.message}`);
  }

  if (res.headersSent) {
    /* The response is already streaming; the only correct action left is to
       destroy the socket so the client sees a truncated response rather than
       a valid-looking partial one. */
    res.destroy();
    return;
  }

  if (appError.retryAfterSeconds !== undefined) {
    res.setHeader("Retry-After", String(appError.retryAfterSeconds));
  }

  /* Non-operational errors are never described to the client in production.
     In development the real message is far more useful than a generic one. */
  const message =
    appError.isOperational || !config.isProduction
      ? appError.message
      : "An unexpected error occurred.";

  sendError(res, {
    status: appError.statusCode,
    code: appError.code,
    message,
    ...(appError.details ? { details: appError.details } : {}),
  });
};

/** Terminal 404 for unmatched routes. Registered after every router. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(
    new NotFoundError(
      `Route ${req.method} ${req.originalUrl} does not exist.`,
      ErrorCode.ROUTE_NOT_FOUND,
    ),
  );
};
