import type { CodeAgentPromptAttachment } from "./types.js";

export const CODE_AGENT_MAX_INLINE_TEXT_CHARS = 60_000;

export async function readCodeAgentPromptAttachment(
  file: File,
): Promise<CodeAgentPromptAttachment> {
  const attachment: CodeAgentPromptAttachment = {
    name: file.name,
    type: file.type || undefined,
    size: file.size,
  };
  if (
    isInlineableCodeAgentFile(file) &&
    file.size <= CODE_AGENT_MAX_INLINE_TEXT_CHARS
  ) {
    try {
      attachment.text = await file.text();
    } catch {
      // Keep the filename-only attachment if the browser cannot read it.
    }
  }
  return attachment;
}

export function isInlineableCodeAgentFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  return /\.(cjs|css|csv|html|js|json|jsx|md|mdx|mjs|sql|tsx?|txt|xml|yaml|yml)$/i.test(
    file.name,
  );
}

export function formatCodeAgentPromptWithAttachments(
  prompt: string,
  attachments: CodeAgentPromptAttachment[],
): string {
  if (attachments.length === 0) return prompt;
  const attachmentText = attachments
    .map((attachment) => {
      const size = attachment.size ? ` size="${attachment.size}"` : "";
      const type = attachment.type
        ? ` type="${escapeCodeAgentXmlAttribute(attachment.type)}"`
        : "";
      const body =
        attachment.text?.trim() ||
        "Selected in the UI. If this file is needed, inspect it from the workspace or ask for a readable copy.";
      return `<attached-file name="${escapeCodeAgentXmlAttribute(attachment.name)}"${type}${size}>\n${body}\n</attached-file>`;
    })
    .join("\n\n");
  return `${prompt.trimEnd()}\n\nAttached context:\n${attachmentText}`;
}

export function escapeCodeAgentXmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
