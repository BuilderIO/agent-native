/**
 * Netlify base64-encodes the body into a 6 MB function payload, so uploads need
 * ~33% headroom; above this the platform 413s with an empty body before any
 * handler runs, and raising the number here cannot help.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / 1024 / 1024;

/** Multipart boundaries and field headers carried on top of the file bytes. */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
export const TOTAL_BODY_LIMIT = MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES;
