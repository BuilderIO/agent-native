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
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");

    const source = await getContentDatabaseSourceSnapshotForWrite(
      database,
      args.sourceId,
    );
    if (!source || source.sourceType !== "builder-cms") {
      throw new Error(
        "Attach a Builder CMS source before preparing execution.",
      );
    }

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
    const [existing] = await db
      .select()
      .from(schema.contentDatabaseSourceExecutions)
      .where(
        and(
          eq(
            schema.contentDatabaseSourceExecutions.idempotencyKey,
            plan.idempotencyKey,
          ),
          eq(schema.contentDatabaseSourceExecutions.sourceId, source.id),
        ),
      );

    if (existing) {
      await db
        .update(schema.contentDatabaseSourceExecutions)
        .set({
          state: plan.state,
          summary: plan.summary,
          payloadJson: JSON.stringify(plan.payload),
          lastError: plan.lastError,
          updatedAt: now,
        })
        .where(eq(schema.contentDatabaseSourceExecutions.id, existing.id));
    } else {
      await db.insert(schema.contentDatabaseSourceExecutions).values({
        id: crypto.randomUUID(),
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

    await db
      .update(schema.contentDatabaseSources)
      .set({ updatedAt: now })
      .where(eq(schema.contentDatabaseSources.id, source.id));

    return getContentDatabaseResponse(database.id);
  },
});
