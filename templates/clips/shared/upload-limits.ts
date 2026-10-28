export const DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

export const MAX_UPLOAD_BYTES_ENV = "CLIPS_MAX_UPLOAD_BYTES";

function resolveMaxUploadBytes(): number {
  const raw =
    typeof process !== "undefined"
      ? process.env?.[MAX_UPLOAD_BYTES_ENV]
      : undefined;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return DEFAULT_MAX_UPLOAD_BYTES;
}

export const MAX_UPLOAD_BYTES = resolveMaxUploadBytes();

/**
 * Bytes as MB or GB (1024-based) to one decimal. Round a file's size up and a
 * limit down, so a refused file never reads as fitting under its limit.
 */
export function formatUploadBytes(
  bytes: number,
  rounding: "up" | "down",
): string {
  const mib = 1024 * 1024;
  const gib = 1024 * mib;
  const round = rounding === "up" ? Math.ceil : Math.floor;
  const tenths = (unit: number) => round((bytes / unit) * 10) / 10;
  return bytes >= gib ? `${tenths(gib)} GB` : `${tenths(mib)} MB`;
}
