import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "List saved versions for a document.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    if (!args.documentId) throw new Error("--documentId is required");

    const access = await assertAccess("document", args.documentId, "viewer");
    const ownerEmail = access.resource.ownerEmail as string;
    const db = getDb();
    const versions = await db
      .select()
      .from(schema.documentVersions)
      .where(
        and(
          eq(schema.documentVersions.documentId, args.documentId),
          eq(schema.documentVersions.ownerEmail, ownerEmail),
        ),
      )
      .orderBy(desc(schema.documentVersions.createdAt));

    return {
      versions: versions.map((version) => ({
        id: version.id,
        documentId: version.documentId,
        title: version.title,
        content: version.content,
        createdAt: version.createdAt,
      })),
    };
  },
});
