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

export type GmailAttachmentRef = {
  gmailMessageId: string;
  gmailAttachmentId: string;
};

/**
 * Gmail replaces a draft's message on every update, and the parts of the old
 * message go with it. A save that copied a file out of the draft's own message
 * reports where that file now lives in the new one.
 */
export type MovedGmailAttachment = {
  from: GmailAttachmentRef;
  to: GmailAttachmentRef;
};

/**
 * Points each attachment a save moved at its new part, matched by the refs the
 * save sent, so a file added or removed while the save ran keeps its place.
 * Returns `attachments` itself when nothing moved.
 */
export function moveGmailAttachments(
  attachments: ComposeAttachment[],
  moved: readonly MovedGmailAttachment[],
): ComposeAttachment[] {
  const unused = [...moved];
  const next = attachments.map((attachment) => {
    const move = unused.find(
      ({ from }) =>
        from.gmailMessageId === attachment.gmailMessageId &&
        from.gmailAttachmentId === attachment.gmailAttachmentId,
    );
    if (!move) return attachment;
    unused.splice(unused.indexOf(move), 1);
    return { ...attachment, ...move.to };
  });
  return unused.length < moved.length ? next : attachments;
}
