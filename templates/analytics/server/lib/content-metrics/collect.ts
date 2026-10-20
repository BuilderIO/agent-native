import { runWithRequestContext } from "@agent-native/core/server";

import {
  CONTENT_COLLECTION_STEPS,
  stepEnabled,
  type ContentCollectionStepId,
} from "./config.js";
import { contentRunFailureFromError, type ContentStep } from "./step.js";
import { builderBlogStep } from "./steps/builder-blog.js";
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
      await completeContentRun(collection, runId, result, result.outcome);
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
