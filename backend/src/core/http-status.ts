/**
 * The HTTP status codes this API actually uses.
 *
 * A closed set rather than a library: it documents the response contract, and
 * `HttpStatus[keyof typeof HttpStatus]` gives errors a precise union type
 * instead of `number`.
 */
export const HttpStatus = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,

  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  GONE: 410,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,

  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type HttpStatusCode = (typeof HttpStatus)[keyof typeof HttpStatus];

/**
 * Machine-readable error codes.
 *
 * Clients branch on `error.code`, never on `error.message` — messages are for
 * humans and are free to change without breaking a consumer.
 */
export const ErrorCode = {
  // 400 family
  BAD_REQUEST: "BAD_REQUEST",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  MALFORMED_JSON: "MALFORMED_JSON",

  // 401 / 403
  UNAUTHORIZED: "UNAUTHORIZED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_INVALID: "TOKEN_INVALID",
  REFRESH_TOKEN_REUSED: "REFRESH_TOKEN_REUSED",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  ACCOUNT_DISABLED: "ACCOUNT_DISABLED",
  FORBIDDEN: "FORBIDDEN",
  INSUFFICIENT_ROLE: "INSUFFICIENT_ROLE",

  // 404 / 409
  NOT_FOUND: "NOT_FOUND",
  ROUTE_NOT_FOUND: "ROUTE_NOT_FOUND",
  CONFLICT: "CONFLICT",
  ALREADY_EXISTS: "ALREADY_EXISTS",

  // 413 / 415 / 429
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  TOO_MANY_FILES: "TOO_MANY_FILES",
  UNSUPPORTED_FILE_TYPE: "UNSUPPORTED_FILE_TYPE",
  UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
  RATE_LIMITED: "RATE_LIMITED",

  // 5xx
  INTERNAL_ERROR: "INTERNAL_ERROR",
  DATABASE_ERROR: "DATABASE_ERROR",
  STORAGE_ERROR: "STORAGE_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
