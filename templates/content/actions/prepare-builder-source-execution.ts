import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  ContentDatabaseResponse,
  PrepareBuilderSourceExecutionRequest,
} from "../shared/api.js";
import { buildBuilderCmsExecutionPlan } from "./_builder-cms-write-adapter.js";
import { claimBuilderSourceExecutionGate } from "./_builder-source-execution-claim.js";
import { shouldPreserveBuilderExecution } from "./_builder-source-execution-preservation.js";
import { createBuilderSourceTiming } from "./_builder-source-timings.js";
import {
  getContentDatabaseSourceSnapshotForWrite,
  resolveDatabaseForSourceMutation,
} from "./_database-source-utils.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

export default defineAction({
  description:
    "Prepare a local Builder CMS execution gate for an approved change set. This records the write plan and idempotency key, but never calls Builder APIs.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
    sourceId: z
      .string()
      .optional()
      .describe("Target source ID (defaults to the primary source)"),
    changeSetId: z.string().describe("Approved source change-set ID"),
    pushModeConfirmation: z
      .enum(["autosave", "draft", "publish"])
      .optional()
      .describe("Explicit push mode confirmation for the planned write"),
    publicationTransition: z
      .enum(["publish", "unpublish"])
      .optional()
      .describe("Explicit publication transition to validate at write time"),
    confirmUnpublish: z
      .boolean()
      .optional()
      .describe("Required explicit confirmation for unpublish transitions"),
  }),
  run: async (
    args: PrepareBuilderSourceExecutionRequest,
  ): Promise<ContentDatabaseResponse> => {
    const timing = createBuilderSourceTiming(
      "prepare_builder_source_execution",
    );
    try {
      const { database, source } = await timing.measure(
        "snapshot_read_and_diff_load",
        async () => {
          const database = await resolveDatabaseForSourceMutation(args);
          if (!database) throw new Error("Database not found.");
          await assertAccess("document", database.documentId, "editor");
          const source = await getContentDatabaseSourceSnapshotForWrite(
            database,
            args.sourceId,
          );
          return { database, source };
        },
      );
      if (!source || source.sourceType !== "builder-cms") {
        throw new Error(
          "Attach a Builder CMS source before preparing execution.",
        );
      }

      const gateStartedAt = timing.start();
      const changeSet = source.changeSets.find(
        (candidate) => candidate.id === args.changeSetId,
      );
      if (!changeSet) throw new Error("Source change-set not found.");

      const plan = buildBuilderCmsExecutionPlan({
        source,
        changeSet,
        pushModeConfirmation: args.pushModeConfirmation,
        publicationTransition: args.publicationTransition,
        confirmUnpublish: args.confirmUnpublish,
      });
      const now = new Date().toISOString();
      const db = getDb();
      const executionId = await claimBuilderSourceExecutionGate({
        ownerEmail: database.ownerEmail,
        sourceId: source.id,
        idempotencyKey: plan.idempotencyKey,
        now,
      });
      try {
        await db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(schema.contentDatabaseSourceExecutions)
            .where(eq(schema.contentDatabaseSourceExecutions.id, executionId))
            .limit(1);

          const preserve =
            existing &&
            shouldPreserveBuilderExecution({
              state: existing.state,
              payloadJson: existing.payloadJson,
            });

          if (existing && !preserve) {
            await tx
              .update(schema.contentDatabaseSourceExecutions)
              .set({
                state: plan.state,
                summary: plan.summary,
                payloadJson: JSON.stringify(plan.payload),
                lastError: plan.lastError,
                updatedAt: now,
              })
              .where(
                eq(schema.contentDatabaseSourceExecutions.id, existing.id),
              );
          } else if (!existing) {
            await tx.insert(schema.contentDatabaseSourceExecutions).values({
              id: executionId,
              ownerEmail: database.ownerEmail,
              sourceId: source.id,
              changeSetId: changeSet.id,
              adapter: plan.adapter,
              pushMode: plan.pushMode,
              state: plan.state,
              idempotencyKey: plan.idempotencyKey,
              summary: plan.summary,
              payloadJson: JSON.stringify(plan.payload),
              lastError: plan.lastError,
              createdAt: now,
              updatedAt: now,
            });
          }

          if (!preserve) {
            await tx
              .update(schema.contentDatabaseSources)
              .set({ updatedAt: now })
              .where(eq(schema.contentDatabaseSources.id, source.id));
          }
        });
      } catch (error) {
        // A concurrent prepare may win the unique (source, key) race after our
        // initial SELECT. Reuse that durable gate; rethrow unrelated failures.
        const [winner] = await db
          .select({ id: schema.contentDatabaseSourceExecutions.id })
          .from(schema.contentDatabaseSourceExecutions)
          .where(eq(schema.contentDatabaseSourceExecutions.id, executionId))
          .limit(1);
        if (!winner) throw error;
      }
      timing.record("gate_preparation_and_dry_run_validation", gateStartedAt);

      const response = await timing.measure("response_load", () =>
        getContentDatabaseResponse(database.id),
      );
      const result = { ...response, timings: timing.finish() };
      timing.log("succeeded");
      return result;
    } catch (error) {
      timing.ensure("gate_preparation_and_dry_run_validation");
      timing.log("failed");
      throw error;
    }
  },
});
