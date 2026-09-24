/** Size and MIME rules for portable Plan image assets. */

/** 2 MB in bytes. */
export const PLAN_ASSET_MAX_SINGLE_BYTES = 2 * 1024 * 1024;

/** 10 MB in bytes. */
export const PLAN_ASSET_MAX_TOTAL_BYTES = 10 * 1024 * 1024;

/** Allowed filename extensions -> MIME types. */
const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/**
 * Derive the MIME type from a filename extension.
 * Returns `null` for unsupported/disallowed extensions.
 */
export function mimeTypeFromFilename(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? null;
}
