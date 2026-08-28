import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyDocumentComment } from "../server/lib/comment-notifications.js";

type Mention = { email: string; name: string };

function parseMentions(value: unknown): Mention[] {
  let raw: unknown = value;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const mentions: Mention[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const email = (entry as Record<string, unknown>).email;
    const name = (entry as Record<string, unknown>).name;
    if (typeof email !== "string" || !email) continue;
    mentions.push({
      email,
      name: typeof name === "string" ? name : "",
    });
  }
  return mentions;
}

function displayNameFromEmail(email: string): string {
  const localPart = email.split("@")[0] ?? "";
  const words = localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.join(" ");
}

export default defineAction({
  description:
    "Add a comment to a document. Comment text supports inline Markdown for emphasis, inline code, links, and line breaks; headings are flattened. To reply, provide both threadId and parentId; omit both to start a thread.",
  deferLoading: false,
  mcpTool: true,
  schema: z.object({
    documentId: z.string().describe("Document ID"),
    content: z.string().min(1).describe("Comment text"),
    threadId: z
      .string()
      .min(1)
      .optional()
      .describe("Thread ID; provide with parentId when replying"),
    parentId: z
      .string()
      .min(1)
      .optional()
      .describe("Parent comment ID; provide with threadId when replying"),
    quotedText: z.string().optional().describe("Quoted text for the thread"),
    anchorPrefix: z
      .string()
      .optional()
      .describe("Text immediately before the quote, for robust anchoring"),
    anchorSuffix: z
      .string()
      .optional()
      .describe("Text immediately after the quote, for robust anchoring"),
    anchorStartOffset: z.coerce
      .number()
      .optional()
      .describe("Character offset of the quote start within the document"),
    mentions: z
      .union([z.string(), z.array(z.unknown())])
      .optional()
      .describe(
        'JSON-encoded array of {email, name} mentions, e.g. [{"email":"a@x.com","name":"A"}]',
      ),
  }),
  run: async (args) => {
    const documentId = args.documentId;
    const content = args.content;

    if (Boolean(args.threadId) !== Boolean(args.parentId)) {
      throw new Error("Replies require both threadId and parentId");
    }

    const access = await assertAccess("document", documentId, "commenter");
    const ownerEmail = access.resource.ownerEmail as string;
    const db = getDb();
    if (args.threadId && args.parentId) {
      const [parent] = await db
        .select({ threadId: schema.documentComments.threadId })
        .from(schema.documentComments)
        .where(
          and(
            eq(schema.documentComments.id, args.parentId),
            eq(schema.documentComments.documentId, documentId),
          ),
        )
        .limit(1);
      if (!parent || parent.threadId !== args.threadId) {
        throw new Error("Reply parent does not belong to the selected thread");
      }
    }

    const id = Math.random().toString(36).slice(2, 14);
    const threadId = args.threadId ?? id;
    const parentId = args.parentId ?? null;
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");

    const derived = displayNameFromEmail(email).trim();
    const name = derived || "AI Agent";

    const mentions = parseMentions(args.mentions);
    const mentionsJson = mentions.length > 0 ? JSON.stringify(mentions) : null;

    await db.insert(schema.documentComments).values({
      id,
      ownerEmail,
      documentId,
      threadId,
      parentId,
      content,
      quotedText: args.quotedText ?? null,
      anchorPrefix: args.anchorPrefix ?? null,
      anchorSuffix: args.anchorSuffix ?? null,
      anchorStartOffset: args.anchorStartOffset ?? null,
      mentionsJson,
      authorEmail: email,
      authorName: name,
    });

    const notified = await notifyDocumentComment({
      documentId,
      documentTitle: (access.resource.title as string | null) ?? "",
      orgId: (access.resource.orgId as string | null) ?? null,
      threadId,
      ownerEmail,
      authorEmail: email,
      authorName: name,
      content,
      mentions,
      isReply: Boolean(parentId ?? args.threadId),
    });

    return { id, threadId, notified };
  },
});
