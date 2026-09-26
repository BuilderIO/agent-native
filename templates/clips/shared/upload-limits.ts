
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
