import { and, eq, inArray } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

import { triageItems } from "../db/schema.js";
import {
  WORKFLOW_STORE_LIMITS,
  type RunRequest,
  type WorkflowScope,
  type WorkflowStore,
} from "../workflow/adapter.js";
import type { RunMode, RunTriggerKind } from "../workflow/contract.js";
import type { SampleItem } from "../workflow/engine/index.js";
import { rowToNormalizedItem } from "./inbox.js";

/**
 * A failure the job runner reports to the scheduler. Core reads `errorCode` off
 * whatever a runner throws, records it as the run's code, and counts it toward
 * pausing the job, so a code here is what the owner sees.
 */
export class WorkflowRunFailure extends Error {
  readonly errorCode: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;

  constructor(
    errorCode: string,
    message: string,
    details?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super(message);
    this.cause = cause;
    this.name = "WorkflowRunFailure";
    this.errorCode = errorCode;
    this.details = details;
  }
}

const TRIGGER_KIND_OF_MODE: Readonly<Record<RunMode, RunTriggerKind>> = {
  live: "manual",
  dry: "dry_run",
  test: "test",
};

/** What a manual tick has been asked to do. */
type ManualRun =
  | {
      kind: "request";
      request: RunRequest;
      mode: RunMode;
      triggerKind: RunTriggerKind;
      /** Whoever clicked. */
      startedBy: string;
      testNodeId?: string;
      sampleItems: SampleItem[];
    }
  /** A manual tick nobody made a request for: a plain "Run now" on the live workflow. */
  | { kind: "plain" };

export type SampleItemLoader = (
  scope: WorkflowScope,
  itemIds: readonly string[],
) => Promise<SampleItem[]>;

/** Reads the inbox items a test request pinned; one that is missing or unreadable fails the run. */
export function createSampleItemLoader(
  getDatabase: () => PgDatabase<any, any>,
): SampleItemLoader {
  return async (scope, itemIds) => {
    if (itemIds.length === 0) return [];
    const rows = await getDatabase()
      .select()
      .from(triageItems)
      .where(
        and(
          inArray(triageItems.id, [...itemIds]),
          eq(triageItems.orgId, scope.orgId),
          eq(triageItems.factoryId, scope.factoryId),
        ),
      );
    const byId = new Map(rows.map((row) => [row.id, row]));
    return itemIds.map((id): SampleItem => {
      const row = byId.get(id);
      if (!row) {
        throw new WorkflowRunFailure(
          "sample_item_not_found",
          `The sample item "${id}" is not in this factory's inbox.`,
          { itemId: id },
        );
      }
      try {
        return { id, item: { ...rowToNormalizedItem(row) } };
      } catch (error) {
        throw new WorkflowRunFailure(
          "sample_item_unreadable",
          `The sample item "${id}" cannot be read: ${error instanceof Error ? error.message : String(error)}`,
          { itemId: id },
        );
      }
    });
  };
}

interface ResolveManualRunInput {
  store: Pick<WorkflowStore, "claimRunRequest">;
  scope: WorkflowScope;
  workflowId: string;
  /** The scheduler's history row for this tick. */
  historyId: string;
  loadSampleItems: SampleItemLoader;
  log?: (message: string) => void;
}

/**
 * Finds what this manual tick was started for. A click leaves a request, and
 * the tick takes the oldest one still fresh. Requests that waited too long are
 * logged and never run.
 *
 * A tick that finds no request but did see one expire is not a plain "Run now":
 * it is most likely that request's own job, started late, and running it live
 * would run a workflow its owner only asked to try out.
 */
export async function resolveManualRun(
  input: ResolveManualRunInput,
): Promise<ManualRun> {
  const log = input.log ?? ((message) => console.warn(message));
  const claim = await input.store.claimRunRequest(input.scope, {
    workflowId: input.workflowId,
    historyId: input.historyId,
  });
  for (const expired of claim.expired) {
    log(
      `[workflow-run-request] run_request_expired: ${expired.mode} request ${expired.id} by ${expired.requestedBy} for workflow ${expired.workflowId} waited more than ${WORKFLOW_STORE_LIMITS.runRequestTtlMs / 60_000} minutes for its job to start, so it was not run.`,
    );
  }
  const request = claim.claimed;
  if (!request) {
    if (claim.expired.length > 0) {
      throw new WorkflowRunFailure(
        "run_request_expired",
        `The ${claim.expired[0]?.mode} run requested by ${claim.expired[0]?.requestedBy} waited more than ${WORKFLOW_STORE_LIMITS.runRequestTtlMs / 60_000} minutes for the scheduler to start it, so it was not run. Start it again.`,
        { requestIds: claim.expired.map((expired) => expired.id) },
      );
    }
    return { kind: "plain" };
  }
  return {
    kind: "request",
    request,
    mode: request.mode,
    triggerKind: TRIGGER_KIND_OF_MODE[request.mode],
    startedBy: request.requestedBy,
    ...(request.testNodeId === null ? {} : { testNodeId: request.testNodeId }),
    sampleItems: await input.loadSampleItems(
      input.scope,
      request.sampleItemIds,
    ),
  };
}
