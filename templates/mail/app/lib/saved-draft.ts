import type {
  ComposeAttachment,
  ComposeState,
  EmailMessage,
} from "@shared/types";

/**
 * A Gmail draft's files are parts of that draft. A local draft's are uploads:
 * its row keeps the upload's filename as `id` and the display name as `filename`.
 */
export function savedEmailDraftAttachments(
  email: Pick<EmailMessage, "id" | "accountEmail" | "attachments">,
): ComposeAttachment[] | undefined {
  return email.attachments?.map((attachment) =>
    email.accountEmail
      ? {
          id: attachment.id,
          filename: attachment.filename,
          originalName: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
          url: `/api/attachments?messageId=${encodeURIComponent(
            email.id,
          )}&id=${encodeURIComponent(
            attachment.id,
          )}&mimeType=${encodeURIComponent(attachment.mimeType)}`,
          source: "gmail",
          gmailMessageId: email.id,
          gmailAttachmentId: attachment.id,
          accountEmail: email.accountEmail,
        }
      : {
          id: attachment.id,
          filename: attachment.id,
          originalName: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
          url: attachment.url ?? `/api/media/${attachment.id}`,
        },
  );
}

export function savedEmailDraftMetadata(
  email: Pick<EmailMessage, "id" | "accountEmail">,
): Pick<
  ComposeState,
  | "accountEmail"
  | "savedDraftId"
  | "savedDraftBackend"
  | "savedDraftAccountEmail"
> {
  return {
    accountEmail: email.accountEmail,
    savedDraftId: email.id,
    savedDraftBackend: email.accountEmail ? "gmail" : "local",
    savedDraftAccountEmail: email.accountEmail,
  };
}
