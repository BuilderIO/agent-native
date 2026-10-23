export type AgentPromptAttachmentReadError = "read-failed" | "too-large";

export interface AgentPromptAttachment {
  name: string;
  type?: string;
  size?: number;
  text?: string;
  /** Length of the whole file when `text` holds only its head. */
  totalChars?: number;
  readError?: AgentPromptAttachmentReadError;
  dataUrl?: string;
}

export function formatPromptWithAttachments(
  prompt: string,
  attachments: readonly AgentPromptAttachment[],
): string {
  if (attachments.length === 0) return prompt;
  const attachmentText = attachments
    .map((attachment) => {
      const size = attachment.size ? ` size="${attachment.size}"` : "";
      const type = attachment.type
        ? ` type="${escapePromptAttachmentAttribute(attachment.type)}"`
        : "";
      if (attachment.dataUrl) {
        return `<attached-image name="${escapePromptAttachmentAttribute(
          attachment.name,
        )}"${type}${size}>\n${attachment.dataUrl}\n</attached-image>`;
      }
      if (attachment.readError) {
        return `<attached-file-error name="${escapePromptAttachmentAttribute(
          attachment.name,
        )}" code="${attachment.readError}"${type}${size}>\n${describeAgentPromptAttachmentReadError(
          attachment.readError,
        )}\n</attached-file-error>`;
      }
      const body =
        attachment.text?.trim() ||
        "Selected in the UI. If this file is needed, inspect it from the workspace or ask for a readable copy.";
      const truncation =
        attachment.text && attachment.totalChars
          ? `\n\n[Only the first ${attachment.text.length.toLocaleString()} of ${attachment.totalChars.toLocaleString()} characters of this file were attached, and the rest is not available to you. Tell the user up front that you could read only part of it, and do not report finished work that depends on the rest.]`
          : "";
      return `<attached-file name="${escapePromptAttachmentAttribute(
        attachment.name,
      )}"${type}${size}>\n${body}${truncation}\n</attached-file>`;
    })
    .join("\n\n");
  return `${prompt.trimEnd()}\n\nAttached context:\n${attachmentText}`;
}

function describeAgentPromptAttachmentReadError(
  code: AgentPromptAttachmentReadError,
): string {
  return code === "too-large"
    ? "This file is over the 20 MB limit for reading attachments, so its contents were not sent. Do not infer its contents. Tell the user it is too large to read and ask for a smaller file."
    : "The browser could not read this file, so its contents were not sent. Do not infer its contents. Tell the user it could not be read and ask them to attach it again.";
}

export function escapePromptAttachmentAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
