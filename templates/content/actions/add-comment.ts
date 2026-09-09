import { defineAction, fail } from "@agent-native/core/action";
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
import { lockLiveDocuments } from "./_document-lifecycle.js";

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
    clientOperationId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Optional UUID identifying this submission; reuse unchanged on retries. Becomes the comment ID.",
      ),
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
  run: async (args, ctx) => {
    const documentId = args.documentId;
    const content = args.content;

    if (Boolean(args.threadId) !== Boolean(args.parentId)) {
      throw new Error("Replies require both threadId and parentId");
    }

    const access = await assertAccess("document", documentId, "commenter");
    const ownerEmail = access.resource.ownerEmail as string;
    const db = getDb();
    const id = args.clientOperationId ?? crypto.randomUUID();
    const threadId = args.threadId ?? id;
    const parentId = args.parentId ?? null;
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");

    const requestName = getRequestRunContext()
      ? undefined
      : getRequestUserName()?.trim();
    let name: string;
    if (requestName) {
      name = requestName;
    } else {
      const derived = displayNameFromEmail(email).trim();
      name = derived || "AI Agent";
    }

    const mentions = parseMentions(args.mentions);
    const mentionsJson = mentions.length > 0 ? JSON.stringify(mentions) : null;
    const submissionSource =
      ctx?.caller === "mcp" || ctx?.caller === "webmcp"
        ? "mcp"
        : ctx?.caller === "tool"
          ? "agent"
          : (ctx?.caller ?? null);
    const submissionRunId = ctx?.runId ?? null;

    const values = {
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
      submissionSource,
      submissionRunId,
    };

    const inserted = await db.transaction(async (tx) => {
      await lockLiveDocuments(tx as unknown as ReturnType<typeof getDb>, [
        documentId,
      ]);
      const existingReceipt = async () => {
        const [existing] = await tx
          .select()
          .from(schema.documentComments)
          .where(
            and(
              eq(schema.documentComments.id, id),
              eq(schema.documentComments.documentId, documentId),
              eq(schema.documentComments.authorEmail, email),
            ),
          )
          .limit(1);
        if (!existing) return false;
        if (
          Object.entries(values).some(
            ([key, value]) =>
              key !== "authorName" &&
              key !== "submissionSource" &&
              key !== "submissionRunId" &&
              existing[key as keyof typeof existing] !== value,
          )
        ) {
          fail("Comment submission ID conflicts with another submission", {
            statusCode: 409,
            errorCode: "comment_submission_conflict",
          });
        }
        return true;
      };
      if (args.clientOperationId && (await existingReceipt())) return false;
      if (args.threadId && args.parentId) {
        // Resolution takes the same root lock before its thread-wide update.
        const [root] = await tx
          .select()
          .from(schema.documentComments)
          .where(
            and(
              eq(schema.documentComments.id, args.threadId),
              eq(schema.documentComments.documentId, documentId),
            ),
          )
          .limit(1)
          .for("update");
        if (args.clientOperationId && (await existingReceipt())) return false;
        const [parent] = await tx
          .select()
          .from(schema.documentComments)
          .where(
            and(
              eq(schema.documentComments.id, args.parentId),
              eq(schema.documentComments.documentId, documentId),
            ),
          )
          .limit(1);
        if (
          !root ||
          root.threadId !== args.threadId ||
          !parent ||
          parent.threadId !== args.threadId
        ) {
          fail("Reply parent does not belong to the selected thread", {
            statusCode: 409,
          });
        }
        if (root.resolved) {
          fail("Reopen the thread before replying", {
            statusCode: 409,
            errorCode: "comment_thread_resolved",
          });
        }
      }
      const created = await tx
        .insert(schema.documentComments)
        .values(values)
        .onConflictDoNothing({ target: schema.documentComments.id })
        .returning({ id: schema.documentComments.id });
      if (!created.length) {
        if (await existingReceipt()) return false;
        fail("Comment submission ID conflicts with another submission", {
          statusCode: 409,
          errorCode: "comment_submission_conflict",
        });
      }
      return true;
    });
    if (!inserted) return { id, threadId, notified: null, replayed: true };

    const notified = await notifyDocumentComment({
      documentId,
      documentTitle: (access.resource.title as string | null) ?? "",
      orgId: (access.resource.orgId as string | null) ?? null,
      threadId,
      ownerEmail,
      authorEmail: email,
      authorName: name,
      submissionSource,
      content,
      mentions,
      isReply: Boolean(parentId ?? args.threadId),
    });

    return { id, threadId, notified };
  },
});
