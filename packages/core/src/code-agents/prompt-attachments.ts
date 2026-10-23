export type AgentPromptAttachmentReadError =
  | "read-failed"
  | "too-large"
  | "not-utf8";

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

const MAX_INLINE_TEXT_CHARS = 60_000;
const MAX_TOTAL_TEXT_CHARS = 80_000;

export function formatPromptWithAttachments(
  prompt: string,
  attachments: readonly AgentPromptAttachment[],
): string {
  if (attachments.length === 0) return prompt;
  let remainingChars = MAX_TOTAL_TEXT_CHARS;
  const attachmentText = attachments
    .map((attachment) => {
      const size = attachment.size ? ` size="${attachment.size}"` : "";
      const type = attachment.type
        ? ` type="${escapePromptAttachmentAttribute(attachment.type)}"`
        : "";
      if (attachment.dataUrl && attachment.text === undefined) {
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
      const { body, usedChars } = budgetAttachedFileText(
        attachment,
        remainingChars,
      );
      remainingChars -= usedChars;
      const boundary = attachedFileBoundaryFor(body);
      const boundaryAttr = boundary ? ` boundary="${boundary}"` : "";
      return `<attached-file name="${escapePromptAttachmentAttribute(
        attachment.name,
      )}"${type}${size}${boundaryAttr}>\n${body}\n</attached-file${boundaryAttr}>`;
    })
    .join("\n\n");
  return `${prompt.trimEnd()}\n\nAttached context:\n${attachmentText}`;
}

/**
 * Caps each file at the inline limit and the whole message at a shared total,
 * on whatever text arrives, so metadata from any caller cannot grow the
 * prompt past what the composer itself would send.
 */
function budgetAttachedFileText(
  attachment: AgentPromptAttachment,
  remainingChars: number,
): { body: string; usedChars: number } {
  const text = attachment.text ?? "";
  const totalChars = Math.max(attachment.totalChars ?? 0, text.length);
  const shownChars = Math.min(
    text.length,
    MAX_INLINE_TEXT_CHARS,
    Math.max(0, remainingChars),
  );
  const shown = text.slice(0, shownChars);
  if (!text.trim()) {
    return {
      body: "Selected in the UI. If this file is needed, inspect it from the workspace or ask for a readable copy.",
      usedChars: 0,
    };
  }
  if (shownChars >= totalChars)
    return { body: shown.trim(), usedChars: shownChars };
  const note =
    shownChars === 0
      ? `[This file's ${totalChars.toLocaleString()} characters were not attached because this message reached its ${MAX_TOTAL_TEXT_CHARS.toLocaleString()}-character limit for attached text, and none of it is available to you. Tell the user up front that you could not read it, and do not report finished work that depends on it.]`
      : `[Only the first ${shownChars.toLocaleString()} of ${totalChars.toLocaleString()} characters of this file were attached, and the rest is not available to you. Tell the user up front that you could read only part of it, and do not report finished work that depends on the rest.]`;
  return {
    body: shownChars === 0 ? note : `${shown.trim()}\n\n${note}`,
    usedChars: shownChars,
  };
}

// A file that contains our own tag names could close its envelope early and
// forge prompt text, so it gets a closing tag it cannot know in advance.
function attachedFileBoundaryFor(body: string): string | null {
  if (!/<\/?attached-(?:file|image)/i.test(body)) return null;
  let boundary: string;
  do {
    boundary = Array.from(
      globalThis.crypto.getRandomValues(new Uint8Array(6)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
  } while (body.includes(boundary));
  return boundary;
}

function describeAgentPromptAttachmentReadError(
  code: AgentPromptAttachmentReadError,
): string {
  return code === "too-large"
    ? "This file is over the 20 MB limit for reading attachments, so its contents were not sent. Do not infer its contents. Tell the user it is too large to read and ask for a smaller file."
    : code === "not-utf8"
      ? "This file is not UTF-8 text, so its contents were not sent. Do not infer its contents. Tell the user it could not be read and ask them to save it as UTF-8 and attach it again."
      : "The browser could not read this file, so its contents were not sent. Do not infer its contents. Tell the user it could not be read and ask them to attach it again.";
}

export function escapePromptAttachmentAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
