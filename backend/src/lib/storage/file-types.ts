/**
 * Content-based file type detection.
 *
 * The `Content-Type` header and the file extension are both attacker-supplied
 * and must never be trusted. `evil.php` renamed to `photo.jpg` and sent as
 * `image/jpeg` passes every naive check; only reading the file's own magic
 * bytes catches it.
 *
 * A small hand-rolled sniffer rather than a dependency, because the allow-list
 * here is deliberately short — the images an e-commerce catalogue actually
 * needs. Anything not on this list is rejected, which is the correct default
 * for user-supplied binaries.
 */

export interface FileTypeSignature {
  mimeType: string;
  extension: string;
  /** Byte offset the pattern starts at. */
  offset: number;
  /** Bytes to match; `null` is a wildcard. */
  magic: (number | null)[];
}

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

const SIGNATURES: FileTypeSignature[] = [
  {
    mimeType: "image/jpeg",
    extension: ".jpg",
    offset: 0,
    magic: [0xff, 0xd8, 0xff],
  },
  {
    mimeType: "image/png",
    extension: ".png",
    offset: 0,
    magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  {
    mimeType: "image/gif",
    extension: ".gif",
    offset: 0,
    magic: ascii("GIF8"),
  },
  {
    /* RIFF container: "RIFF" + 4 size bytes (wildcards) + "WEBP". */
    mimeType: "image/webp",
    extension: ".webp",
    offset: 0,
    magic: [...ascii("RIFF"), null, null, null, null, ...ascii("WEBP")],
  },
  {
    /* ISO-BMFF: 4 size bytes, then "ftypavif". */
    mimeType: "image/avif",
    extension: ".avif",
    offset: 4,
    magic: ascii("ftypavif"),
  },
  {
    mimeType: "image/avif",
    extension: ".avif",
    offset: 4,
    magic: ascii("ftypavis"),
  },
];

/** Longest offset+pattern, so callers know how many bytes to read. */
export const MAX_SIGNATURE_BYTES = SIGNATURES.reduce(
  (max, signature) => Math.max(max, signature.offset + signature.magic.length),
  0,
);

/**
 * Identifies a buffer by its magic bytes.
 *
 * Returns undefined for anything unrecognised — which is a rejection, not a
 * fallback to the client's claimed type.
 */
export function detectFileType(buffer: Buffer): FileTypeSignature | undefined {
  return SIGNATURES.find((signature) => {
    if (buffer.length < signature.offset + signature.magic.length) return false;

    return signature.magic.every((byte, index) => {
      if (byte === null) return true;
      return buffer[signature.offset + index] === byte;
    });
  });
}

/** Canonical extension for a detected MIME type. */
export function extensionForMimeType(mimeType: string): string {
  return SIGNATURES.find((signature) => signature.mimeType === mimeType)?.extension ?? ".bin";
}

/** Every type this system will accept. Used for error messages and docs. */
export const SUPPORTED_IMAGE_TYPES: readonly string[] = [
  ...new Set(SIGNATURES.map((signature) => signature.mimeType)),
];
