import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Delete a document comment. Authors can delete their own comments; otherwise editor access is required.",
  schema: z.object({
    id: z.string().describe("Comment ID"),
    documentId: z.string().optional().describe("Document ID"),
  }),
  run: async (args) => {
    const db = getDb();
    const [comment] = await db
      .select({
        documentId: schema.documentComments.documentId,
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
    if (comment.authorEmail === userEmail) {
      await assertAccess("document", comment.documentId, "viewer");
    } else {
      await assertAccess("document", comment.documentId, "editor");
    }

    await db
      .delete(schema.documentComments)
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
