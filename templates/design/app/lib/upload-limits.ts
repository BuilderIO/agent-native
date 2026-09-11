/** Mirrors the server wire cap in `server/lib/request-body-limits.ts`; the two
 * are held together by the alignment test in `design-file-upload.test.ts`. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / 1024 / 1024;
