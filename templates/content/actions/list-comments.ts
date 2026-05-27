import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "List all comments on a document, grouped by thread.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID (required)"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const documentId = args.documentId;
    if (!documentId) throw new Error("--documentId is required");

    const access = await assertAccess("document", documentId, "viewer");
    const ownerEmail = access.resource.ownerEmail as string;
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.documentComments)
      .where(
        and(
          eq(schema.documentComments.documentId, documentId),
          eq(schema.documentComments.ownerEmail, ownerEmail),
        ),
      )
      .orderBy(asc(schema.documentComments.createdAt));

    return { comments: rows };
  },
});
