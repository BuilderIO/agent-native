import { randomUUID } from "node:crypto";

import {
  assertInventoryComplete,
  consumeIngestionBudget,
  createIngestionBudgetState,
  createIngestionCheckpoint,
  ingestionBudgetStopReason,
  selectInventoryForHydration,
  type IngestionBudgetLimits,
} from "@agent-native/core/ingestion";

import { isContextConnectorQuotaError } from "../connectors/provider-response.js";
import { smartDefaultExternalIds } from "../connectors/smart-defaults.js";
import type { ContextJob } from "../types.js";
import { contextImportProgressReporter } from "./progress.js";
import type {
  ContextImportCheckpoint,
  ContextImportJobPersistence,
  ContextImportProgressReporter,
  RunContextImportJobOptions,
  RunContextImportJobResult,
} from "./types.js";

const DEFAULT_LIMITS = {
  runtimeMs: 40_000,
  itemBudget: 100,
  batchBudget: 20,
  batchSize: 10,
  inventoryPageSize: 100,
  maxInventoryItems: 10_000,
  leaseTtlMs: 60_000,
} as const;

export async function runContextImportJob(
  options: RunContextImportJobOptions,
): Promise<RunContextImportJobResult> {
  const now = options.now ?? Date.now;
  const limits = normalizeLimits(options.limits);
  const workerId = required(options.workerId, "workerId");
  const token = randomUUID();
  const progress = options.progress ?? contextImportProgressReporter;
  const runId = `creative-context-import:${options.jobId}`;
  let claimed: ContextJob | null = null;

  const initial = await options.persistence.getJob(options.jobId);
  validateImportJob(initial, options.source.id);
  claimed = await options.persistence.claimJobLease({
    jobId: options.jobId,
    owner: workerId,
    token,
    expiresAt: new Date(now() + limits.leaseTtlMs).toISOString(),
  });
  if (!claimed) {
    return { job: initial!, yielded: true, reason: "lease" };
  }
  let checkpoint = parseCheckpoint(claimed.checkpoint);

  await progress.start({
    id: runId,
    owner: options.source.ownerEmail,
    title: `Import ${options.source.name}`,
    step: "Inventorying source",
    metadata: { jobId: options.jobId, sourceId: options.source.id },
  });

  try {
    let budget = createIngestionBudgetState(now());
    const connector = options.connectors.get(options.source.kind);
    const sourceConfig = {
      ...options.source.config,
      ...(options.source.connectionId && !options.source.config.connectionId
        ? { connectionId: options.source.connectionId }
        : {}),
    };
    const connectorContext = {
      ...options.connectorContext,
      ownerEmail:
        options.connectorContext.ownerEmail ?? options.source.ownerEmail,
    };

    while (!checkpoint.inventoryComplete) {
      const stop = ingestionBudgetStopReason(limits, budget, now());
      if (stop) {
        const job = await yieldJob(
          options.persistence,
          claimed,
          token,
          checkpoint,
          stop,
        );
        return { job, yielded: true, reason: stop };
      }
      await renewLease(options.persistence, claimed.id, token, limits, now);
      const page = await connector.inventory(
        {
          sourceId: options.source.id,
          config: sourceConfig,
          cursor: checkpoint.cursor,
          syncCursor:
            claimed.mode === "incremental" ? options.source.syncCursor : null,
          limit: limits.inventoryPageSize,
        },
        connectorContext,
      );
      await options.persistence.upsertSourceInventory?.({
        sourceId: options.source.id,
        items: page.items,
        ...(page.complete
          ? { completedAt: new Date(now()).toISOString() }
          : {}),
      });
      checkpoint = appendInventory(checkpoint, page.items, {
        cursor: page.nextCursor,
        syncCursor:
          page.syncCursor ?? latestSourceModifiedAt(page.items) ?? undefined,
        complete: page.complete,
        maxItems: limits.maxInventoryItems,
      });
      budget = consumeIngestionBudget(budget, {
        items: page.items.length,
        batches: 1,
      });
      claimed = await requireLeasedUpdate(options.persistence, {
        jobId: claimed.id,
        leaseToken: token,
        patch: {
          status: "running",
          progressCurrent: 0,
          progressTotal: checkpoint.inventoryComplete
            ? checkpoint.inventory.length
            : null,
          checkpoint: checkpoint as unknown as Record<string, unknown>,
          error: null,
        },
      });
      await progress.update({
        id: runId,
        owner: options.source.ownerEmail,
        percent: checkpoint.inventoryComplete ? 0 : null,
        step: checkpoint.inventoryComplete
          ? `Inventory complete: ${checkpoint.inventory.length} items`
          : `Inventoried ${checkpoint.inventory.length} items`,
        metadata: {
          jobId: claimed.id,
          sourceId: options.source.id,
          itemsInventoried: checkpoint.inventory.length,
        },
      });
    }

    assertInventoryComplete(checkpoint);
    if (!checkpoint.selectionApplied) {
      if (
        connector.verifiesContainerOwner?.({
          config: sourceConfig,
          inventory: checkpoint.inventory,
        }) === true &&
        options.persistence.markSourceContainerOwnerVerified
      ) {
        await options.persistence.markSourceContainerOwnerVerified(
          options.source.id,
        );
      }
      checkpoint = applyHydrationSelection(
        checkpoint,
        claimed.request,
        options.source.config,
        options.source.kind,
        new Date(now()),
        claimed.mode === "incremental" ? options.source.syncCursor : null,
      );
      claimed = await requireLeasedUpdate(options.persistence, {
        jobId: claimed.id,
        leaseToken: token,
        patch: {
          progressCurrent: 0,
          progressTotal: checkpoint.inventory.length,
          checkpoint: checkpoint as unknown as Record<string, unknown>,
        },
      });
    }
    while (checkpoint.itemOffset < checkpoint.inventory.length) {
      const stop = ingestionBudgetStopReason(limits, budget, now());
      if (stop) {
        const job = await yieldJob(
          options.persistence,
          claimed,
          token,
          checkpoint,
          stop,
        );
        return { job, yielded: true, reason: stop };
      }
      await renewLease(options.persistence, claimed.id, token, limits, now);
      const inventoryBatch = checkpoint.inventory.slice(
        checkpoint.itemOffset,
        checkpoint.itemOffset + limits.batchSize,
      );
      const normalized = [];
      let failed = 0;
      for (const inventoryItem of inventoryBatch) {
        try {
          const result = await connector.fetch(
            {
              sourceId: options.source.id,
              config: sourceConfig,
              item: inventoryItem,
            },
            connectorContext,
          );
          normalized.push(...result.items);
        } catch (error) {
          if (isContextConnectorQuotaError(error)) throw error;
          if (options.continueOnItemError === false) throw error;
          failed++;
          checkpoint.failures.push({
            externalId: inventoryItem.externalId,
            error: errorMessage(error).slice(0, 500),
          });
          checkpoint.failures = checkpoint.failures.slice(-100);
        }
      }
      const ingested =
        normalized.length > 0
          ? await options.persistence.ingestItems({
              sourceId: options.source.id,
              items: normalized,
            })
          : {
              sourceId: options.source.id,
              received: 0,
              created: 0,
              versioned: 0,
              unchanged: 0,
              itemIds: [],
              mediaIds: [],
            };
      if (
        ingested.mediaIds.length > 0 &&
        options.persistence.enqueueMediaEnrichment
      ) {
        await options.persistence.enqueueMediaEnrichment({
          sourceId: options.source.id,
          mediaIds: ingested.mediaIds,
          eagerLimit: Math.min(
            ingested.mediaIds.length,
            finitePositive(claimed.request.eagerMediaLimit, 25),
          ),
        });
      }
      checkpoint = {
        ...checkpoint,
        phase: "fetch",
        syncHighWater: latestHighWater(
          checkpoint.syncHighWater,
          latestSourceModifiedAt(normalized),
        ),
        discoveredExternalIds: [
          ...new Set([
            ...checkpoint.discoveredExternalIds,
            ...normalized.map((item) => item.externalId),
          ]),
        ],
        itemOffset: checkpoint.itemOffset + inventoryBatch.length,
        itemsProcessed: checkpoint.itemsProcessed + inventoryBatch.length,
        itemsFailed: checkpoint.itemsFailed + failed,
        ingested: checkpoint.ingested + ingested.received,
        created: checkpoint.created + ingested.created,
        versioned: checkpoint.versioned + ingested.versioned,
        unchanged: checkpoint.unchanged + ingested.unchanged,
      };
      budget = consumeIngestionBudget(budget, {
        items: inventoryBatch.length,
        batches: 1,
      });
      claimed = await requireLeasedUpdate(options.persistence, {
        jobId: claimed.id,
        leaseToken: token,
        patch: {
          status: "running",
          progressCurrent: checkpoint.itemsProcessed,
          progressTotal: checkpoint.inventory.length,
          checkpoint: checkpoint as unknown as Record<string, unknown>,
          error: null,
        },
      });
      await progress.update({
        id: runId,
        owner: options.source.ownerEmail,
        percent: percent(
          checkpoint.itemsProcessed,
          checkpoint.inventory.length,
        ),
        step: `Imported ${checkpoint.itemsProcessed}/${checkpoint.inventory.length}`,
        metadata: progressMetadata(claimed.id, options.source.id, checkpoint),
      });
    }

    const completedAt = new Date(now()).toISOString();
    const reconciliation =
      options.persistence.reconcileSourceInventory &&
      (claimed.mode === "full" || claimed.request.reconcile === true)
        ? await options.persistence.reconcileSourceInventory({
            sourceId: options.source.id,
            presentExternalIds: checkpoint.discoveredExternalIds,
            completedAt,
          })
        : null;
    const inference =
      options.persistence.inferBrandDnaProposal &&
      (checkpoint.created + checkpoint.versioned > 0 ||
        claimed.request.infer === true)
        ? await inferBrandDnaAfterImport(options.persistence, {
            sourceId: options.source.id,
            profileId: optionalString(
              claimed.request.profileId ?? options.source.config.profileId,
            ),
          })
        : undefined;
    if (checkpoint.syncHighWater) {
      await options.persistence.updateSourceSyncCursor?.(
        options.source.id,
        checkpoint.syncHighWater,
      );
    }
    checkpoint = { ...checkpoint, phase: "completed" };
    claimed = await requireLeasedUpdate(options.persistence, {
      jobId: claimed.id,
      leaseToken: token,
      patch: {
        status: "completed",
        progressCurrent: checkpoint.itemsProcessed,
        progressTotal: checkpoint.inventory.length,
        checkpoint: checkpoint as unknown as Record<string, unknown>,
        result: {
          inventoryCount: checkpoint.inventory.length,
          inventoryDiscovered: checkpoint.inventoryTotal,
          deferredForHydrateOnDemand: checkpoint.deferred,
          deferred: checkpoint.deferred,
          syncCursor: checkpoint.syncHighWater,
          processed: checkpoint.itemsProcessed,
          failed: checkpoint.itemsFailed,
          ingested: checkpoint.ingested,
          created: checkpoint.created,
          versioned: checkpoint.versioned,
          unchanged: checkpoint.unchanged,
          failures: checkpoint.failures,
          reconciliation,
          ...(inference ? { inference } : {}),
        },
        error: null,
        completedAt,
      },
    });
    await progress.complete({
      id: runId,
      owner: options.source.ownerEmail,
      status: "succeeded",
      step: `Imported ${checkpoint.itemsProcessed} items`,
      metadata: progressMetadata(claimed.id, options.source.id, checkpoint),
    });
    await options.persistence.releaseJobLease({ jobId: claimed.id, token });
    return { job: claimed, yielded: false, reason: null };
  } catch (error) {
    if (isContextConnectorQuotaError(error)) {
      const paused = await options.persistence.updateLeasedJob({
        jobId: claimed.id,
        leaseToken: token,
        patch: {
          status: "paused",
          nextResumeAt: error.retryAt,
          checkpoint: checkpoint as unknown as Record<string, unknown>,
          result: {
            yielded: true,
            reason: "quota",
            provider: error.provider,
            retryAfterMs: error.retryAfterMs,
          },
          error: error.message,
          budget: {
            ...(claimed.budget ?? {}),
            quotaProvider: error.provider,
            quotaRetryAfterMs: error.retryAfterMs,
          },
        },
      });
      await options.persistence.releaseJobLease({ jobId: claimed.id, token });
      if (!paused) throw new Error("Context import job lease was lost.");
      await progress.update({
        id: runId,
        owner: options.source.ownerEmail,
        percent: percent(paused.progressCurrent, paused.progressTotal ?? 0),
        step: `Paused for ${error.provider} quota until ${error.retryAt}`,
        metadata: {
          jobId: paused.id,
          sourceId: options.source.id,
          nextResumeAt: error.retryAt,
        },
      });
      return { job: paused, yielded: true, reason: "quota" };
    }
    const message = errorMessage(error);
    const failed = await options.persistence.updateLeasedJob({
      jobId: claimed.id,
      leaseToken: token,
      patch: {
        status: "failed",
        error: message,
        completedAt: new Date(now()).toISOString(),
      },
    });
    await progress.complete({
      id: runId,
      owner: options.source.ownerEmail,
      status: "failed",
      step: message,
      metadata: { jobId: claimed.id, sourceId: options.source.id },
    });
    await options.persistence.releaseJobLease({ jobId: claimed.id, token });
    if (!failed) throw new Error(`Import lease was lost: ${message}`);
    return { job: failed, yielded: false, reason: null };
  }
}

async function inferBrandDnaAfterImport(
  persistence: ContextImportJobPersistence,
  input: { sourceId: string; profileId?: string },
) {
  try {
    const inferred = await persistence.inferBrandDnaProposal!(input);
    return inferred.preview
      ? { brandDnaProposal: inferred.preview, media: [] }
      : undefined;
  } catch (error) {
    console.error(
      "[creative-context] post-import brand DNA inference failed:",
      errorMessage(error),
    );
    return undefined;
  }
}

function parseCheckpoint(
  value: Record<string, unknown> | null,
): ContextImportCheckpoint {
  const base = createIngestionCheckpoint();
  if (!value)
    return {
      ...base,
      inventory: [],
      failures: [],
      ingested: 0,
      created: 0,
      versioned: 0,
      unchanged: 0,
      inventoryTotal: 0,
      selectionApplied: false,
      deferred: 0,
      hydrationReasons: {},
      discoveredExternalIds: [],
      syncHighWater: null,
    };
  const inventory = Array.isArray(value.inventory)
    ? value.inventory.filter(isInventoryItem)
    : [];
  const failures = Array.isArray(value.failures)
    ? value.failures.filter(isFailure).slice(-100)
    : [];
  return {
    phase:
      value.phase === "fetch" || value.phase === "completed"
        ? value.phase
        : "inventory",
    cursor: typeof value.cursor === "string" ? value.cursor : null,
    inventoryComplete: value.inventoryComplete === true,
    itemOffset: nonNegative(value.itemOffset),
    itemsInventoried: inventory.length,
    itemsProcessed: nonNegative(value.itemsProcessed),
    itemsFailed: nonNegative(value.itemsFailed),
    inventory,
    failures,
    ingested: nonNegative(value.ingested),
    created: nonNegative(value.created),
    versioned: nonNegative(value.versioned),
    unchanged: nonNegative(value.unchanged),
    inventoryTotal: nonNegative(value.inventoryTotal) || inventory.length,
    selectionApplied: value.selectionApplied === true,
    deferred: nonNegative(value.deferred),
    hydrationReasons: isStringRecord(value.hydrationReasons)
      ? value.hydrationReasons
      : {},
    discoveredExternalIds: stringArray(value.discoveredExternalIds),
    syncHighWater:
      typeof value.syncHighWater === "string" ? value.syncHighWater : null,
  };
}

function applyHydrationSelection(
  checkpoint: ContextImportCheckpoint,
  request: Record<string, unknown>,
  sourceConfig: Record<string, unknown>,
  sourceKind: string,
  now: Date,
  syncCursor: string | null,
): ContextImportCheckpoint {
  const discoveredInventory = checkpoint.inventory;
  const syncTimestamp = syncCursor ? Date.parse(syncCursor) : Number.NaN;
  const inventory = Number.isFinite(syncTimestamp)
    ? discoveredInventory.filter((item) => {
        if (!item.sourceModifiedAt) return true;
        const modifiedAt = Date.parse(item.sourceModifiedAt);
        return !Number.isFinite(modifiedAt) || modifiedAt > syncTimestamp;
      })
    : discoveredInventory;
  const explicitSelection = Array.isArray(request.itemExternalIds)
    ? stringArray(request.itemExternalIds)
    : undefined;
  const canonicalExternalIds = [
    ...stringArray(request.canonicalExternalIds),
    ...stringArray(sourceConfig.canonicalExternalIds),
  ];
  const pinnedExternalIds = [
    ...stringArray(request.pinnedExternalIds),
    ...stringArray(sourceConfig.pinnedExternalIds),
  ];
  const selectedExternalIds =
    explicitSelection ??
    (sourceKind === "google-slides"
      ? smartDefaultExternalIds({
          kind: sourceKind,
          items: inventory,
          canonicalExternalIds,
          pinnedExternalIds,
          now,
        })
      : undefined);
  const selection = selectInventoryForHydration(inventory, {
    selectedExternalIds,
    canonicalExternalIds,
    pinnedExternalIds,
    recentWindowMonths: finitePositive(request.recentWindowMonths, 12),
    hydrateAll: request.hydrateAll === true,
    now,
  });
  return {
    ...checkpoint,
    inventoryTotal: discoveredInventory.length,
    inventory: selection.selected,
    itemsInventoried: discoveredInventory.length,
    selectionApplied: true,
    deferred: selection.deferred.length,
    hydrationReasons: selection.reasons,
    discoveredExternalIds: discoveredInventory.map((item) => item.externalId),
  };
}

function appendInventory(
  checkpoint: ContextImportCheckpoint,
  page: ContextImportCheckpoint["inventory"],
  options: {
    cursor: string | null;
    syncCursor?: string;
    complete: boolean;
    maxItems: number;
  },
): ContextImportCheckpoint {
  const inventory = new Map(
    checkpoint.inventory.map((item) => [item.externalId, item]),
  );
  for (const item of page) inventory.set(item.externalId, item);
  if (inventory.size > options.maxItems) {
    throw new Error(
      `Context inventory exceeded the ${options.maxItems} item launch limit. Narrow the source or raise maxInventoryItems.`,
    );
  }
  const items = [...inventory.values()];
  return {
    ...checkpoint,
    phase: options.complete ? "fetch" : "inventory",
    cursor: options.cursor,
    syncHighWater: latestHighWater(
      checkpoint.syncHighWater,
      options.syncCursor,
    ),
    inventoryComplete: options.complete,
    itemsInventoried: items.length,
    inventory: items,
  };
}

function latestSourceModifiedAt(
  items: ContextImportCheckpoint["inventory"],
): string | null {
  return items.reduce<string | null>(
    (latest, item) => latestHighWater(latest, item.sourceModifiedAt),
    null,
  );
}

function latestHighWater(
  current: string | null | undefined,
  candidate: string | null | undefined,
): string | null {
  if (!candidate) return current ?? null;
  if (!current) return candidate;
  const currentTime = Date.parse(current);
  const candidateTime = Date.parse(candidate);
  if (Number.isFinite(currentTime) && Number.isFinite(candidateTime)) {
    return candidateTime > currentTime ? candidate : current;
  }
  return candidate.localeCompare(current) > 0 ? candidate : current;
}

async function yieldJob(
  persistence: ContextImportJobPersistence,
  job: ContextJob,
  token: string,
  checkpoint: ContextImportCheckpoint,
  reason: "runtime" | "items" | "batches",
): Promise<ContextJob> {
  const updated = await requireLeasedUpdate(persistence, {
    jobId: job.id,
    leaseToken: token,
    patch: {
      status: "queued",
      progressCurrent: checkpoint.itemsProcessed,
      progressTotal: checkpoint.inventoryComplete
        ? checkpoint.inventory.length
        : null,
      checkpoint: checkpoint as unknown as Record<string, unknown>,
      result: { yielded: true, reason },
      error: null,
    },
  });
  await persistence.releaseJobLease({ jobId: job.id, token });
  return updated;
}

async function renewLease(
  persistence: ContextImportJobPersistence,
  jobId: string,
  token: string,
  limits: { leaseTtlMs: number },
  now: () => number,
): Promise<void> {
  const renewed = await persistence.renewJobLease({
    jobId,
    token,
    expiresAt: new Date(now() + limits.leaseTtlMs).toISOString(),
  });
  if (!renewed) throw new Error("Context import job lease was lost.");
}

async function requireLeasedUpdate(
  persistence: ContextImportJobPersistence,
  input: Parameters<ContextImportJobPersistence["updateLeasedJob"]>[0],
): Promise<ContextJob> {
  const updated = await persistence.updateLeasedJob(input);
  if (!updated) throw new Error("Context import job lease was lost.");
  return updated;
}

function validateImportJob(
  job: ContextJob | null,
  sourceId: string,
): asserts job is ContextJob {
  if (!job) throw new Error("Context import job was not found.");
  if (job.kind !== "import")
    throw new Error(`Job ${job.id} is not an import job.`);
  if (job.sourceId !== sourceId) {
    throw new Error(`Job ${job.id} does not belong to source ${sourceId}.`);
  }
  if (job.status === "completed" || job.status === "cancelled") {
    throw new Error(`Job ${job.id} is already ${job.status}.`);
  }
}

function normalizeLimits(
  input: RunContextImportJobOptions["limits"],
): IngestionBudgetLimits & {
  batchSize: number;
  inventoryPageSize: number;
  maxInventoryItems: number;
  leaseTtlMs: number;
} {
  return {
    runtimeMs: positive(input?.runtimeMs, DEFAULT_LIMITS.runtimeMs),
    itemBudget: positive(input?.itemBudget, DEFAULT_LIMITS.itemBudget),
    batchBudget: positive(input?.batchBudget, DEFAULT_LIMITS.batchBudget),
    batchSize: positive(input?.batchSize, DEFAULT_LIMITS.batchSize),
    inventoryPageSize: positive(
      input?.inventoryPageSize,
      DEFAULT_LIMITS.inventoryPageSize,
    ),
    maxInventoryItems: positive(
      input?.maxInventoryItems,
      DEFAULT_LIMITS.maxInventoryItems,
    ),
    leaseTtlMs: positive(input?.leaseTtlMs, DEFAULT_LIMITS.leaseTtlMs),
  };
}

function progressMetadata(
  jobId: string,
  sourceId: string,
  checkpoint: ContextImportCheckpoint,
): Record<string, unknown> {
  return {
    jobId,
    sourceId,
    itemsInventoried: checkpoint.inventory.length,
    itemsProcessed: checkpoint.itemsProcessed,
    itemsFailed: checkpoint.itemsFailed,
    created: checkpoint.created,
    versioned: checkpoint.versioned,
    unchanged: checkpoint.unchanged,
  };
}

function percent(current: number, total: number): number | null {
  return total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 100;
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : fallback;
}

function nonNegative(value: unknown): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function finitePositive(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && Boolean(entry.trim()),
      )
    : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string"),
  );
}

function required(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function isInventoryItem(
  value: unknown,
): value is ContextImportCheckpoint["inventory"][number] {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { externalId?: unknown }).externalId === "string" &&
    typeof (value as { kind?: unknown }).kind === "string" &&
    typeof (value as { title?: unknown }).title === "string",
  );
}

function isFailure(
  value: unknown,
): value is { externalId: string; error: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { externalId?: unknown }).externalId === "string" &&
    typeof (value as { error?: unknown }).error === "string",
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
