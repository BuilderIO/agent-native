import { ActionContractError } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { firstRow } from "../server/lib/first-row.js";
import type {
  DocumentHistoryCheckpointDetail,
  DocumentHistoryCheckpointKind,
} from "../shared/document-history.js";
import { assertHistoryAccess } from "./_document-history-access.js";

export default defineAction({
  description:
    "Get the full title and Markdown body of one recoverable History checkpoint of a page, by the id list-document-history-checkpoints returns. Compare a change's before and after checkpoints to see what it changed.",
  schema: z.object({
    documentId: z.string().min(1).describe("Document ID"),
    versionId: z.string().min(1).describe("Checkpoint version ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (
    args,
  ): Promise<{ checkpoint: DocumentHistoryCheckpointDetail }> => {
    const access = await assertHistoryAccess(args.documentId);
    const ownerEmail = access.resource.ownerEmail as string;
    const row = firstRow(
      await getDb()
        .select()
        .from(schema.documentVersions)
        .where(
          and(
            eq(schema.documentVersions.ownerEmail, ownerEmail),
            eq(schema.documentVersions.documentId, args.documentId),
            eq(schema.documentVersions.id, args.versionId),
          ),
        )
        .limit(1),
    );
    if (!row) {
      throw new ActionContractError(`Checkpoint not found: ${args.versionId}`, {
        errorCode: "DOCUMENT_CHECKPOINT_NOT_FOUND",
        statusCode: 404,
      });
    }
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
