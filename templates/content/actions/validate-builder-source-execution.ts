import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type {
  ContentDatabaseResponse,
  ValidateBuilderSourceExecutionRequest,
} from "../shared/api.js";
import { getDb, schema } from "../server/db/index.js";
import {
  buildBuilderCmsExecutionPlan,
  builderCmsExecutionIdempotencyKey,
  validateBuilderCmsExecutionDryRun,
} from "./_builder-cms-write-adapter.js";
import {
  getContentDatabaseSourceSnapshot,
  resolveDatabaseForSourceMutation,
} from "./_database-source-utils.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

function parsePayload(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export default defineAction({
  description:
    "Validate a prepared Builder CMS execution gate as a local dry run. This rebuilds and compares the write plan, but never calls Builder APIs.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
    changeSetId: z.string().describe("Approved source change-set ID"),
    idempotencyKey: z
      .string()
      .optional()
      .describe("Optional execution idempotency key to validate"),
  }),
  run: async (
    args: ValidateBuilderSourceExecutionRequest,
  ): Promise<ContentDatabaseResponse> => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");

    const source = await getContentDatabaseSourceSnapshot(database);
    if (!source || source.sourceType !== "builder-cms") {
      throw new Error(
        "Attach a Builder CMS source before validating execution.",
      );
    }

    const changeSet = source.changeSets.find(
      (candidate) => candidate.id === args.changeSetId,
    );
    if (!changeSet) throw new Error("Source change-set not found.");

    const plan = buildBuilderCmsExecutionPlan({
      source,
      changeSet,
      pushModeConfirmation: changeSet.pushMode ?? undefined,
    });
    const expectedKey = builderCmsExecutionIdempotencyKey({
      sourceId: source.id,
      changeSetId: changeSet.id,
      pushMode: plan.pushMode,
    });
    if (args.idempotencyKey && args.idempotencyKey !== expectedKey) {
      throw new Error(
        "Execution idempotency key does not match this write plan.",
      );
    }
    const db = getDb();
    const [execution] = await db
      .select()
      .from(schema.contentDatabaseSourceExecutions)
      .where(
        and(
          eq(schema.contentDatabaseSourceExecutions.sourceId, source.id),
          eq(schema.contentDatabaseSourceExecutions.changeSetId, changeSet.id),
          eq(
            schema.contentDatabaseSourceExecutions.idempotencyKey,
            expectedKey,
          ),
        ),
      );
    if (!execution) {
      throw new Error(
        "Prepare the Builder execution gate before validating it.",
      );
    }

    const now = new Date().toISOString();
    const payload = validateBuilderCmsExecutionDryRun({
      storedPayload: parsePayload(execution.payloadJson),
      plan,
      now,
    });
    const dryRun = payload.dryRun;
    const stale =
      dryRun?.status === "stale" && dryRun.mismatches.length > 0
        ? ` ${dryRun.mismatches.join(" ")}`
        : "";
    const summary =
      dryRun?.status === "validated"
        ? `${plan.summary} Dry run validated locally.`
        : dryRun?.status === "blocked"
          ? `${plan.summary} Dry run validated blockers locally.`
          : `${plan.summary} Dry run found a stale execution gate.${stale}`;

    await db
      .update(schema.contentDatabaseSourceExecutions)
      .set({
        state: dryRun?.status === "stale" ? "blocked" : plan.state,
        summary,
        payloadJson: JSON.stringify(payload),
        lastError:
          dryRun?.status === "stale" ? dryRun.mismatches[0] : plan.lastError,
        updatedAt: now,
      })
      .where(eq(schema.contentDatabaseSourceExecutions.id, execution.id));

    await db
      .update(schema.contentDatabaseSources)
      .set({ updatedAt: now })
      .where(eq(schema.contentDatabaseSources.id, source.id));

    return getContentDatabaseResponse(database.id);
  },
});
