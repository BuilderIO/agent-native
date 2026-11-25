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
  builderReviewFirstDocumentIds,
  getContentDatabaseSourceSnapshotForReview,
  isReviewableBuilderChangeSet,
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
    quickStart: z
      .boolean()
      .optional()
      .describe(
        "With scope all and a batchSize above 0, review the first pages whose body changed, without working out field edits from the rows or listing the rest; reviews none when a saved change is pending. List the rest after with batchSize 0",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (
    args: PreviewBuilderSourceReviewRequest,
  ): Promise<PreviewBuilderSourceReviewResponse> => {
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
    const quickStartBatchSize =
      args.quickStart && args.scope !== "selected" ? (args.batchSize ?? 0) : 0;
    if (quickStartBatchSize > 0) {
      const first = await timing.measure("scope", () =>
        builderReviewFirstDocumentIds(
          database,
          args.sourceId,
          quickStartBatchSize,
        ),
      );
      if (!first || first.sourceType !== "builder-cms") {
        fail("Attach a Builder CMS source before reviewing updates.", {
          errorCode: "builder_source_missing",
          statusCode: 412,
        });
      }
      if (first.documentIds.length === 0) {
        return {
          sourceId: first.sourceId,
          sourceTable: first.sourceTable,
          changeSetIds: [],
          review: null,
          bodyComparison,
          documentIds: [],
          timings: timing.finish(),
        };
      }
      reviewDocumentIds = first.documentIds;
    } else if (args.batchSize !== undefined && args.scope !== "selected") {
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
    if (args.batchSize && reviewDocumentIds && quickStartBatchSize === 0) {
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
      if (!isReviewableBuilderChangeSet(changeSet)) return false;
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
