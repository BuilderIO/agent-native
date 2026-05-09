import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
  type AgentChatAttachment,
} from "@agent-native/core/server";
import actionsRegistry from "../../.generated/actions-registry.js";
import { getOrgContext } from "@agent-native/core/org";
import path from "path";
import { saveUploadedReferenceFile } from "../handlers/uploads.js";
import { isSlidesReferenceFileExtension } from "../../shared/upload-types.js";
import "../register-secrets.js";

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

async function prepareSlidesChatAttachments(args: {
  ownerEmail: string | null;
  message: string;
  attachments: AgentChatAttachment[];
}): Promise<{ message?: string } | void> {
  if (!args.ownerEmail || args.attachments.length === 0) return;

  const uploaded: Array<{
    originalName: string;
    path: string;
    url?: string;
    type: string;
    size: number;
  }> = [];
  const failed: Array<{ name: string; reason: string }> = [];

  for (const attachment of args.attachments) {
    if (attachment.type !== "file" || !attachment.data) continue;
    const ext = path.extname(attachment.name).toLowerCase();
    if (!isSlidesReferenceFileExtension(ext)) continue;

    const decoded = decodeDataUrl(attachment.data);
    if (!decoded) continue;
    if (decoded.bytes.length > MAX_CHAT_UPLOAD_BYTES) {
      failed.push({
        name: attachment.name,
        reason: "file is larger than the 50 MB upload limit",
      });
      continue;
    }

    try {
      uploaded.push(
        await saveUploadedReferenceFile({
          email: args.ownerEmail,
          originalName: attachment.name,
          data: decoded.bytes,
          type: attachment.contentType || decoded.contentType,
        }),
      );
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
          '- PPTX files: call `import-pptx --filePath "<path>"` to create or replace a deck from the presentation.',
          '- PDF and DOCX files: call `import-file --filePath "<path>" --format auto` and use the returned content as source material before creating slides.',
          '- Image files with an embeddable URL can be inserted directly into slide HTML as `<img src="...">` or used as visual references.',
          "- Do not say no PDF/PPTX/DOCX was attached when a matching saved path is listed here.",
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

  return { message: `${args.message}\n\n${attachmentContext}` };
}

export default createAgentChatPlugin({
  appId: "slides",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  runSoftTimeoutMs: 240_000,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  prepareRequest: prepareSlidesChatAttachments,
  mentionProviders: async () => {
    const { getDb } = await import("../db/index.js");
    const { decks, deckShares } = await import("../db/schema.js");
    const { like, desc, and } = await import("drizzle-orm");
    const { accessFilter } = await import("@agent-native/core/sharing");
    return {
      decks: {
        label: "Decks",
        icon: "deck",
        search: async (query: string) => {
          const db = getDb();
          const access = accessFilter(decks, deckShares);
          const rows = query
            ? await db
                .select()
                .from(decks)
                .where(and(access, like(decks.title, `%${query}%`)))
                .limit(15)
            : await db
                .select()
                .from(decks)
                .where(access)
                .orderBy(desc(decks.updatedAt))
                .limit(15);
          return rows.map((deck) => ({
            id: deck.id,
            label: deck.title,
            icon: "deck" as const,
            refType: "deck",
            refId: deck.id,
          }));
        },
      },
    };
  },
});
