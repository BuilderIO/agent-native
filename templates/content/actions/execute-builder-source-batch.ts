import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  type BuilderSourceBatchItemResult,
  type ContentDatabaseSource,
  type ContentDatabaseSourceChangeSet,
  type ExecuteBuilderSourceBatchRequest,
  type ExecuteBuilderSourceBatchResponse,
  type ExecuteBuilderSourceBatchTransition,
} from "../shared/api.js";
import {
  getContentDatabaseSourceSnapshotForWrite,
  resolveDatabaseForSourceMutation,
} from "./_database-source-utils.js";
import {
  executeBuilderSourceExecutionWithDeps,
  realExecutionDeps,
} from "./execute-builder-source-execution.js";
import prepareBuilderSourceExecution from "./prepare-builder-source-execution.js";

type DatabaseRecord = NonNullable<
  Awaited<ReturnType<typeof resolveDatabaseForSourceMutation>>
>;

export const DEFAULT_BUILDER_SOURCE_BATCH_CONCURRENCY = 3;
export const MAX_BUILDER_SOURCE_BATCH_CONCURRENCY = 8;

export interface ExecuteBuilderSourceBatchDeps {
  resolveDatabase: (
    args: Pick<ExecuteBuilderSourceBatchRequest, "databaseId" | "documentId">,
  ) => Promise<DatabaseRecord | null>;
  assertEditor: (database: DatabaseRecord) => Promise<void>;
  getSourceSnapshot: (
    database: DatabaseRecord,
  ) => Promise<ContentDatabaseSource | null>;
  runOne: (
    changeSetId: string,
    transition?: ExecuteBuilderSourceBatchTransition,
  ) => Promise<BuilderSourceBatchItemResult>;
}

function realBatchDeps(
  args: Pick<
    ExecuteBuilderSourceBatchRequest,
    "databaseId" | "documentId" | "sourceId"
  >,
): ExecuteBuilderSourceBatchDeps {
  return {
    resolveDatabase: (request) => resolveDatabaseForSourceMutation(request),
    assertEditor: async (database) => {
      await assertAccess("document", database.documentId, "editor");
    },
    getSourceSnapshot: (database) =>
      getContentDatabaseSourceSnapshotForWrite(database, args.sourceId),
    runOne: async (changeSetId, transition) => {
      const executionArgs = {
        databaseId: args.databaseId,
        documentId: args.documentId,
        sourceId: args.sourceId,
        changeSetId,
        publicationTransition: transition?.publicationTransition,
        confirmUnpublish: transition?.confirmUnpublish,
      };
      if (transition?.publicationTransition) {
        await prepareBuilderSourceExecution.run(executionArgs);
      }
      try {
        await executeBuilderSourceExecutionWithDeps(
          executionArgs,
          realExecutionDeps(args.sourceId),
        );
      } catch (error) {
        if (!isMissingGateMessage(errorMessage(error))) {
          throw error;
        }
        await prepareBuilderSourceExecution.run(executionArgs);
        await executeBuilderSourceExecutionWithDeps(
          executionArgs,
          realExecutionDeps(args.sourceId),
        );
      }
      return { changeSetId, status: "succeeded" };
    },
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Unknown Builder batch error.";
}

function isMissingGateMessage(message: string) {
  return /prepare the builder execution gate/i.test(message);
}

function isBlockedMessage(message: string) {
  return [
    /blocked/i,
    /approve/i,
    /disabled/i,
    /not allowed/i,
    /no longer exists/i,
    /changed since/i,
    /already running/i,
    /requires/i,
    /not ready/i,
    /refresh/i,
    /not executable/i,
  ].some((pattern) => pattern.test(message));
}

function clampConcurrency(value: number | undefined) {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_BUILDER_SOURCE_BATCH_CONCURRENCY;
  }
  return Math.max(1, Math.min(MAX_BUILDER_SOURCE_BATCH_CONCURRENCY, value));
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter((id) => id.trim())));
}

function hasSucceededExecution(changeSet: ContentDatabaseSourceChangeSet) {
  return changeSet.executions.some(
    (execution) => execution.state === "succeeded",
  );
}

function defaultBatchChangeSetIds(source: ContentDatabaseSource) {
  return source.changeSets
    .filter(
      (changeSet) =>
        changeSet.direction === "outbound" && changeSet.state === "approved",
    )
    .map((changeSet) => changeSet.id);
}

function explicitBatchBlocker(
  changeSet: ContentDatabaseSourceChangeSet | undefined,
) {
  if (!changeSet) return "Source change-set not found.";
  if (changeSet.direction !== "outbound") {
    return "Only outbound Builder change sets can be executed.";
  }
  if (
    changeSet.state !== "pending_push" &&
    changeSet.state !== "staged_revision" &&
    changeSet.state !== "approved"
  ) {
    return "Approve the Builder change set before executing it.";
  }
  return null;
}

async function runBoundedPool<T>(
  items: T[],
  maxConcurrency: number,
  worker: (item: T, index: number) => Promise<BuilderSourceBatchItemResult>,
) {
  const results = new Array<BuilderSourceBatchItemResult>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(maxConcurrency, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}

function summarize(results: BuilderSourceBatchItemResult[]) {
  return {
    total: results.length,
    succeeded: results.filter((result) => result.status === "succeeded").length,
    blocked: results.filter((result) => result.status === "blocked").length,
    failed: results.filter((result) => result.status === "failed").length,
  };
}

export async function executeBuilderSourceBatchWithDeps(
  args: ExecuteBuilderSourceBatchRequest,
  deps: ExecuteBuilderSourceBatchDeps,
): Promise<ExecuteBuilderSourceBatchResponse> {
  const database = await deps.resolveDatabase(args);
  if (!database) throw new Error("Database not found.");
  await deps.assertEditor(database);

  const source = await deps.getSourceSnapshot(database);
  if (!source || source.sourceType !== "builder-cms") {
    throw new Error("Attach a Builder CMS source before executing writes.");
  }

  const ids = uniqueIds(args.changeSetIds ?? defaultBatchChangeSetIds(source));
  const changeSetsById = new Map(
    source.changeSets.map((changeSet) => [changeSet.id, changeSet]),
  );
  const maxConcurrency = clampConcurrency(args.maxConcurrency);
  const results = await runBoundedPool(
    ids,
    maxConcurrency,
    async (changeSetId) => {
      const changeSet = changeSetsById.get(changeSetId);
      if (changeSet && hasSucceededExecution(changeSet)) {
        return {
          changeSetId,
          status: "succeeded",
          message: "Builder execution already succeeded; skipped.",
        };
      }

      const blocker = explicitBatchBlocker(changeSet);
      if (blocker) {
        return { changeSetId, status: "blocked", message: blocker };
      }

      try {
        return await deps.runOne(changeSetId, args.transitions?.[changeSetId]);
      } catch (error) {
        const message = errorMessage(error);
        return {
          changeSetId,
          status: isBlockedMessage(message) ? "blocked" : "failed",
          message,
        };
      }
    },
  );

  return {
    summary: summarize(results),
    results,
  };
}

const transitionSchema = z.object({
  publicationTransition: z.enum(["publish", "unpublish"]).optional(),
  confirmUnpublish: z.boolean().optional(),
});

export default defineAction({
  description:
    "Execute a bounded batch of approved outbound Builder CMS change-sets. Each item uses the existing prepare and execute gates, continues on item errors, and does not publish or unpublish unless an explicit per-change-set transition is provided.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
    sourceId: z
      .string()
      .optional()
      .describe("Target source ID (defaults to the primary source)"),
    changeSetIds: z
      .array(z.string())
      .optional()
      .describe(
        "Approved source change-set IDs. Defaults to all approved outbound Builder change-sets.",
      ),
    maxConcurrency: z
      .number()
      .int()
      .min(1)
      .max(MAX_BUILDER_SOURCE_BATCH_CONCURRENCY)
      .optional()
      .describe("Maximum Builder change-sets to execute at once."),
    transitions: z
      .record(z.string(), transitionSchema)
      .optional()
      .describe(
        "Optional per-change-set publication transitions. Omit by default to preserve publication state.",
      ),
  }),
  run: async (
    args: ExecuteBuilderSourceBatchRequest,
  ): Promise<ExecuteBuilderSourceBatchResponse> => {
    return executeBuilderSourceBatchWithDeps(args, realBatchDeps(args));
  },
});
