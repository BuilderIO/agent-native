import {
  formatPromptWithAttachments,
  escapePromptAttachmentAttribute,
  type AgentPromptAttachment,
} from "../../code-agents/prompt-attachments.js";

export {
  formatPromptWithAttachments,
  escapePromptAttachmentAttribute,
  type AgentPromptAttachment,
};

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
