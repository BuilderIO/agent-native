import { createHash } from "node:crypto";

import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import {
  getRequestRunContext,
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server";
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

export function commentIdForIdempotency(
  email: string,
  documentId: string,
  key: string,
) {
  return `comment-${createHash("sha256")
    .update(JSON.stringify([email, documentId, key]))
    .digest("hex")}`;
}

const commentSchema = z.object({
  documentId: z.string().describe("Document ID"),
  content: z.string().min(1).describe("Comment text"),
  idempotencyKey: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Stable key for retrying the same comment without duplication"),
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
});

type CommentTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

export async function addCommentWithGuard(
  args: z.infer<typeof commentSchema>,
  ctx?: ActionRunContext,
  beforeInsert?: (tx: CommentTransaction) => Promise<void>,
) {
  const documentId = args.documentId;
  const content = args.content;

  if (Boolean(args.threadId) !== Boolean(args.parentId)) {
    throw new Error("Replies require both threadId and parentId");
  }

  const access = await assertAccess("document", documentId, "commenter");
  const ownerEmail = access.resource.ownerEmail as string;
  const db = getDb();

  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  const id = args.idempotencyKey
    ? commentIdForIdempotency(email, documentId, args.idempotencyKey)
    : Math.random().toString(36).slice(2, 14);
  const threadId = args.threadId ?? id;
  const parentId = args.parentId ?? null;
  const actorKind =
    getRequestRunContext() ||
    ctx?.caller === "tool" ||
    ctx?.caller === "mcp" ||
    ctx?.caller === "a2a"
      ? "agent"
      : "human";
  const requestName =
    actorKind === "agent" ? undefined : getRequestUserName()?.trim();
  let name: string;
  if (actorKind === "agent") {
    name = "AI Agent";
  } else if (requestName) {
    name = requestName;
  } else {
    const derived = displayNameFromEmail(email).trim();
    name = derived || "AI Agent";
  }

  const mentions = parseMentions(args.mentions);
  const mentionsJson = mentions.length > 0 ? JSON.stringify(mentions) : null;

  const created = await db.transaction(async (tx) => {
    // Resolution locks this same row before checking the thread snapshot.
    const [document] = await tx
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, documentId),
          eq(schema.documents.ownerEmail, ownerEmail),
        ),
      )
      .for("update");
    if (!document) throw new Error("The document is no longer available");
    if (args.threadId && args.parentId) {
      const [parent] = await tx
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

    const [prior] = await tx
      .select()
      .from(schema.documentComments)
      .where(eq(schema.documentComments.id, id))
      .limit(1);
    if (prior) {
      if (
        prior.documentId !== documentId ||
        prior.authorEmail !== email ||
        prior.threadId !== threadId ||
        prior.parentId !== parentId ||
        prior.content !== content ||
        prior.actorKind !== actorKind ||
        prior.quotedText !== (args.quotedText ?? null) ||
        prior.anchorPrefix !== (args.anchorPrefix ?? null) ||
        prior.anchorSuffix !== (args.anchorSuffix ?? null) ||
        prior.anchorStartOffset !== (args.anchorStartOffset ?? null) ||
        prior.mentionsJson !== mentionsJson
      ) {
        throw new Error(
          "Comment idempotency key was already used for a different comment",
        );
      }
      return false;
    }
    await beforeInsert?.(tx);
    const inserted = await tx
      .insert(schema.documentComments)
      .values({
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
        actorKind,
      })
      .onConflictDoNothing()
      .returning({ id: schema.documentComments.id });
    if (!inserted.length)
      throw new Error("The comment ID collided with another comment");

    return true;
  });
  if (!created) return { id, threadId, notified: 0, duplicate: true };

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
}

export default defineAction({
  description:
    "Add a comment to a document. Comment text supports inline Markdown for emphasis, inline code, links, and line breaks; headings are flattened. To reply, provide both threadId and parentId; omit both to start a thread.",
  deferLoading: false,
  mcpTool: true,
  schema: commentSchema,
  run: (args, ctx) => addCommentWithGuard(args, ctx),
});
