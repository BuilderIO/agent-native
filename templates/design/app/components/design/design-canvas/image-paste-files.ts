import type {
  IframeImagePasteFile,
  IframeImagePasteSkipped,
} from "./iframe-events";

export const MAX_IMAGE_PASTE_FILES = 20;
// Compared against the data URL's length, and base64 spends 4 characters on
// every 3 bytes of file, so this admits about 15 MB of file, not 20.
export const MAX_IMAGE_PASTE_DATA_URL_CHARS = 20 * 1024 * 1024;
export const MAX_IMAGE_PASTE_FILE_MB = Math.floor(
  (MAX_IMAGE_PASTE_DATA_URL_CHARS * 3) / 4 / (1024 * 1024),
);

// Entries past the file cap are counted as `tooMany` without being inspected,
// so a pile of 25 files reports 5 skipped however large those last 5 are.
export function filterPastedMediaFiles(raw: unknown): {
  files: IframeImagePasteFile[];
  skipped: IframeImagePasteSkipped;
} {
  const entries = Array.isArray(raw) ? raw : [];
  const skipped: IframeImagePasteSkipped = {
    tooMany: Math.max(0, entries.length - MAX_IMAGE_PASTE_FILES),
    tooLarge: 0,
    invalid: 0,
  };
  const files: IframeImagePasteFile[] = [];
  for (const entry of entries.slice(0, MAX_IMAGE_PASTE_FILES)) {
    const dataUrl =
      entry && typeof entry === "object"
        ? (entry as { dataUrl?: unknown }).dataUrl
        : undefined;
    if (
      typeof dataUrl !== "string" ||
      !(dataUrl.startsWith("data:image/") || dataUrl.startsWith("data:video/"))
    ) {
      skipped.invalid += 1;
    } else if (dataUrl.length > MAX_IMAGE_PASTE_DATA_URL_CHARS) {
      skipped.tooLarge += 1;
    } else {
      files.push(entry as IframeImagePasteFile);
    }
  }
  return { files, skipped };
}

export function hasSkippedImagePaste(skipped: IframeImagePasteSkipped) {
  return skipped.tooMany + skipped.tooLarge + skipped.invalid > 0;
}
