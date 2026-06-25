import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Update a document comment. Resolving or reopening a comment applies to the full thread.",
  schema: z.object({
    id: z.string().describe("Comment ID"),
    documentId: z.string().optional().describe("Document ID"),
    content: z.string().optional().describe("New comment text"),
    resolved: z.coerce.boolean().optional().describe("Resolved state"),
  }),
  run: async (args) => {
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
    if (
      args.resolved === true ||
      args.resolved === false ||
      comment.authorEmail !== userEmail
    ) {
      await assertAccess("document", comment.documentId, "editor");
    } else {
      await assertAccess("document", comment.documentId, "viewer");
    }

    const updatedAt = new Date().toISOString();
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

    // Both resolve and reopen return early above, so only content edits remain.
    if (args.content === undefined) {
      return { ok: true };
    }

    const updates: Partial<typeof schema.documentComments.$inferInsert> = {
      updatedAt,
      content: args.content,
    };

    await db
      .update(schema.documentComments)
      .set(updates)
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
