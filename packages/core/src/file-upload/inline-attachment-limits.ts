
import { isSpreadsheetDocument } from "../ingestion/spreadsheet.js";

export const MAX_INLINE_FILE_BASE64_CHARS = 1_000_000;

export const MAX_INLINE_IMAGE_BASE64_CHARS = 5_000_000;

const INLINE_VISION_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/;

export function isInlineVisionMediaType(
  mediaType: string | undefined,
): boolean {
  if (!mediaType) return false;
  return INLINE_VISION_MEDIA_TYPES.has(
    mediaType.split(";")[0]!.trim().toLowerCase(),
  );
}

export function formatBase64CharBudget(maxChars: number): string {
  const decodedMb = (maxChars * 0.75) / (1024 * 1024);
  return `${decodedMb.toFixed(1)} MB`;
}

function isInlineReadableDocumentType(
  mediaType: string,
  fileName: string | undefined,
): boolean {
  const normalized = mediaType.split(";")[0]!.trim().toLowerCase();
  if (normalized === "application/pdf") return true;
  if (normalized.startsWith("text/")) return true;
  return isSpreadsheetDocument(fileName ?? "", normalized);
}

export type InlineAttachmentBlockReason =
  | { kind: "no-data" }
  | { kind: "unsupported-image-format"; mediaType: string }
  | { kind: "unsupported-file-format"; mediaType: string }
  | { kind: "over-inline-limit"; maxChars: number; actualChars: number };

export function describeInlineBlockReason(
  reason: InlineAttachmentBlockReason,
): string {
  switch (reason.kind) {
    case "no-data":
      return "no readable content was attached";
    case "unsupported-image-format":
      return `${reason.mediaType} is not an image format any vision model decodes`;
    case "unsupported-file-format":
      return `${reason.mediaType} is not a document format the model can read inline`;
    case "over-inline-limit":
      return `over the ${formatBase64CharBudget(reason.maxChars)} inline limit`;
  }
}

export function classifyInlineAttachment(att: {
  type?: string;
  name?: string;
  data?: string;
  text?: string;
  contentType?: string;
  referenceOnly?: boolean;
}): InlineAttachmentBlockReason | null {
  if (att.referenceOnly === true) return { kind: "no-data" };
  if (typeof att.text === "string" && att.text.length > 0) return null;

  const match =
    typeof att.data === "string" ? att.data.match(DATA_URL_RE) : null;
  if (!match) return { kind: "no-data" };

  const mediaType = (match[1] || att.contentType || "").toLowerCase();
  const base64Chars = match[2]!.length;

  if (att.type === "image") {
    if (!isInlineVisionMediaType(mediaType)) {
      return { kind: "unsupported-image-format", mediaType };
    }
    return base64Chars > MAX_INLINE_IMAGE_BASE64_CHARS
      ? {
          kind: "over-inline-limit",
          maxChars: MAX_INLINE_IMAGE_BASE64_CHARS,
          actualChars: base64Chars,
        }
      : null;
  }

  if (base64Chars > MAX_INLINE_FILE_BASE64_CHARS) {
    return {
      kind: "over-inline-limit",
      maxChars: MAX_INLINE_FILE_BASE64_CHARS,
      actualChars: base64Chars,
    };
  }
  return isInlineReadableDocumentType(mediaType, att.name)
    ? null
    : { kind: "unsupported-file-format", mediaType };
}
