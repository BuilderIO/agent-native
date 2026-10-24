import type { CodeAgentPromptAttachment } from "@shared/ipc-channels";

const READ_ERRORS = new Set<CodeAgentPromptAttachment["readError"]>([
  "read-failed",
  "too-large",
  "not-utf8",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * Attachments cross the IPC boundary as untrusted JSON. Every field the
 * prompt formatter reads must survive here: dropping `totalChars` sends a
 * file's head as if it were the whole file, and dropping `readError` turns an
 * unreadable file into a filename with no explanation.
 */
export function normalizeCodeAgentPromptAttachments(
  value: unknown,
): CodeAgentPromptAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments = value
    .map((item) => {
      if (!isObject(item)) return null;
      const name = trimmedString(item.name);
      if (!name) return null;
      const size = Number(item.size);
      const totalChars = item.totalChars;
      const attachment: CodeAgentPromptAttachment = { name };
      const type = trimmedString(item.type);

      const dataUrl = trimmedString(item.dataUrl);
      if (type) attachment.type = type;
      if (Number.isFinite(size) && size >= 0) attachment.size = size;
      // File text is content, not a label: keep it verbatim, even empty, so
      // an empty SVG with a data URL is still read as text, not an image.
      if (typeof item.text === "string") attachment.text = item.text;
      if (
        typeof totalChars === "number" &&
        Number.isInteger(totalChars) &&
        totalChars > 0
      ) {
        attachment.totalChars = totalChars;
      }
      if (
        READ_ERRORS.has(
          item.readError as CodeAgentPromptAttachment["readError"],
        )
      ) {
        attachment.readError =
          item.readError as CodeAgentPromptAttachment["readError"];
      }
      if (dataUrl) attachment.dataUrl = dataUrl;
      return attachment;
    })
    .filter((item): item is CodeAgentPromptAttachment => item !== null);
  return attachments.length > 0 ? attachments : undefined;
}
