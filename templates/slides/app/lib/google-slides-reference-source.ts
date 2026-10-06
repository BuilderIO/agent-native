export type GoogleSlidesImportPayload =
  | { presentationUrl: string }
  | { fileId: string };

/**
 * The shared reference-source text field accepts either a docs.google.com
 * presentation URL or a bare Picker file ID. import-google-slides-reference's
 * schema requires `presentationUrl` to be a URL, so a bare ID must go through
 * `fileId` instead or the action rejects it before it can import anything.
 */
export function resolveGoogleSlidesImportPayload(
  value: string,
): GoogleSlidesImportPayload {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed)
    ? { presentationUrl: trimmed }
    : { fileId: trimmed };
}
