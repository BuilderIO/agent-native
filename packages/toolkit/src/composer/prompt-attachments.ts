export interface AgentPromptAttachment {
  name: string;
  type?: string;
  size?: number;
  text?: string;
  dataUrl?: string;
}

export function escapePromptAttachmentAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
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
        return `<attached-image name="${escapePromptAttachmentAttribute(attachment.name)}"${type}${size}>\n${attachment.dataUrl}\n</attached-image>`;
      }
      const body =
        attachment.text?.trim() ||
        "Selected in the UI. If this file is needed, inspect it from the workspace or ask for a readable copy.";
      return `<attached-file name="${escapePromptAttachmentAttribute(attachment.name)}"${type}${size}>\n${body}\n</attached-file>`;
    })
    .join("\n\n");
  return `${prompt.trimEnd()}\n\nAttached context:\n${attachmentText}`;
}

export const AGENT_PROMPT_MAX_INLINE_TEXT_CHARS = 60_000;
export const AGENT_PROMPT_MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;

export interface ReadAgentPromptAttachmentOptions {
  maxInlineTextChars?: number;
  maxInlineImageBytes?: number;
}

export async function readAgentPromptAttachment(
  file: File,
  options: ReadAgentPromptAttachmentOptions = {},
): Promise<AgentPromptAttachment> {
  const maxInlineTextChars =
    options.maxInlineTextChars ?? AGENT_PROMPT_MAX_INLINE_TEXT_CHARS;
  const maxInlineImageBytes =
    options.maxInlineImageBytes ?? AGENT_PROMPT_MAX_INLINE_IMAGE_BYTES;
  const attachment: AgentPromptAttachment = {
    name: file.name,
    type: file.type || undefined,
    size: file.size,
  };

  if (isInlineableAgentPromptFile(file) && file.size <= maxInlineTextChars) {
    try {
      attachment.text = await file.text();
    } catch {
      // Keep the filename-only attachment if the browser cannot read it.
    }
  } else if (
    file.type.startsWith("image/") &&
    file.size <= maxInlineImageBytes
  ) {
    try {
      attachment.dataUrl = await readFileAsDataUrl(file);
    } catch {
      // Keep the filename-only attachment if the browser cannot read it.
    }
  }

  return attachment;
}

export function isInlineableAgentPromptFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  return /\.(cjs|css|csv|html|js|json|jsx|md|mdx|mjs|sql|tsx?|txt|xml|yaml|yml)$/i.test(
    file.name,
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}
