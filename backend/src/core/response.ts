import type { Response } from "express";
import {
  HttpStatus,
  type ErrorCodeValue,
  type HttpStatusCode,
} from "./http-status.js";
import type { ErrorDetail } from "./errors.js";

/**
 * The response envelope.
 *
 * Every response this API produces — success or failure — has a `success`
 * discriminant, so a client can narrow with a single check and never has to
 * guess from the status code alone. `requestId` is present on every response
 * so a user reporting a problem can quote one value that finds the exact log
 * line.
 */

export interface PaginationMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ResponseMeta {
  pagination?: PaginationMeta;
  [key: string]: unknown;
}

export interface SuccessResponse<T> {
  success: true;
  data: T;
  meta?: ResponseMeta;
  requestId: string;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: ErrorCodeValue;
    message: string;
    /** Present only on validation failures. */
    details?: ErrorDetail[];
  };
  requestId: string;
}

export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

/* -------------------------------------------------------------------------- */

/** Sends `200 OK` (or the given 2xx status) with a data payload. */
export function sendSuccess<T>(
  res: Response,
  data: T,
  options: { status?: HttpStatusCode; meta?: ResponseMeta } = {},
): void {
  const body: SuccessResponse<T> = {
    success: true,
    data,
    requestId: res.locals.requestId,
  };
  if (options.meta) body.meta = options.meta;

  res.status(options.status ?? HttpStatus.OK).json(body);
}

/** Sends `201 Created`, optionally with a `Location` header. */
export function sendCreated<T>(res: Response, data: T, location?: string): void {
  if (location) res.setHeader("Location", location);
  sendSuccess(res, data, { status: HttpStatus.CREATED });
}

/**
 * Sends `204 No Content`.
 *
 * Note there is deliberately no body — a 204 with a JSON envelope is a
 * protocol violation that trips proxies and some HTTP clients.
 */
export function sendNoContent(res: Response): void {
  res.status(HttpStatus.NO_CONTENT).end();
}

/** Sends a paginated collection with computed pagination metadata. */
export function sendPaginated<T>(
  res: Response,
  items: T[],
  pagination: { page: number; perPage: number; total: number },
): void {
  const totalPages = pagination.perPage > 0
    ? Math.ceil(pagination.total / pagination.perPage)
    : 0;

  sendSuccess(res, items, {
    meta: {
      pagination: {
        page: pagination.page,
        perPage: pagination.perPage,
        total: pagination.total,
        totalPages,
        hasNext: pagination.page < totalPages,
        hasPrev: pagination.page > 1,
      },
    },
  });
}

/**
 * Sends an error envelope.
 *
 * Only the central error handler should call this — controllers throw
 * `AppError`s instead, so that logging and status mapping happen in exactly
 * one place.
 */
export function sendError(
  res: Response,
  options: {
    status: HttpStatusCode;
    code: ErrorCodeValue;
    message: string;
    details?: ErrorDetail[];
  },
): void {
  const body: ErrorResponse = {
    success: false,
    error: {
      code: options.code,
      message: options.message,
    },
    requestId: res.locals.requestId,
  };
  if (options.details?.length) body.error.details = options.details;

  res.status(options.status).json(body);
}
