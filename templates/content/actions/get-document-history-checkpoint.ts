import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  DocumentHistoryCheckpointDetail,
  DocumentHistoryCheckpointKind,
} from "../shared/document-history.js";

export default defineAction({
  description: "Get the full content of one recoverable document checkpoint.",
  schema: z.object({
    documentId: z.string().min(1).describe("Document ID"),
    versionId: z.string().min(1).describe("Checkpoint version ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (
    args,
  ): Promise<{ checkpoint: DocumentHistoryCheckpointDetail }> => {
    const access = await assertAccess("document", args.documentId, "viewer");
    const ownerEmail = access.resource.ownerEmail as string;
    const [row] = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(
        and(
          eq(schema.documentVersions.ownerEmail, ownerEmail),
          eq(schema.documentVersions.documentId, args.documentId),
          eq(schema.documentVersions.id, args.versionId),
        ),
      )
      .limit(1);
    if (!row) throw new Error(`Checkpoint not found: ${args.versionId}`);
    return {
      checkpoint: {
        id: row.id,
        documentId: row.documentId,
        groupId: row.groupId ?? row.id,
        title: row.title,
        content: row.content,
        checkpointKind: (row.checkpointKind ??
          "legacy") as DocumentHistoryCheckpointKind,
        createdAt: row.createdAt,
      },
    };
  },
});
