// Owns: how large an attachment may be to travel inline to the model, and
// whether a given attachment is readable this turn without object storage.
//
// The two size limits here are NOT the same number and must never be merged
// again. `file_url` and `image_url`/`image.source.base64` are different
// provider fields with different ceilings, and collapsing them is what made an
// ordinary phone photo unreadable as chat context.

import { isSpreadsheetDocument } from "../ingestion/spreadsheet.js";

/**
 * OpenAI rejects the whole request when one `file_url` exceeds 1,048,576
 * chars: "Invalid 'input[N].content[0].file_url': string too long". Applies to
 * PDFs and other binary document parts only.
 */
export const MAX_INLINE_FILE_BASE64_CHARS = 1_000_000;

/**
 * Images travel in a different field with a far higher ceiling: Anthropic
 * rejects `image.source.base64` over 5,242,880 chars, OpenAI accepts ~20 MB.
 * Staying under the Anthropic ceiling keeps a normal phone photo inline, which
 * is the only way an attached image works as context with no storage
 * configured.
 */
export const MAX_INLINE_IMAGE_BASE64_CHARS = 5_000_000;

/** Media types every supported vision provider accepts as inline base64. */
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

/** Human-readable form of a base64-char budget, for model-visible copy. */
export function formatBase64CharBudget(maxChars: number): string {
  // base64 inflates by 4/3, so the decoded budget is what a user recognizes as
  // "the size of my photo".
  const decodedMb = (maxChars * 0.75) / (1024 * 1024);
  return `${decodedMb.toFixed(1)} MB`;
}

/**
 * Whether a non-image binary actually reaches the model as readable content.
 *
 * Only PDF survives translation as a real document block: `translate-anthropic`
 * turns every other media type into a bare `[Attached file: name (type)]`
 * placeholder. Telling the model it can "read" a DOCX is an invitation to
 * invent its contents. Spreadsheets count because `preUploadAttachments`
 * injects a parsed text preview of the cells alongside the attachment.
 */
function isInlineReadableDocumentType(
  mediaType: string,
  fileName: string | undefined,
): boolean {
  const normalized = mediaType.split(";")[0]!.trim().toLowerCase();
  if (normalized === "application/pdf") return true;
  if (normalized.startsWith("text/")) return true;
  return isSpreadsheetDocument(fileName ?? "", normalized);
}

/**
 * Why an attachment could not be handed to the model as inline content.
 * `null` means it can be: the model sees the content this turn whether or not
 * object storage exists.
 */
export type InlineAttachmentBlockReason =
  | { kind: "no-data" }
  | { kind: "unsupported-image-format"; mediaType: string }
  | { kind: "unsupported-file-format"; mediaType: string }
  | { kind: "over-inline-limit"; maxChars: number; actualChars: number };

/** Model-visible phrasing for why the model cannot read an attachment. */
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

/**
 * Classify an attachment against the inline budgets. Callers use this to keep
 * "the model cannot read this" and "this has no durable URL" as two separate
 * facts — conflating them is what produced a fabricated size-limit excuse for
 * an unconfigured-storage condition.
 */
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
