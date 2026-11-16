import type { ComposeAttachment } from "./types.js";

/**
 * Compose drafts live in app state, and core refuses to store a relative link
 * there: `/api/attachments?…` reads as an unsafe attachment reference and the
 * save fails. So a compose attachment keeps only a full file-storage address;
 * Mail's own paths are rebuilt by `composeAttachmentLink`.
 */
export function durableAttachmentUrl(
  url: string | null | undefined,
): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

/** Where a compose attachment opens: its stored address, or Mail's own path. */
export function composeAttachmentLink(
  attachment: Pick<
    ComposeAttachment,
    "url" | "filename" | "mimeType" | "gmailMessageId" | "gmailAttachmentId"
  >,
): string {
  if (attachment.url) return attachment.url;
  if (attachment.gmailMessageId && attachment.gmailAttachmentId) {
    return `/api/attachments?messageId=${encodeURIComponent(
      attachment.gmailMessageId,
    )}&id=${encodeURIComponent(
      attachment.gmailAttachmentId,
    )}&mimeType=${encodeURIComponent(attachment.mimeType)}`;
  }
  return `/api/media/${encodeURIComponent(attachment.filename)}`;
}
