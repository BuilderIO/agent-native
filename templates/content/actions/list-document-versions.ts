import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "List saved versions for a document.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID"),
    includeContent: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include full version content in the response"),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    if (!args.documentId) throw new Error("--documentId is required");

    const access = await assertAccess("document", args.documentId, "viewer");
    const ownerEmail = access.resource.ownerEmail as string;
    const db = getDb();
    const where = and(
      eq(schema.documentVersions.documentId, args.documentId),
      eq(schema.documentVersions.ownerEmail, ownerEmail),
    );
    const versions = args.includeContent
      ? await db
          .select()
          .from(schema.documentVersions)
          .where(where)
          .orderBy(desc(schema.documentVersions.createdAt))
          .limit(args.limit)
      : await db
          .select({
            id: schema.documentVersions.id,
            documentId: schema.documentVersions.documentId,
            title: schema.documentVersions.title,
            createdAt: schema.documentVersions.createdAt,
          })
          .from(schema.documentVersions)
          .where(where)
          .orderBy(desc(schema.documentVersions.createdAt))
          .limit(args.limit);

    return {
      versions: versions.map((version) => ({
        id: version.id,
        documentId: version.documentId,
        title: version.title,
        ...(args.includeContent && "content" in version
          ? { content: version.content }
          : {}),
        createdAt: version.createdAt,
      })),
    };
  },
});
