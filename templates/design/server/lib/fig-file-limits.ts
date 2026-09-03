/** Decoder caps for the experimental untrusted `.fig` path. The wire cap that
 * bounds what can actually be uploaded lives in `request-body-limits.ts`. */
export const MAX_FIG_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_FIG_DECOMPRESSED_BYTES = 96 * 1024 * 1024;
