import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import type {
  PreviewBuilderSourceReviewRequest,
  PreviewBuilderSourceReviewResponse,
} from "../shared/api.js";
import { createBuilderSourceTiming } from "./_builder-source-timings.js";
import {
  getContentDatabaseSourceSnapshotForReview,
  resolveDatabaseForSourceMutation,
} from "./_database-source-utils.js";
import {
  BUILDER_SOURCE_REVIEW_PREPARE_LIMIT,
  buildBuilderSourceReviewPayload,
  reviewPreparePriority,
  withAuthoritativeBuilderTargetRows,
} from "./prepare-builder-source-review.js";

export default defineAction({
  description:
    "Preview complete Builder CMS review diffs, including document body changes, without approving or writing anything.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
    sourceId: z.string().optional().describe("Specific Builder source ID"),
    scope: z.enum(["selected", "all"]).optional().default("all"),
    documentIds: z
      .array(z.string())
      .max(BUILDER_SOURCE_REVIEW_PREPARE_LIMIT)
      .optional()
      .describe("Optional selected document IDs that bound the preview"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (
    args: PreviewBuilderSourceReviewRequest,
  ): Promise<PreviewBuilderSourceReviewResponse> => {
    const timing = createBuilderSourceTiming("preview_builder_source_review");
    try {
      const database = await timing.measure("access_and_database", async () => {
        const database = await resolveDatabaseForSourceMutation(args);
        if (!database) throw new Error("Database not found.");
        await assertAccess("document", database.documentId, "editor");
        return database;
      });

      const selectedDocumentIds = new Set(args.documentIds ?? []);
      if (args.scope === "selected" && selectedDocumentIds.size === 0) {
        throw new Error("Select at least one Builder row before reviewing it.");
      }

      const source = await timing.measure("snapshot_and_candidate_diff", () =>
        getContentDatabaseSourceSnapshotForReview(
          database,
          args.sourceId,
          args.scope === "selected" ? args.documentIds : undefined,
        ),
      );
      if (!source || source.sourceType !== "builder-cms") {
        throw new Error(
          "Attach a Builder CMS source before reviewing updates.",
        );
      }

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
          args.scope === "all" ||
          (!!changeSet.documentId &&
            selectedDocumentIds.has(changeSet.documentId))
        );
      });
      const changeSets = [...allReviewableChanges]
        .sort(
          (left, right) =>
            reviewPreparePriority(left, source) -
            reviewPreparePriority(right, source),
        )
        .slice(0, BUILDER_SOURCE_REVIEW_PREPARE_LIMIT);
      const authoritativeSource = await timing.measure(
        "authoritative_target_rows",
        () => withAuthoritativeBuilderTargetRows({ source, changeSets }),
      );
      const review =
        changeSets.length > 0
          ? buildBuilderSourceReviewPayload({
              source: authoritativeSource,
              changeSets,
            })
          : null;
      if (review) {
        review.totalRowCount = allReviewableChanges.length;
        review.preparedRowLimit = changeSets.length;
      }

      const response = {
        sourceId: source.id,
        sourceTable: source.sourceTable,
        changeSetIds: changeSets.map((changeSet) => changeSet.id),
        review,
        timings: timing.finish(),
      };
      timing.log("succeeded");
      return response;
    } catch (error) {
      timing.log("failed");
      throw error;
    }
  },
});
