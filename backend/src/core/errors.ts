import {
  ErrorCode,
  HttpStatus,
  type ErrorCodeValue,
  type HttpStatusCode,
} from "./http-status.js";

/** Field-level detail attached to validation failures. */
export interface ErrorDetail {
  /** Dot/bracket path to the offending field, e.g. `body.email`. */
  field: string;
  message: string;
}

/**
 * Base class for every error this application raises deliberately.
 *
 * The key property is `isOperational`. An operational error is an expected
 * outcome — bad credentials, a missing record, a rate limit — and is safe to
 * describe to the client. Anything else (a TypeError, a driver crash) is a
 * programmer error: it gets logged in full and reported to the client as a
 * generic 500, because its message may contain connection strings, SQL, or
 * internal paths.
 *
 * That distinction is the whole reason this class exists, and it is what the
 * central error handler branches on.
 */
export class AppError extends Error {
  readonly statusCode: HttpStatusCode;
  readonly code: ErrorCodeValue;
  readonly details?: ErrorDetail[];
  readonly isOperational: boolean;
  /** Populated for 429 and 503 to drive a `Retry-After` header. */
  readonly retryAfterSeconds?: number;

  constructor(options: {
    message: string;
    statusCode?: HttpStatusCode;
    code?: ErrorCodeValue;
    details?: ErrorDetail[];
    isOperational?: boolean;
    retryAfterSeconds?: number;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });

    this.name = new.target.name;
    this.statusCode = options.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR;
    this.code = options.code ?? ErrorCode.INTERNAL_ERROR;
    this.isOperational = options.isOperational ?? true;
    if (options.details) this.details = options.details;
    if (options.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }

    Error.captureStackTrace(this, new.target);
  }
}

/* -------------------------------------------------------------------------- */
/* 4xx                                                                        */
/* -------------------------------------------------------------------------- */

export class BadRequestError extends AppError {
  constructor(message = "Malformed request.", code: ErrorCodeValue = ErrorCode.BAD_REQUEST) {
    super({ message, statusCode: HttpStatus.BAD_REQUEST, code });
  }
}

export class ValidationError extends AppError {
  constructor(details: ErrorDetail[], message = "The submitted data is invalid.") {
    super({
      message,
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      code: ErrorCode.VALIDATION_ERROR,
      details,
    });
  }
}

export class UnauthorizedError extends AppError {
  constructor(
    message = "Authentication is required.",
    code: ErrorCodeValue = ErrorCode.UNAUTHORIZED,
  ) {
    super({ message, statusCode: HttpStatus.UNAUTHORIZED, code });
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = "You do not have permission to perform this action.",
    code: ErrorCodeValue = ErrorCode.FORBIDDEN,
  ) {
    super({ message, statusCode: HttpStatus.FORBIDDEN, code });
  }
}

export class NotFoundError extends AppError {
  constructor(
    message = "The requested resource was not found.",
    code: ErrorCodeValue = ErrorCode.NOT_FOUND,
  ) {
    super({ message, statusCode: HttpStatus.NOT_FOUND, code });
  }
}

export class ConflictError extends AppError {
  constructor(
    message = "The request conflicts with the current state.",
    code: ErrorCodeValue = ErrorCode.CONFLICT,
  ) {
    super({ message, statusCode: HttpStatus.CONFLICT, code });
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(
    message = "The request payload is too large.",
    code: ErrorCodeValue = ErrorCode.PAYLOAD_TOO_LARGE,
  ) {
    super({ message, statusCode: HttpStatus.PAYLOAD_TOO_LARGE, code });
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(
    message = "Unsupported media type.",
    code: ErrorCodeValue = ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  ) {
    super({ message, statusCode: HttpStatus.UNSUPPORTED_MEDIA_TYPE, code });
  }
}

export class TooManyRequestsError extends AppError {
  constructor(retryAfterSeconds: number, message = "Too many requests. Please slow down.") {
    super({
      message,
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      code: ErrorCode.RATE_LIMITED,
      retryAfterSeconds,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* 5xx                                                                        */
/* -------------------------------------------------------------------------- */

export class InternalError extends AppError {
  constructor(message = "An unexpected error occurred.", cause?: unknown) {
    super({
      message,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      isOperational: false,
      cause,
    });
  }
}

export class DatabaseError extends AppError {
  constructor(message = "A database error occurred.", cause?: unknown) {
    super({
      message,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.DATABASE_ERROR,
      isOperational: false,
      cause,
    });
  }
}

export class StorageError extends AppError {
  constructor(message = "A file storage error occurred.", cause?: unknown) {
    super({
      message,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.STORAGE_ERROR,
      isOperational: false,
      cause,
    });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "The service is temporarily unavailable.", retryAfterSeconds = 30) {
    super({
      message,
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      code: ErrorCode.SERVICE_UNAVAILABLE,
      retryAfterSeconds,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Normalises anything thrown into an `AppError`.
 *
 * Non-`AppError` throws are wrapped as non-operational, so their original
 * message never reaches the client.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;

  if (error instanceof Error) {
    return new InternalError(error.message, error);
  }

  return new InternalError("An unexpected error occurred.", error);
}
