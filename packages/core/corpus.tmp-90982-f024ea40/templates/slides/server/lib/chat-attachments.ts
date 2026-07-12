import path from "path";

import type { AgentChatAttachment } from "@agent-native/core/server";

import { isSlidesReferenceFileExtension } from "../../shared/upload-types.js";
import { saveUploadedReferenceFile } from "../handlers/uploads.js";

const MAX_CHAT_UPLOAD_BYTES = 50 * 1024 * 1024;

function decodeDataUrl(data: string | undefined): {
  bytes: Buffer;
  contentType: string;
} | null {
  const match = data?.match(/^data:([^;,]+);base64,(.*)$/s);
  if (!match) return null;
  return {
    contentType: match[1] || "application/octet-stream",
    bytes: Buffer.from(match[2], "base64"),
  };
}

function attachmentDataUrl(attachment: AgentChatAttachment): string | null {
  if (typeof attachment.data !== "string") return null;
  if (
    attachment.type === "image" ||
    attachment.type === "file" ||
    attachment.type === "document"
  ) {
    return attachment.data;
  }
  return null;
}

export async function prepareSlidesChatAttachments(args: {
  ownerEmail: string | null;
  message: string;
  attachments: AgentChatAttachment[];
}): Promise<{ message?: string; attachments?: AgentChatAttachment[] } | void> {
  if (!args.ownerEmail || args.attachments.length === 0) return;

  const uploaded: Array<{
    originalName: string;
    path: string;
    url?: string;
    type: string;
    size: number;
  }> = [];
  const failed: Array<{ name: string; reason: string }> = [];
  const nextAttachments = [...args.attachments];

  for (let index = 0; index < args.attachments.length; index++) {
    const attachment = args.attachments[index];
    if (!attachment) continue;
    const dataUrl = attachmentDataUrl(attachment);
    if (!dataUrl) continue;

    const ext = path.extname(attachment.name).toLowerCase();
    if (!isSlidesReferenceFileExtension(ext)) continue;

    const decoded = decodeDataUrl(dataUrl);
    if (!decoded) continue;
    if (decoded.bytes.length > MAX_CHAT_UPLOAD_BYTES) {
      failed.push({
        name: attachment.name,
        reason: "file is larger than the 50 MB upload limit",
      });
      continue;
    }

    try {
      const saved = await saveUploadedReferenceFile({
        email: args.ownerEmail,
        originalName: attachment.name,
        data: decoded.bytes,
        type: attachment.contentType || decoded.contentType,
      });
      uploaded.push(saved);
      nextAttachments[index] = stripForwardedAttachmentData(attachment, saved);
    } catch (error) {
      failed.push({
        name: attachment.name,
        reason: error instanceof Error ? error.message : "upload failed",
      });
    }
  }

  if (uploaded.length === 0 && failed.length === 0) return;

  const fileList = uploaded
    .map(
      (file) =>
        `- ${file.originalName} (${file.type}, ${(file.size / 1024).toFixed(1)}KB) at path: ${file.path}${file.url ? `; embeddable URL: ${file.url}` : ""}`,
    )
    .join("\n");
  const failureList = failed
    .map((file) => `- ${file.name}: ${file.reason}`)
    .join("\n");
  const attachmentContext = [
    "<slides-chat-attachments>",
    uploaded.length > 0
      ? [
          "The user attached file(s) in chat. They have been saved as real server upload paths that Slides import actions can read:",
          fileList,
          "",
          "File handling rules:",
          "- If the request refers to the current or visible deck, call `view-screen` first to confirm the active deckId, then pass that deckId to import or slide-edit actions.",
          '- PPTX files: call `import-pptx --filePath "<path>" --deckId <deckId>` when updating the visible deck, or omit deckId only when the user explicitly wants a new deck.',
          '- PDF and DOCX files: call `import-file --filePath "<path>" --format auto --deckId <deckId>` and use the returned extracted text as source material before creating slides. The returned text is capped for reliability; re-run with maxChars only if more context is needed. If the user wants a direct replacement import, pass `--importIntoDeck true` as well.',
          '- Figma `.fig` files: call `import-file --filePath "<path>" --format fig` to start Builder design-system indexing. Do not create a local design system directly from the upload.',
          "- For deck-generation requests, start mutating promptly: create or update the first slide as soon as source material is extracted, then continue slide-by-slide with add-slide/update-slide.",
          '- Image files with an embeddable URL can be inserted directly into slide HTML as `<img src="...">` or used as visual references.',
          "- Do not say no PDF/PPTX/DOCX/FIG/image was attached when a matching saved path is listed here.",
        ].join("\n")
      : "",
    failed.length > 0
      ? [
          "Some attached file(s) could not be saved to Slides upload storage:",
          failureList,
          "The binary attachment is still present in the chat request; use it directly if the model supports it, otherwise report the save error exactly.",
        ].join("\n")
      : "",
    "</slides-chat-attachments>",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    message: `${args.message}\n\n${attachmentContext}`,
    attachments: nextAttachments,
  };
}

function stripForwardedAttachmentData(
  attachment: AgentChatAttachment,
  saved: { path: string; url?: string },
): AgentChatAttachment {
  const next = { ...attachment };
  // Keep image data for the current model turn when storage only gives Slides
  // an import path. A hosted URL is the replacement that lets us strip it.
  if (saved.url || !isVisualAttachment(attachment)) {
    delete next.data;
  }
  (next as any).slidesUploadPath = saved.path;
  if (saved.url) {
    (next as any).url = saved.url;
  }
  return next;
}

function isVisualAttachment(attachment: AgentChatAttachment): boolean {
  return (
    attachment.type === "image" ||
    (typeof attachment.contentType === "string" &&
      attachment.contentType.toLowerCase().startsWith("image/"))
  );
}
