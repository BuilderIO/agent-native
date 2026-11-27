import { runWithRequestContext } from "@agent-native/core/server";

import {
  CONTENT_COLLECTION_STEPS,
  stepEnabled,
  type ContentCollectionStepId,
} from "./config.js";
import {
  contentRunFailureFromError,
  type ContentStep,
  type ContentStepResult,
} from "./step.js";
import { agentNativeSignupsStep } from "./steps/agent-native-signups.js";
import { builderBlogStep } from "./steps/builder-blog.js";
import { dailyDevStep } from "./steps/daily-dev.js";
import { ga4Step } from "./steps/ga4.js";
import { searchConsoleQueriesStep } from "./steps/search-console-queries.js";
import { searchConsoleStep } from "./steps/search-console.js";
import { signupsStep } from "./steps/signups.js";
import { xStep } from "./steps/x.js";
import { youtubeStep } from "./steps/youtube.js";
import {
  closeStaleContentRuns,
  completeContentRun,
  failContentRun,
  listEnabledContentCollections,
  startContentRun,
  type ContentCollection,
  type ContentRunStatus,
  type ContentRunTrigger,
} from "./store.js";

const STEPS: Record<ContentCollectionStepId, ContentStep> = {
  builder_blog: builderBlogStep,
  ga4: ga4Step,
  daily_dev: dailyDevStep,
  search_console: searchConsoleStep,
  search_console_queries: searchConsoleQueriesStep,
  signups: signupsStep,
  agent_native_signups: agentNativeSignupsStep,
  youtube: youtubeStep,
  x: xStep,
};

export type ContentStepRunSummary = {
  tenantKey: string;
  step: ContentCollectionStepId;
  status: ContentRunStatus | "skipped";
  runId: string | null;
  reason?: string;
};

export async function collectContentForCollection(
  collection: ContentCollection,
  options: {
    trigger: ContentRunTrigger;
    now?: Date;
    clock?: () => Date;
    signal?: AbortSignal;
    steps?: ContentCollectionStepId[];
  },
): Promise<ContentStepRunSummary[]> {
  const now = options.now ?? new Date();
  const started = Date.now();
  const clock =
    options.clock ?? (() => new Date(now.getTime() + Date.now() - started));
  const summaries: ContentStepRunSummary[] = [];
  const steps = options.steps ?? [...CONTENT_COLLECTION_STEPS];

  for (const stepId of steps) {
    if (!stepEnabled(collection.config, stepId)) {
      summaries.push({
        tenantKey: collection.tenantKey,
        step: stepId,
        status: "skipped",
        runId: null,
        reason: "step_disabled",
      });
      continue;
    }
    const claim = await startContentRun(
      collection,
      stepId,
      options.trigger,
      now,
    );
    if ("reason" in claim) {
      summaries.push({
        tenantKey: collection.tenantKey,
        step: stepId,
        status: "skipped",
        runId: null,
        reason: claim.reason,
      });
      continue;
    }

    const runId = claim.runId;
    let result: ContentStepResult | undefined;
    try {
      result = await runWithRequestContext(
        {
          userEmail: collection.ownerEmail,
          ...(collection.orgId ? { orgId: collection.orgId } : {}),
        },
        () =>
          STEPS[stepId].run({
            collection,
            runId,
            now,
            clock,
            ...(options.signal ? { signal: options.signal } : {}),
          }),
      );
      await completeContentRun(
        collection,
        runId,
        stepId,
        result,
        result.outcome,
      );
      const stopped = result.outcome.stopped;
      summaries.push({
        tenantKey: collection.tenantKey,
        step: stepId,
        status: stopped?.status ?? "succeeded",
        runId,
        ...(stopped ? { reason: stopped.errorCode } : {}),
      });
    } catch (error) {
      const failure = {
        bytesProcessed: result?.outcome.bytesProcessed,
        bytesCap: result?.outcome.bytesCap,
        ...contentRunFailureFromError(error),
      };
      await failContentRun(runId, failure);
      summaries.push({
        tenantKey: collection.tenantKey,
        step: stepId,
        status: failure.status,
        runId,
        reason: failure.errorCode,
      });
    }
  }
  return summaries;
}

/** The daily pass over every tenant that turned content collection on. */
export async function collectContentForAllTenants(
  options: { now?: Date; signal?: AbortSignal } = {},
): Promise<ContentStepRunSummary[]> {
  await closeStaleContentRuns(options.now);
  const summaries: ContentStepRunSummary[] = [];
  let afterTenantKey: string | undefined;
  for (;;) {
    const collections = await listEnabledContentCollections(afterTenantKey);
    for (const collection of collections) {
      summaries.push(
        ...(await collectContentForCollection(collection, {
          trigger: "scheduled",
          ...options,
        })),
      );
    }
    if (collections.length < 1000) break;
    afterTenantKey = collections[collections.length - 1]!.tenantKey;
  }
  return summaries;
}
