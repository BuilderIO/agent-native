import type {
  IngestionBudgetLimits,
  IngestionCheckpoint,
} from "@agent-native/core/ingestion";

import type { ContextImportConnectorRegistry } from "../connectors/registry.js";
import type {
  ContextConnectorExecutionContext,
  ContextConnectorInventoryItem,
} from "../connectors/types.js";
import type {
  ContextIngestBatch,
  ContextIngestResult,
  ContextImportInferenceResult,
  ContextJob,
  ContextSource,
} from "../types.js";

export interface ContextImportCheckpoint extends IngestionCheckpoint {
  inventory: ContextConnectorInventoryItem[];
  failures: Array<{ externalId: string; error: string }>;
  ingested: number;
  created: number;
  versioned: number;
  unchanged: number;
  inventoryTotal: number;
  selectionApplied: boolean;
  deferred: number;
  hydrationReasons: Record<string, string>;
  discoveredExternalIds: string[];
  syncHighWater: string | null;
}

export interface ContextImportJobPatch {
  status?: ContextJob["status"];
  progressCurrent?: number;
  progressTotal?: number | null;
  checkpoint?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  nextResumeAt?: string | null;
  budget?: Record<string, unknown> | null;
}

export interface ContextImportJobPersistence {
  getJob(jobId: string): Promise<ContextJob | null>;
  claimJobLease(input: {
    jobId: string;
    owner: string;
    token: string;
    expiresAt: string;
  }): Promise<ContextJob | null>;
  renewJobLease(input: {
    jobId: string;
    token: string;
    expiresAt: string;
  }): Promise<boolean>;
  releaseJobLease(input: { jobId: string; token: string }): Promise<boolean>;
  updateLeasedJob(input: {
    jobId: string;
    leaseToken: string;
    patch: ContextImportJobPatch;
  }): Promise<ContextJob | null>;
  upsertSourceInventory?(input: {
    sourceId: string;
    items: ContextConnectorInventoryItem[];
    completedAt?: string;
  }): Promise<{
    sourceId: string;
    received: number;
    created: number;
    updated: number;
    itemIds: string[];
  }>;
  ingestItems(batch: ContextIngestBatch): Promise<ContextIngestResult>;
  reconcileSourceInventory?(input: {
    sourceId: string;
    presentExternalIds: string[];
    completedAt?: string;
  }): Promise<{ removed: number; restored: number }>;
  markSourceContainerOwnerVerified?(sourceId: string): Promise<void>;
  updateSourceSyncCursor?(sourceId: string, syncCursor: string): Promise<void>;
  inferBrandDnaProposal?(input: {
    sourceId: string;
    profileId?: string;
  }): Promise<{
    preview?: ContextImportInferenceResult["brandDnaProposal"];
    reason?: string;
  }>;
  enqueueMediaEnrichment?(input: {
    sourceId: string;
    mediaIds: string[];
    eagerLimit: number;
  }): Promise<{ jobId: string }>;
}

export interface ContextImportProgressReporter {
  start(input: {
    id: string;
    owner: string;
    title: string;
    step: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  update(input: {
    id: string;
    owner: string;
    percent: number | null;
    step: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  complete(input: {
    id: string;
    owner: string;
    status: "succeeded" | "failed" | "cancelled";
    step: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
}

export interface RunContextImportJobOptions {
  jobId: string;
  source: ContextSource;
  workerId: string;
  persistence: ContextImportJobPersistence;
  connectors: ContextImportConnectorRegistry;
  connectorContext: ContextConnectorExecutionContext;
  progress?: ContextImportProgressReporter;
  limits?: Partial<
    IngestionBudgetLimits & {
      batchSize: number;
      inventoryPageSize: number;
      maxInventoryItems: number;
      leaseTtlMs: number;
    }
  >;
  continueOnItemError?: boolean;
  now?: () => number;
}

export interface RunContextImportJobResult {
  job: ContextJob;
  yielded: boolean;
  reason: "runtime" | "items" | "batches" | "quota" | "lease" | null;
}
