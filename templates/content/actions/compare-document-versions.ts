import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  documentHistoryCheckpoint,
  findDocumentCheckpoint,
} from "../server/lib/document-version-names.js";
import { builderBodyLineDiff } from "../shared/builder-body-diff.js";
import type {
  DocumentVersionComparison,
  DocumentVersionComparisonSide,
} from "../shared/document-history.js";
import { documentVersionComparisonOutput } from "./_document-version-schemas.js";

const COMPARISON_OPTIONS = {
  maxHunks: 40,
  maxHunkLines: 120,
  preserveIndentation: true,
};

interface ComparedVersion {
  side: DocumentVersionComparisonSide;
  content: string;
}

export default defineAction({
  description:
    "Compare two versions of a page and return what changed from the first to the second: the title change and the body's changed lines with a little unchanged context. Name each version by versionId (from list-document-versions) or by its exact versionName, ignoring case. Leave out both to* fields to compare with the current page as saved. Use get-document-history-checkpoint to read a whole version.",
  schema: z.object({
    documentId: z.string().min(1).describe("Document ID"),
    fromVersionId: z
      .string()
      .min(1)
      .optional()
      .describe("Saved version to compare from"),
    fromVersionName: z
      .string()
      .min(1)
      .optional()
      .describe("Name of the saved version to compare from"),
    toVersionId: z
      .string()
      .min(1)
      .optional()
      .describe("Saved version to compare to; omit for the current page"),
    toVersionName: z
      .string()
      .min(1)
      .optional()
      .describe("Name of the saved version to compare to"),
  }),
  outputSchema: documentVersionComparisonOutput,
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  searchHints: [
    "what changed since",
    "diff versions",
    "compare with a week ago",
    "version differences",
  ],
  run: async (args): Promise<DocumentVersionComparison> => {
    const access = await assertAccess("document", args.documentId, "viewer");
    const ownerEmail = access.resource.ownerEmail as string;
    const checkpointVersion = async (
      versionId: string | undefined,
      versionName: string | undefined,
    ): Promise<ComparedVersion> => {
      const row = await findDocumentCheckpoint({
        ownerEmail,
        documentId: args.documentId,
        versionId,
        versionName,
      });
      const checkpoint = documentHistoryCheckpoint(row);
      return {
        side: {
          kind: "checkpoint",
          id: checkpoint.id,
          name: checkpoint.name,
          title: checkpoint.title,
          at: checkpoint.createdAt,
        },
        content: row.content,
      };
    };
    const from = await checkpointVersion(
      args.fromVersionId,
      args.fromVersionName,
    );
    const to: ComparedVersion =
      args.toVersionId || args.toVersionName
        ? await checkpointVersion(args.toVersionId, args.toVersionName)
        : {
            side: {
              kind: "current",
              id: null,
              name: null,
              title: access.resource.title as string,
              at: access.resource.updatedAt as string,
            },
            content: access.resource.content as string,
          };
    const title =
      from.side.title === to.side.title
        ? null
        : { before: from.side.title, after: to.side.title };
    const body = builderBodyLineDiff(
      from.content,
      to.content,
      COMPARISON_OPTIONS,
    );
    return {
      from: from.side,
      to: to.side,
      identical: title === null && body === null,
      title,
      body,
    };
  },
});
