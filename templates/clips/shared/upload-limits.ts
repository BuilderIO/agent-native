/**
 * Single source of truth for the maximum recording / file upload size.
 *
 * Override per-deployment with the `CLIPS_MAX_UPLOAD_BYTES` env var (a byte
 * count). This is read server-side and at build time; the browser pre-flight
 * check falls back to the default when `process.env` is unavailable, but the
 * server routes (chunk / reset-chunks / finalize) are the authoritative gate.
 *
 * Importable from the client (`@shared/upload-limits`), server routes, and
 * actions. The Rust desktop app mirrors this limit independently in
 * `desktop/src-tauri/src/native_screen.rs` (same env var, same default).
 */

/** Default maximum upload size: 2 GB. The upload provider streams large files
 * directly, so this is a generous safety ceiling rather than a hard product
 * limit. It mainly bounds how long a high-bitrate (crisp 1080p) recording can
 * run before it must be split — ~34 min at the 8 Mbps capture default. */
export const DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/** Env var that overrides the upload ceiling, in bytes. */
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

/** Maximum total bytes a single recording / file upload may be. */
export const MAX_UPLOAD_BYTES = resolveMaxUploadBytes();
