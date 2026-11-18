import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import type {
  ContentDatabaseSourceReviewPayload,
  PreviewBuilderSourceReviewRequest,
  PreviewBuilderSourceReviewResponse,
} from "../shared/api.js";
import {
  builderReviewDocumentScope,
  getContentDatabaseSourceSnapshotForReview,
  resolveDatabaseForSourceMutation,
} from "./_database-source-utils.js";
import {
  BUILDER_SOURCE_REVIEW_PREPARE_LIMIT,
  buildBuilderSourceReviewPayload,
  reviewPreparePriority,
  withAuthoritativeBuilderTargetRows,
} from "./prepare-builder-source-review.js";

/**
 * The dialog reads only a body change's excerpts and diff, and only the
 * outcome of a row's earlier Check. The proposed text, its Builder blocks
 * and the Builder request a Check prepared can run to megabytes across a
 * review, and Check reads them again on the server.
 */
function withoutBodyPayloads(
  review: ContentDatabaseSourceReviewPayload,
): ContentDatabaseSourceReviewPayload {
  return {
    ...review,
    rows: review.rows.map((row) => {
      let next = row;
      if (row.bodyChange) {
        next = {
          ...next,
          bodyChange: {
            ...row.bodyChange,
            proposedContent: undefined,
            proposedBlocksJson: undefined,
            sidecarsJson: undefined,
          },
        };
      }
      if (row.execution && "request" in row.execution.payload) {
        const { request: _request, ...payload } = row.execution.payload;
        next = { ...next, execution: { ...row.execution, payload } };
      }
      return next;
    }),
  };
}

export default defineAction({
  description:
    "Preview complete Builder CMS review diffs, including document body changes, without approving or writing anything.",
  schema: z.object({
    databaseId: z.string().optional().describe("Collection ID"),
    documentId: z.string().optional().describe("Collection document/page ID"),
    sourceId: z.string().optional().describe("Specific Builder source ID"),
    scope: z.enum(["selected", "all"]).optional().default("all"),
    documentIds: z
      .array(z.string())
      .max(BUILDER_SOURCE_REVIEW_PREPARE_LIMIT)
      .optional()
      .describe("Optional selected document IDs that bound the preview"),
    bodyComparison: z
      .enum(["text", "blocks"])
      .optional()
      .describe(
        "text compares bodies as text without converting them to Builder blocks, which is fast; blocks (the default) converts them, as Check does",
      ),
    batchSize: z.coerce
      .number()
      .int()
      .min(0)
      .max(BUILDER_SOURCE_REVIEW_PREPARE_LIMIT)
      .optional()
      .describe(
        "Review only this many pages and list the rest in remainingDocumentIds; 0 lists a whole-source review's pages without reviewing any",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (
    args: PreviewBuilderSourceReviewRequest,
  ): Promise<PreviewBuilderSourceReviewResponse> => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");

    if (args.scope === "selected" && !args.documentIds?.length) {
      throw new Error("Select at least one Builder row before reviewing it.");
    }
    if (args.scope === "selected" && args.batchSize === 0) {
      throw new Error("Review at least one selected page per batch.");
    }

    const bodyComparison = args.bodyComparison ?? "blocks";
    // The pages this response reviews, when it reviews a bounded set.
    let reviewDocumentIds =
      args.scope === "selected" ? args.documentIds : undefined;
    if (args.batchSize !== undefined && args.scope !== "selected") {
      const scope = await builderReviewDocumentScope(database, args.sourceId);
      if (!scope || scope.lightweight.sourceType !== "builder-cms") {
        throw new Error(
          "Attach a Builder CMS source before reviewing updates.",
        );
      }
      if (scope.documentIds?.length === 0) {
        return {
          sourceId: scope.lightweight.id,
          sourceTable: scope.lightweight.sourceTable,
          changeSetIds: [],
          review: null,
          bodyComparison,
          documentIds: [],
          remainingDocumentIds: [],
        };
      }
      // A change with no page leaves only the whole source to review.
      if (scope.documentIds) {
        const priorityByDocumentId = new Map<string, number>();
        for (const changeSet of scope.lightweight.changeSets) {
          if (!changeSet.documentId) continue;
          const priority = reviewPreparePriority(changeSet, scope.lightweight);
          const known = priorityByDocumentId.get(changeSet.documentId);
          if (known === undefined || priority < known) {
            priorityByDocumentId.set(changeSet.documentId, priority);
          }
        }
        // Pages with a recorded change go first, in Check's order.
        reviewDocumentIds = scope.documentIds
          .map((documentId, index) => ({ documentId, index }))
          .sort(
            (left, right) =>
              (priorityByDocumentId.get(left.documentId) ?? 99) -
                (priorityByDocumentId.get(right.documentId) ?? 99) ||
              left.index - right.index,
          )
          .map((entry) => entry.documentId);
        if (args.batchSize === 0) {
          return {
            sourceId: scope.lightweight.id,
            sourceTable: scope.lightweight.sourceTable,
            changeSetIds: [],
            review: null,
            bodyComparison,
            documentIds: [],
            remainingDocumentIds: reviewDocumentIds,
          };
        }
      }
    }
    let remainingDocumentIds: string[] | undefined;
    if (args.batchSize && reviewDocumentIds) {
      remainingDocumentIds = reviewDocumentIds.slice(args.batchSize);
      reviewDocumentIds = reviewDocumentIds.slice(0, args.batchSize);
    }

    const blocksCheckDocumentIds = new Set<string>();
    const source = await getContentDatabaseSourceSnapshotForReview(
      database,
      args.sourceId,
      reviewDocumentIds,
      { builderBodyComparison: bodyComparison, blocksCheckDocumentIds },
    );
    if (!source || source.sourceType !== "builder-cms") {
      throw new Error("Attach a Builder CMS source before reviewing updates.");
    }

    const reviewDocumentIdSet = reviewDocumentIds
      ? new Set(reviewDocumentIds)
      : null;
    const allReviewableChanges = source.changeSets.filter((changeSet) => {
      if (
        changeSet.direction !== "outbound" ||
        (changeSet.state !== "pending_push" &&
          changeSet.state !== "staged_revision" &&
          changeSet.state !== "approved")
      ) {
        return false;
      }
      return (
        !reviewDocumentIdSet ||
        (!!changeSet.documentId &&
          reviewDocumentIdSet.has(changeSet.documentId))
      );
    });
    const changeSets = [...allReviewableChanges]
      .sort(
        (left, right) =>
          reviewPreparePriority(left, source) -
          reviewPreparePriority(right, source),
      )
      .slice(0, BUILDER_SOURCE_REVIEW_PREPARE_LIMIT);
    const authoritativeSource = await withAuthoritativeBuilderTargetRows({
      source,
      changeSets,
    });
    const review =
      changeSets.length > 0
        ? withoutBodyPayloads(
            buildBuilderSourceReviewPayload({
              source: authoritativeSource,
              changeSets,
            }),
          )
        : null;
    if (review) {
      review.totalRowCount = allReviewableChanges.length;
      review.preparedRowLimit = changeSets.length;
    }

    return {
      sourceId: source.id,
      sourceTable: source.sourceTable,
      changeSetIds: changeSets.map((changeSet) => changeSet.id),
      review,
      bodyComparison,
      ...(reviewDocumentIds ? { documentIds: reviewDocumentIds } : {}),
      ...(remainingDocumentIds ? { remainingDocumentIds } : {}),
      ...(bodyComparison === "text"
        ? {
            blocksCheckDocumentIds: [...blocksCheckDocumentIds].filter(
              (documentId) =>
                !reviewDocumentIdSet || reviewDocumentIdSet.has(documentId),
            ),
          }
        : {}),
    };
  },
});
