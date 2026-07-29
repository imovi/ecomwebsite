import type { RequestHandler } from "express";
import multer, { memoryStorage, type Multer } from "multer";
import { config } from "../config/index.js";
import { AppError } from "../core/errors.js";
import { ErrorCode, HttpStatus } from "../core/http-status.js";
import {
  detectFileType,
  SUPPORTED_IMAGE_TYPES,
  type StoredFile,
} from "../lib/storage/index.js";
import { getStorage } from "../lib/storage/index.js";

/**
 * File upload foundation.
 *
 * Reusable plumbing only — no product routes exist yet, and none are created
 * here. A future module composes these:
 *
 *   router.post(
 *     "/products/:id/images",
 *     authenticate, requireRole("admin"),
 *     uploadImages("images", 5),
 *     persistUploads("products"),
 *     handler,
 *   );
 *
 * Design notes:
 *
 * - **Memory storage, not disk.** Multer's disk storage writes the file before
 *   any validation runs, so a rejected upload still touched the filesystem.
 *   Buffering in memory means an invalid file is discarded having never
 *   existed on disk. Safe because the per-file cap is a few megabytes.
 *
 * - **Two-stage type checking.** The declared MIME type is filtered early (a
 *   cheap rejection before bytes are buffered), then the *actual* content is
 *   sniffed after buffering. Only the second check is trusted.
 */

const MAX_FIELD_NAME_BYTES = 100;

function buildMulter(maxFiles: number): Multer {
  return multer({
    storage: memoryStorage(),
    limits: {
      fileSize: config.upload.maxFileSizeBytes,
      files: maxFiles,
      /* Bound every other multipart dimension too — an unbounded field count
         or name length is a cheap memory-exhaustion vector. */
      fields: 20,
      fieldNameSize: MAX_FIELD_NAME_BYTES,
      fieldSize: 100 * 1024,
      parts: maxFiles + 20,
      headerPairs: 100,
    },

    /* First-pass filter on the declared type. Rejecting here avoids buffering
       an obviously-wrong file, but is NOT the security boundary — the client
       controls this value. */
    fileFilter: (_req, file, callback) => {
      if (!SUPPORTED_IMAGE_TYPES.includes(file.mimetype)) {
        callback(
          new AppError({
            message: `Unsupported file type. Allowed: ${SUPPORTED_IMAGE_TYPES.join(", ")}.`,
            statusCode: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
            code: ErrorCode.UNSUPPORTED_FILE_TYPE,
          }),
        );
        return;
      }
      callback(null, true);
    },
  });
}

/** Accepts a single image under `field`. */
export function uploadImage(field: string): RequestHandler {
  return buildMulter(1).single(field);
}

/** Accepts up to `maxFiles` images under `field`. */
export function uploadImages(
  field: string,
  maxFiles: number = config.upload.maxFiles,
): RequestHandler {
  const limit = Math.min(maxFiles, config.upload.maxFiles);
  return buildMulter(limit).array(field, limit);
}

/**
 * Verifies real file content, then writes to the configured storage driver.
 *
 * This is the actual security boundary: every buffered file is identified by
 * its magic bytes, and anything that is not a genuine image on the allow-list
 * is rejected — regardless of its extension or declared `Content-Type`.
 *
 * Results land on `req.uploadedFiles` for the downstream handler.
 */
export function persistUploads(folder: string): RequestHandler {
  return async (req, _res, next) => {
    const files = collectFiles(req);

    if (files.length === 0) {
      req.uploadedFiles = [];
      next();
      return;
    }

    const storage = getStorage();
    const stored: StoredFile[] = [];

    try {
      for (const file of files) {
        const detected = detectFileType(file.buffer);

        if (!detected) {
          throw new AppError({
            message:
              `"${file.originalname}" is not a valid image. ` +
              `Allowed: ${SUPPORTED_IMAGE_TYPES.join(", ")}.`,
            statusCode: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
            code: ErrorCode.UNSUPPORTED_FILE_TYPE,
          });
        }

        stored.push(
          await storage.put({
            folder,
            buffer: file.buffer,
            /* The sniffed type, never `file.mimetype`. */
            mimeType: detected.mimeType,
            originalName: file.originalname,
          }),
        );
      }
    } catch (error) {
      /* Partial failure must not leave orphans. Anything already written for
         this request is removed before the error propagates. */
      await Promise.allSettled(stored.map((file) => storage.delete(file.key)));
      next(error);
      return;
    }

    req.uploadedFiles = stored;
    next();
  };
}

function collectFiles(req: {
  file?: Express.Multer.File;
  files?: Express.Multer.File[] | Record<string, Express.Multer.File[]>;
}): Express.Multer.File[] {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;
  if (req.files) return Object.values(req.files).flat();
  return [];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `persistUploads`. */
      uploadedFiles?: StoredFile[];
    }
  }
}
