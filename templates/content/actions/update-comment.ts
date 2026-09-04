import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

type Mention = { email: string; name: string };

function parseMentions(value: unknown): Mention[] {
  let raw = value;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      raw = JSON.parse(trimmed);
    } catch {
      throw new Error("Comment mentions metadata is not valid JSON");
    }
  }
  if (!Array.isArray(raw)) {
    throw new Error("Comment mentions metadata must be an array");
  }
  return raw.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Comment mentions metadata contains an invalid entry");
    }
    const email = (entry as Record<string, unknown>).email;
    const name = (entry as Record<string, unknown>).name;
    if (typeof email !== "string" || !email) {
      throw new Error("Comment mention email is required");
    }
    return { email, name: typeof name === "string" ? name : "" };
  });
}

export default defineAction({
  description:
    "Update one exact document comment by ID. Provide content, mentions, resolved, or a combination; calls without a mutation fail. Comment text supports inline Markdown without headings. Resolving or reopening applies to the full thread; include documentId to fail closed on a mismatched pair.",
  mcpTool: true,
  schema: z.object({
    id: z.string().describe("Comment ID"),
    documentId: z.string().optional().describe("Document ID"),
    content: z.string().optional().describe("New comment text"),
    mentions: z
      .union([z.string(), z.array(z.unknown())])
      .optional()
      .describe("JSON-encoded array of {email, name} mentions"),
    resolved: z.coerce.boolean().optional().describe("Resolved state"),
  }),
  run: async (args) => {
    if (
      args.content === undefined &&
      args.mentions === undefined &&
      args.resolved === undefined
    ) {
      throw new Error(
        "Provide content, mentions, or resolved to update a comment",
      );
    }

    const db = getDb();
    const [comment] = await db
      .select({
        documentId: schema.documentComments.documentId,
        threadId: schema.documentComments.threadId,
        authorEmail: schema.documentComments.authorEmail,
      })
      .from(schema.documentComments)
      .where(eq(schema.documentComments.id, args.id))
      .limit(1);

    if (
      !comment ||
      (args.documentId && comment.documentId !== args.documentId)
    ) {
      throw new Error(`Comment not found: ${args.id}`);
    }

    const userEmail = getRequestUserEmail();
    const isAuthor =
      typeof userEmail === "string" &&
      comment.authorEmail.trim().toLowerCase() ===
        userEmail.trim().toLowerCase();
    if (args.resolved === true || args.resolved === false || !isAuthor) {
      await assertAccess("document", comment.documentId, "editor");
    } else {
      await assertAccess("document", comment.documentId, "commenter");
    }

    const updatedAt = new Date().toISOString();
    const mentions =
      args.mentions === undefined ? undefined : parseMentions(args.mentions);
    const contentUpdates: Partial<typeof schema.documentComments.$inferInsert> =
      {
        updatedAt,
        ...(args.content !== undefined ? { content: args.content } : {}),
        ...(mentions !== undefined
          ? {
              mentionsJson: mentions.length ? JSON.stringify(mentions) : null,
            }
          : {}),
      };

    if (
      (args.content !== undefined || args.mentions !== undefined) &&
      args.resolved !== undefined
    ) {
      await db.transaction(async (tx) => {
        await tx
          .update(schema.documentComments)
          .set(contentUpdates)
          .where(
            and(
              eq(schema.documentComments.id, args.id),
              eq(schema.documentComments.documentId, comment.documentId),
            ),
          );
        await tx
          .update(schema.documentComments)
          .set({ resolved: args.resolved ? 1 : 0, updatedAt })
          .where(
            and(
              eq(schema.documentComments.documentId, comment.documentId),
              eq(schema.documentComments.threadId, comment.threadId),
            ),
          );
      });
      await writeAppState("refresh-signal", { ts: Date.now() });
      return { ok: true, resolved: args.resolved };
    }

    if (args.resolved === true) {
      await db
        .update(schema.documentComments)
        .set({ resolved: 1, updatedAt })
        .where(
          and(
            eq(schema.documentComments.documentId, comment.documentId),
            eq(schema.documentComments.threadId, comment.threadId),
          ),
        );
      await writeAppState("refresh-signal", { ts: Date.now() });
      return { ok: true, resolved: true };
    }

    if (args.resolved === false) {
      await db
        .update(schema.documentComments)
        .set({ resolved: 0, updatedAt })
        .where(
          and(
            eq(schema.documentComments.documentId, comment.documentId),
            eq(schema.documentComments.threadId, comment.threadId),
          ),
        );
      await writeAppState("refresh-signal", { ts: Date.now() });
      return { ok: true, resolved: false };
    }

    await db
      .update(schema.documentComments)
      .set(contentUpdates)
      .where(
        and(
          eq(schema.documentComments.id, args.id),
          eq(schema.documentComments.documentId, comment.documentId),
        ),
      );

    await writeAppState("refresh-signal", { ts: Date.now() });
    return { ok: true };
  },
});
