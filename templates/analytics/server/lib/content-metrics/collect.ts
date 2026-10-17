import { runWithRequestContext } from "@agent-native/core/server";

import {
  CONTENT_COLLECTION_STEPS,
  stepEnabled,
  type ContentCollectionStepId,
} from "./config.js";
import { contentRunFailureFromError, type ContentStep } from "./step.js";
import { builderBlogStep } from "./steps/builder-blog.js";
import { ga4Step } from "./steps/ga4.js";
import { searchConsoleStep } from "./steps/search-console.js";
import {
  closeStaleContentRuns,
  completeContentRun,
  failContentRun,
  latestContentRun,
  listEnabledContentCollections,
  startContentRun,
  type ContentCollection,
  type ContentRunStatus,
  type ContentRunTrigger,
} from "./store.js";

const STEPS: Record<ContentCollectionStepId, ContentStep> = {
  builder_blog: builderBlogStep,
  ga4: ga4Step,
  search_console: searchConsoleStep,
};

export type ContentStepRunSummary = {
  tenantKey: string;
  step: ContentCollectionStepId;
  status: ContentRunStatus | "skipped";
  runId: string | null;
  reason?: string;
};

function sameUtcDay(iso: string, now: Date): boolean {
  return iso.slice(0, 10) === now.toISOString().slice(0, 10);
}

/**
 * A scheduled pass runs each enabled step at most once per UTC day. A step
 * that already succeeded or hit its cost limit today is not run again, so a
 * restarted server or a retried trigger never pays twice.
 */
async function skipReason(
  collection: ContentCollection,
  step: ContentCollectionStepId,
  trigger: ContentRunTrigger,
  now: Date,
): Promise<string | null> {
  const latest = await latestContentRun(collection, step);
  if (!latest) return null;
  if (latest.status === "running") return "already_running";
  if (
    trigger === "scheduled" &&
    sameUtcDay(latest.startedAt, now) &&
    (latest.status === "succeeded" || latest.status === "cost_limited")
  ) {
    return "already_ran_today";
  }
  return null;
}

export async function collectContentForCollection(
  collection: ContentCollection,
  options: {
    trigger: ContentRunTrigger;
    now?: Date;
    signal?: AbortSignal;
    steps?: ContentCollectionStepId[];
  },
): Promise<ContentStepRunSummary[]> {
  const now = options.now ?? new Date();
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
    const reason = await skipReason(collection, stepId, options.trigger, now);
    if (reason) {
      summaries.push({
        tenantKey: collection.tenantKey,
        step: stepId,
        status: "skipped",
        runId: null,
        reason,
      });
      continue;
    }

    const runId = await startContentRun(
      collection,
      stepId,
      options.trigger,
      now,
    );
    try {
      const result = await runWithRequestContext(
        {
          userEmail: collection.ownerEmail,
          ...(collection.orgId ? { orgId: collection.orgId } : {}),
        },
        () =>
          STEPS[stepId].run({
            collection,
            now,
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
      summaries.push({
        tenantKey: collection.tenantKey,
        step: stepId,
        status: "succeeded",
        runId,
      });
    } catch (error) {
      const failure = contentRunFailureFromError(error);
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
  for (const collection of await listEnabledContentCollections()) {
    summaries.push(
      ...(await collectContentForCollection(collection, {
        trigger: "scheduled",
        ...options,
      })),
    );
  }
  return summaries;
}
