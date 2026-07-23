import { randomUUID } from "node:crypto";

import { runWithRequestContext } from "@agent-native/core/server";

import { getCreativeContext } from "../server/context.js";
import {
  enrichCreativeContextMedia,
  projectCreativeContextMedia,
} from "../server/enrichment.js";
import {
  claimJobLease,
  createDailyMaintenanceJob,
  createJob,
  getJob,
  inferBrandDnaProposalFromCorpus,
  listDueContextBackgroundJobDispatches,
  listContextSourcesDueForMaintenance,
  listAccessibleSearchDocuments,
  proposeCreativeContextSuggestion,
  purgeContextSourceArtifacts,
  releaseJobLease,
  updateLeasedJob,
} from "../store/index.js";
import type { ContextJob } from "../types.js";
import { rebuildFtsBatch, rebuildVectorBatch } from "./rebuild.js";
import { dispatchCreativeContextImportJob } from "./worker.js";

const LEASE_TTL_MS = 15 * 60_000;

export interface CreativeContextBackgroundDispatch {
  jobId: string;
  ownerEmail: string;
  orgId: string | null;
  appId: string;
  resumeAt?: string | null;
}

export type CreativeContextBackgroundDispatcher = (
  input: CreativeContextBackgroundDispatch,
) => Promise<void>;

let configuredDispatcher: CreativeContextBackgroundDispatcher | null = null;

export function registerCreativeContextBackgroundDispatcher(
  dispatcher: CreativeContextBackgroundDispatcher,
): () => void {
  configuredDispatcher = dispatcher;
  return () => {
    if (configuredDispatcher === dispatcher) configuredDispatcher = null;
  };
}

export async function processDueCreativeContextBackgroundJobs(input: {
  appId: string;
  limit?: number;
}): Promise<{ discovered: number; dispatched: number; failed: number }> {
  const due = await listDueContextBackgroundJobDispatches(input);
  let dispatched = 0;
  let failed = 0;
  for (const job of due) {
    try {
      await (configuredDispatcher ?? localDispatcher)(job);
      dispatched += 1;
    } catch (error) {
      failed += 1;
      console.error(
        `[creative-context] failed to dispatch background job ${job.jobId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return { discovered: due.length, dispatched, failed };
}

export async function enqueueCreativeContextDailyMaintenance(input: {
  appId: string;
  now?: number;
  limit?: number;
}): Promise<{ discovered: number; queued: number; failed: number }> {
  const now = input.now ?? Date.now();
  const due = await listContextSourcesDueForMaintenance({
    before: new Date(now - 24 * 60 * 60_000).toISOString(),
    limit: input.limit,
  });
  let queued = 0;
  let failed = 0;
  for (const source of due) {
    try {
      await runWithRequestContext(
        {
          userEmail: source.ownerEmail,
          ...(source.orgId ? { orgId: source.orgId } : {}),
        },
        async () => {
          const scheduledAt = new Date(now).toISOString();
          const { job, created } = await createDailyMaintenanceJob({
            sourceId: source.sourceId,
            scheduledAt,
          });
          if (!created) return;
          await dispatchCreativeContextImportJob({
            jobId: job.id,
            ownerEmail: source.ownerEmail,
            orgId: source.orgId,
            appId: input.appId,
          });
          queued += 1;
        },
      );
    } catch (error) {
      failed += 1;
      console.error(
        `[creative-context] maintenance enqueue ${source.sourceId} failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return { discovered: due.length, queued, failed };
}

export async function processCreativeContextBackgroundJob(
  input: CreativeContextBackgroundDispatch & { workerId?: string },
): Promise<ContextJob> {
  return runWithRequestContext(
    {
      userEmail: input.ownerEmail,
      ...(input.orgId ? { orgId: input.orgId } : {}),
    },
    async () => {
      const token = randomUUID();
      const claimed = await claimJobLease({
        jobId: input.jobId,
        owner: input.workerId ?? `creative-context:${process.pid}`,
        token,
        expiresAt: new Date(Date.now() + LEASE_TTL_MS).toISOString(),
      });
      if (!claimed)
        throw new Error("Creative context background lease was lost.");
      try {
        const outcome = await processClaimedJob(claimed);
        const progressCurrent =
          claimed.progressCurrent + Number(outcome.progress ?? 1);
        const nextResumeAt = outcome.hasMore
          ? new Date(Date.now() + 1_000).toISOString()
          : null;
        const updated = await updateLeasedJob({
          jobId: claimed.id,
          leaseToken: token,
          patch: {
            status: outcome.hasMore ? "paused" : "completed",
            progressCurrent,
            progressTotal: outcome.hasMore
              ? (claimed.progressTotal ?? null)
              : (claimed.progressTotal ?? progressCurrent),
            checkpoint: outcome.hasMore ? outcome.checkpoint : null,
            result: outcome.result,
            error: null,
            nextResumeAt,
            completedAt: outcome.hasMore ? null : new Date().toISOString(),
          },
        });
        if (!updated)
          throw new Error("Creative context background lease expired.");
        await releaseJobLease({ jobId: claimed.id, token });
        return (await getJob(claimed.id)) ?? updated;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failed = await updateLeasedJob({
          jobId: claimed.id,
          leaseToken: token,
          patch: {
            status: "failed",
            error: message.slice(0, 1_000),
            completedAt: new Date().toISOString(),
          },
        });
        await releaseJobLease({ jobId: claimed.id, token });
        if (!failed)
          throw new Error(`Background job lease was lost: ${message}`);
        return (await getJob(claimed.id)) ?? failed;
      }
    },
  );
}

async function processClaimedJob(job: ContextJob): Promise<{
  progress?: number;
  hasMore: boolean;
  checkpoint?: Record<string, unknown>;
  result: Record<string, unknown>;
}> {
  if (job.kind === "embed") {
    const operation = job.request.operation;
    const batch =
      operation === "rebuild-fts"
        ? await rebuildFtsBatch(job)
        : operation === "rebuild-embeddings"
          ? await rebuildVectorBatch(job)
          : null;
    if (!batch) throw new Error(`Unsupported embedding job: ${operation}`);
    return {
      progress: batch.processed,
      hasMore: batch.hasMore,
      checkpoint: batch.hasMore
        ? { afterChunkId: batch.afterChunkId }
        : undefined,
      result: { ...batch },
    };
  }
  if (job.kind === "enrich-media") {
    const mediaIds = requestedMediaIds(job);
    if (!mediaIds.length)
      throw new Error("Media enrichment job has no media ids.");
    const completed = new Set(
      Array.isArray(job.checkpoint?.completedMediaIds)
        ? job.checkpoint.completedMediaIds.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [],
    );
    const limit = Math.max(
      1,
      Math.min(100, Number(job.budget?.eagerLimit ?? 25)),
    );
    const pending = mediaIds.filter((mediaId) => !completed.has(mediaId));
    const results = [];
    for (const mediaId of pending.slice(0, limit)) {
      results.push(
        job.request.operation === "project-media"
          ? await projectCreativeContextMedia(mediaId)
          : await enrichCreativeContextMedia({ mediaId }),
      );
      completed.add(mediaId);
    }
    return {
      progress: results.length,
      hasMore: completed.size < mediaIds.length,
      checkpoint: { completedMediaIds: [...completed] },
      result: { enriched: completed.size, media: results },
    };
  }
  if (job.kind === "brand-dna") {
    if (!job.sourceId)
      throw new Error("Brand DNA inference requires a source id.");
    const result = await inferBrandDnaProposalFromCorpus({
      sourceId: job.sourceId,
      profileId: optionalText(job.request.profileId),
    });
    return { hasMore: false, result };
  }
  if (job.kind === "canonical-logo") {
    if (!job.sourceId)
      throw new Error("Canonical logo ranking requires a source id.");
    const documents = await listAccessibleSearchDocuments({
      sourceIds: [job.sourceId],
      itemIds: requestedItemIds(job),
      limit: 100,
    });
    const candidates = [
      ...new Map(
        documents.map((document) => [document.itemId, document]),
      ).values(),
    ]
      .filter(
        (document) =>
          /logo|wordmark|brandmark|logomark/i.test(document.title) ||
          /logo|vector|component|image|asset/i.test(document.kind),
      )
      .sort(
        (left, right) =>
          Number(right.curationRank === "canonical") -
            Number(left.curationRank === "canonical") ||
          Number(right.starred) - Number(left.starred) ||
          left.itemId.localeCompare(right.itemId),
      )
      .slice(0, Math.max(1, Math.min(12, Number(job.budget?.eagerLimit ?? 6))));
    const suggestions = [];
    for (const [rank, candidate] of candidates.entries()) {
      suggestions.push(
        await proposeCreativeContextSuggestion({
          kind: "canonical-logo",
          profileId: optionalText(job.request.profileId),
          itemId: candidate.itemId,
          itemVersionId: candidate.itemVersionId,
          reason: "Ranked from canonical/starred logo-like corpus evidence.",
          payload: { rank: rank + 1, sourceId: job.sourceId },
        }),
      );
    }
    return {
      progress: candidates.length,
      hasMore: false,
      result: { suggestions: suggestions.map((entry) => entry.id) },
    };
  }
  if (job.kind === "layout-suggestion") {
    if (!job.sourceId)
      throw new Error("Layout suggestion discovery requires a source id.");
    const documents = await listAccessibleSearchDocuments({
      sourceIds: [job.sourceId],
      itemIds: requestedItemIds(job),
      limit: 100,
    });
    const candidates = [
      ...new Map(
        documents.map((document) => [document.itemId, document]),
      ).values(),
    ]
      .filter(
        (document) =>
          document.priorReuseCount >= 2 ||
          document.curationRank === "canonical" ||
          document.curationRank === "exemplar",
      )
      .sort(
        (left, right) =>
          right.priorReuseCount - left.priorReuseCount ||
          left.itemId.localeCompare(right.itemId),
      )
      .slice(
        0,
        Math.max(1, Math.min(25, Number(job.budget?.eagerLimit ?? 10))),
      );
    const suggestions = [];
    for (const candidate of candidates) {
      suggestions.push(
        await proposeCreativeContextSuggestion({
          kind: "layout-template",
          profileId: optionalText(job.request.profileId),
          itemId: candidate.itemId,
          itemVersionId: candidate.itemVersionId,
          reason: "Repeatedly reused or curated layout evidence.",
          payload: {
            sourceId: job.sourceId,
            reuseCount: candidate.priorReuseCount,
          },
        }),
      );
    }
    return {
      progress: candidates.length,
      hasMore: false,
      result: { suggestions: suggestions.map((entry) => entry.id) },
    };
  }
  if (job.kind === "metadata-refresh") {
    if (!job.sourceId)
      throw new Error("Metadata refresh requires a source id.");
    const importJob = await createJob({
      sourceId: job.sourceId,
      kind: "import",
      mode: "incremental",
      dedupeKey: `metadata-refresh-import:${job.id}`,
      request: {
        mode: "metadata-refresh",
        reconcile: true,
        infer: false,
        parentJobId: job.id,
      },
      budget: {
        maxRuntimeMs: 45_000,
        remainingMode: "durable-continuation",
      },
    });
    await dispatchCreativeContextImportJob({
      jobId: importJob.id,
      ownerEmail: importJob.ownerEmail,
      orgId: importJob.orgId,
      appId: getCreativeContext().connectorContext.appId,
    });
    return {
      progress: 1,
      hasMore: false,
      result: { importJobId: importJob.id },
    };
  }
  if (job.kind === "purge") {
    if (!job.sourceId) throw new Error("Purge job requires a source id.");
    const result = await purgeContextSourceArtifacts(job.sourceId);
    return { hasMore: false, result };
  }
  throw new Error(`Unsupported creative context background job: ${job.kind}`);
}

function requestedMediaIds(job: ContextJob): string[] {
  const many = Array.isArray(job.request.mediaIds)
    ? job.request.mediaIds.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.length > 0,
      )
    : [];
  const single = optionalText(job.request.mediaId);
  return [...new Set([...many, ...(single ? [single] : [])])];
}

function requestedItemIds(job: ContextJob): string[] | undefined {
  if (!Array.isArray(job.request.itemIds)) return undefined;
  const ids = job.request.itemIds.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  return ids.length ? [...new Set(ids)] : undefined;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function localDispatcher(
  input: CreativeContextBackgroundDispatch,
): Promise<void> {
  const timer = setTimeout(
    () => {
      void processCreativeContextBackgroundJob(input).catch((error) => {
        console.error(
          `[creative-context] local background job ${input.jobId} failed:`,
          error instanceof Error ? error.message : error,
        );
      });
    },
    Math.max(0, (input.resumeAt ? Date.parse(input.resumeAt) : 0) - Date.now()),
  );
  timer.unref?.();
}
