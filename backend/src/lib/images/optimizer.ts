import sharp, { type Metadata } from "sharp";
import { AppError } from "../../core/errors.js";
import { ErrorCode, HttpStatus } from "../../core/http-status.js";
import { createLogger } from "../../core/logger.js";

/**
 * Image processing.
 *
 * Every uploaded image is decoded and re-encoded before it is stored. That is
 * not only about file size — re-encoding is a security control:
 *
 *  - **Polyglot files are neutralised.** A file crafted to be simultaneously a
 *    valid JPEG and a valid PHP/HTML payload does not survive a decode →
 *    re-encode round trip; only pixels come out the other side.
 *  - **EXIF is stripped.** Phone photos carry GPS coordinates and device
 *    identifiers. Serving a supplier's or staff member's home coordinates from
 *    a product image is a privacy incident nobody notices until it is one.
 *  - **Decompression bombs are rejected.** A 40KB PNG can decode to gigabytes
 *    of raw pixels; pixel limits and dimension caps are enforced before that
 *    allocation happens.
 *
 * Output is WebP: roughly 25–35% smaller than equivalent-quality JPEG, with
 * universal support in every browser this store targets. Bandwidth is the
 * dominant cost of a product page on a Bangladeshi mobile connection.
 */

const log = createLogger("images");

export const IMAGE_LIMITS = {
  /** Longest edge after resize. Above this is wasted bytes for a storefront. */
  maxDimension: 2000,
  /** Reject anything smaller — almost always an accidental thumbnail upload. */
  minDimension: 200,
  /**
   * Decoded pixel ceiling, enforced by sharp before full decode. 2000×2000 is
   * the target, so 40MP leaves generous headroom while still stopping a
   * decompression bomb.
   */
  maxPixels: 40_000_000,
  /** WebP quality. 82 is the knee of the size/quality curve for product shots. */
  quality: 82,
} as const;

export interface OptimizedImage {
  buffer: Buffer;
  width: number;
  height: number;
  /** Bytes after optimisation. */
  size: number;
  mimeType: "image/webp";
  /** Original size, for the compression figure in the upload response. */
  originalSize: number;
}

function reject(message: string, code = ErrorCode.UNSUPPORTED_FILE_TYPE): never {
  throw new AppError({
    message,
    statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    code,
  });
}

/**
 * Decodes, validates, resizes and re-encodes an image.
 *
 * Throws a 422 with an actionable message for anything unusable — a corrupt
 * file, a picture too small to display, or an animation we will not store.
 */
export async function optimizeImage(
  input: Buffer,
  options: {
    label?: string;
    /**
     * Overrides the minimum edge length.
     *
     * The 200px floor is right for product photography, where anything smaller
     * is an accidental thumbnail. It is wrong for a logo: a perfectly good
     * wordmark is often 400×80, and rejecting it would make the branding feature
     * unusable for exactly the shops most likely to have a simple logo.
     */
    minDimension?: number;
    /** Names what is being uploaded in the rejection message. */
    kind?: string;
  } = {},
): Promise<OptimizedImage> {
  const label = options.label ?? "image";
  const minDimension = options.minDimension ?? IMAGE_LIMITS.minDimension;
  const kind = options.kind ?? "Product images";

  /* `limitInputPixels` makes sharp refuse an oversized image at header-parse
     time, before allocating the decode buffer. */
  const pipeline = sharp(input, {
    limitInputPixels: IMAGE_LIMITS.maxPixels,
    sequentialRead: true,
    failOn: "error",
  });

  let metadata: Metadata;
  try {
    metadata = await pipeline.metadata();
  } catch (error) {
    log.warn({ err: error, label }, "Unreadable image rejected");
    reject(`"${label}" could not be read as an image.`);
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width === 0 || height === 0) {
    reject(`"${label}" has no readable dimensions.`);
  }

  if (width < minDimension || height < minDimension) {
    reject(
      `"${label}" is ${width}×${height}. ${kind} must be at least ` +
        `${minDimension}×${minDimension} pixels.`,
    );
  }

  try {
    const output = await pipeline
      /* Applies the EXIF orientation, then discards the tag — without this,
         portrait phone photos appear rotated once metadata is stripped. */
      .rotate()
      .resize({
        width: IMAGE_LIMITS.maxDimension,
        height: IMAGE_LIMITS.maxDimension,
        fit: "inside",
        /* Never upscale: enlarging a small image only inflates bytes. */
        withoutEnlargement: true,
      })
      .webp({ quality: IMAGE_LIMITS.quality, effort: 4 })
      /* Explicitly drop all metadata: EXIF, GPS, ICC, XMP. */
      .withMetadata({ exif: {} })
      .toBuffer({ resolveWithObject: true });

    log.debug(
      {
        label,
        from: `${width}x${height}`,
        to: `${output.info.width}x${output.info.height}`,
        bytesBefore: input.byteLength,
        bytesAfter: output.info.size,
      },
      "Image optimised",
    );

    return {
      buffer: output.data,
      width: output.info.width,
      height: output.info.height,
      size: output.info.size,
      mimeType: "image/webp",
      originalSize: input.byteLength,
    };
  } catch (error) {
    log.warn({ err: error, label }, "Image processing failed");
    reject(`"${label}" could not be processed. It may be corrupt or truncated.`);
  }
}

/** Processes a batch, preserving order. */
export async function optimizeImages(
  files: { buffer: Buffer; originalname: string }[],
): Promise<OptimizedImage[]> {
  /* Sequential on purpose. sharp uses a libuv thread pool; processing a batch
     concurrently on a small container starves every other async operation,
     including database queries, for the duration. */
  const results: OptimizedImage[] = [];
  for (const file of files) {
    results.push(await optimizeImage(file.buffer, { label: file.originalname }));
  }
  return results;
}
