import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import type {
  ContentDatabaseSourceReviewPayload,
  PreviewBuilderSourceReviewRequest,
  PreviewBuilderSourceReviewResponse,
} from "../shared/api.js";
import { createBuilderSourceTiming } from "./_builder-source-timings.js";
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

function withoutBodyPayloads(
  review: ContentDatabaseSourceReviewPayload,
): ContentDatabaseSourceReviewPayload {
  return {
    ...review,
    rows: review.rows.map((row) => {
      let next = row;
      if (row.bodyChange) {
        const {
          proposedContent: _proposedContent,
          proposedBlocksJson: _proposedBlocksJson,
          sidecarsJson: _sidecarsJson,
          ...bodyChange
        } = row.bodyChange;
        next = { ...next, bodyChange };
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
        "Review only this many pages and list the rest in remainingDocumentIds; 0 lists a whole-source review's pages without reviewing any, unless a change has no page, when the whole source is reviewed",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (
    args: PreviewBuilderSourceReviewRequest,
  ): Promise<PreviewBuilderSourceReviewResponse> => {
    // Returned with the response, so a slow review on a deployed site shows
    // which step took the time.
    const timing = createBuilderSourceTiming("preview_builder_source_review");
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");

    if (args.scope === "selected" && !args.documentIds?.length) {
      throw new Error("Select at least one Builder row before reviewing it.");
    }
    if (args.scope === "selected" && args.batchSize === 0) {
      fail("Review at least one selected page per batch.", {
        errorCode: "builder_review_batch_empty",
        statusCode: 400,
      });
    }

    const bodyComparison = args.bodyComparison ?? "blocks";
    let reviewDocumentIds =
      args.scope === "selected" ? args.documentIds : undefined;
    if (args.batchSize !== undefined && args.scope !== "selected") {
      const scope = await timing.measure("scope", () =>
        builderReviewDocumentScope(database, args.sourceId),
      );
      if (!scope || scope.lightweight.sourceType !== "builder-cms") {
        fail("Attach a Builder CMS source before reviewing updates.", {
          errorCode: "builder_source_missing",
          statusCode: 412,
        });
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
          timings: timing.finish(),
        };
      }
      if (scope.documentIds) {
        const reviewableChangeSetIds = new Set(scope.reviewableChangeSetIds);
        const priorityByDocumentId = new Map<string, number>();
        const rejectedDocumentIds = new Set<string>();
        for (const changeSet of scope.lightweight.changeSets) {
          if (!changeSet.documentId) continue;
          if (changeSet.state === "rejected") {
            rejectedDocumentIds.add(changeSet.documentId);
          }
          if (!reviewableChangeSetIds.has(changeSet.id)) continue;
          const priority = reviewPreparePriority(changeSet, scope.lightweight);
          const known = priorityByDocumentId.get(changeSet.documentId);
          if (known === undefined || priority < known) {
            priorityByDocumentId.set(changeSet.documentId, priority);
          }
        }
        // Only a reviewable change ranks a page first. A page whose change
        // was rejected shows no row, so it goes last, behind pages that have
        // no change yet, or it fills the first batch with nothing.
        const priorityOf = (documentId: string) =>
          priorityByDocumentId.get(documentId) ??
          (rejectedDocumentIds.has(documentId) ? 100 : 99);
        reviewDocumentIds = scope.documentIds
          .map((documentId, index) => ({ documentId, index }))
          .sort(
            (left, right) =>
              priorityOf(left.documentId) - priorityOf(right.documentId) ||
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
            timings: timing.finish(),
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
    const source = await timing.measure("snapshot", () =>
      getContentDatabaseSourceSnapshotForReview(
        database,
        args.sourceId,
        reviewDocumentIds,
        { builderBodyComparison: bodyComparison, blocksCheckDocumentIds },
      ),
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
    const authoritativeSource = await timing.measure("targets", () =>
      withAuthoritativeBuilderTargetRows({ source, changeSets }),
    );
    const payloadStartedAt = timing.start();
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
    timing.record("payload", payloadStartedAt);

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
      timings: timing.finish(),
    };
  },
});
