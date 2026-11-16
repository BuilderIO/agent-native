import { ActionContractError } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import { documentChangeResource } from "../server/lib/document-change-resource.js";
import { firstRow } from "../server/lib/first-row.js";
import { restoreDocumentState } from "./_document-state-restore.js";

export default defineAction({
  searchHints: [
    "revert a page",
    "previous version",
    "roll back",
    "page history",
  ],
  description:
    "Restore a document to a saved version, snapshotting the current state first.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID"),
    versionId: z.string().optional().describe("Version ID"),
    expectedUpdatedAt: z
      .string()
      .min(1)
      .describe("Current document updatedAt observed before choosing restore"),
  }),
  changeResource: (input) => documentChangeResource(input.documentId),
  run: async (args, ctx) => {
    if (!args.documentId) throw new Error("--documentId is required");
    if (!args.versionId) throw new Error("--versionId is required");
    const documentId = args.documentId;
    const versionId = args.versionId;
    return restoreDocumentState({
      ctx,
      documentId,
      expectedUpdatedAt: args.expectedUpdatedAt,
      operation: "restore-document-version",
      target: async (current, db) => {
        const version = firstRow(
          await db
            .select({
              title: schema.documentVersions.title,
              content: schema.documentVersions.content,
            })
            .from(schema.documentVersions)
            .where(
              and(
                eq(schema.documentVersions.id, versionId),
                eq(schema.documentVersions.documentId, documentId),
                eq(schema.documentVersions.ownerEmail, current.ownerEmail),
              ),
            )
            .limit(1),
        );
        if (!version) {
          throw new ActionContractError("Document checkpoint not found.", {
            errorCode: "DOCUMENT_CHECKPOINT_NOT_FOUND",
            statusCode: 404,
          });
        }
        return { ...version, checkpointId: versionId };
      },
    });
  },
});
