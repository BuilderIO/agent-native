import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

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
  description: "Add a comment to a document. For new threads, omit threadId.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID (required)"),
    content: z.string().optional().describe("Comment text (required)"),
    threadId: z.string().optional().describe("Thread ID (for replies)"),
    parentId: z.string().optional().describe("Parent comment ID (for replies)"),
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
    authorName: z.string().optional().describe("Display name of the author"),
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
    if (!documentId) throw new Error("--documentId is required");
    if (!content) throw new Error("--content is required");

    const access = await assertAccess("document", documentId, "viewer");
    const ownerEmail = access.resource.ownerEmail as string;
    const id = Math.random().toString(36).slice(2, 14);
    const threadId = args.threadId ?? id;
    const parentId = args.parentId ?? null;
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");

    const providedName = args.authorName?.trim();
    let name: string;
    if (providedName) {
      name = providedName;
    } else if (email) {
      const derived = displayNameFromEmail(email).trim();
      name = derived || "AI Agent";
    } else {
      name = "AI Agent";
    }

    const mentions = parseMentions(args.mentions);
    const mentionsJson = mentions.length > 0 ? JSON.stringify(mentions) : null;

    const db = getDb();
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

    return { id, threadId };
  },
});
