import type { AgentChatAttachment } from "../agent/types.js";
import type { Part } from "./types.js";

/**
 * Turn the URL file parts of an inbound A2A message into chat attachments, so
 * a delegated turn reads them through the same pipeline as a chat upload.
 * Parts that cannot be fetched are named in `unreadable` rather than dropped.
 */
export function a2aFilePartsToAttachments(parts: readonly Part[]): {
  attachments: AgentChatAttachment[];
  unreadable: string[];
} {
  const attachments: AgentChatAttachment[] = [];
  const unreadable: string[] = [];
  for (const part of parts) {
    if (part.type !== "file") continue;
    const { uri, name, mimeType } = part.file;
    // Apps pick their import path by file extension, so a missing name
    // cannot be guessed from an opaque storage URL.
    const label = name?.trim() || "attachment";
    if (!uri || !URL.canParse(uri) || new URL(uri).protocol !== "https:") {
      unreadable.push(label);
      continue;
    }
    attachments.push({
      type: mimeType?.startsWith("image/") ? "image" : "file",
      name: label,
      url: uri,
      ...(mimeType ? { contentType: mimeType } : {}),
    });
  }
  return { attachments, unreadable };
}
