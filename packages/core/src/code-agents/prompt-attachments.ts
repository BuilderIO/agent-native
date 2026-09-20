export interface AgentPromptAttachment {
  name: string;
  type?: string;
  size?: number;
  text?: string;
  /** Base64 data URL for image attachments (e.g. "data:image/png;base64,..."). */
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
      const body =
        attachment.text?.trim() ||
        "Selected in the UI. If this file is needed, inspect it from the workspace or ask for a readable copy.";
      return `<attached-file name="${escapePromptAttachmentAttribute(
        attachment.name,
      )}"${type}${size}>\n${body}\n</attached-file>`;
    })
    .join("\n\n");
  return `${prompt.trimEnd()}\n\nAttached context:\n${attachmentText}`;
}

export function escapePromptAttachmentAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
