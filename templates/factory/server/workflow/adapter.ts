import type { TripwireInput, TripwireSink } from "../tripwire/types.js";
import type {
  ItemEvent,
  ItemState,
  Receipt,
  ResultField,
  RunMode,
  RunStatus,
  RunTriggerKind,
  StepRecord,
  ThreadRef,
  Wake,
  WorkflowErrorCode,
  WorkflowGraph,
  WorkflowNodeOfKind,
} from "./contract.js";
import type { NormalizedItem } from "./items.js";
import type { OperationCatalog, OperationDefinition } from "./operations.js";

/**
 * The only file in this folder allowed to import from the rest of Factory.
 *
 * The workflow engine is pure logic that must stay liftable out of this
 * template. Anything it needs from the host (database access, credentials,
 * provider calls, the clock) is declared here as an interface and implemented
 * by Factory outside this folder, so a dependency on Factory shows up in one
 * file instead of in every module. `guard:workflow-engine-layering` fails when
 * any other file here reaches outside the folder.
 *
 * Today that is `WorkflowStore`, the persistence the engine runs on, plus the
 * limits and the typed failure both of its implementations share. The Drizzle
 * implementation lives in `server/workflow-host/store.ts`; the in-memory one in
 * `testing/in-memory-store.ts`. Both must pass `testing/store-conformance.ts`.
 * Below the store sits `WorkflowHost`: everything else a tick calls out to.
 *
 * Keep any Factory import in this file type-only: the engine imports
 * `WorkflowStoreError` and the limits from here at run time.
 */

/** Every call is scoped to one workflow space; nothing crosses it. */
export interface WorkflowScope {
  readonly orgId: string;
  readonly factoryId: string;
}

export type StoreClock = () => Date;

export const WORKFLOW_STORE_LIMITS = {
  /** A saved graph version, as JSON. */
  graphJsonBytes: 256 * 1024,
  /** The `fields` map on one step. */
  stepFieldsBytes: 8 * 1024,
  /** The cut-down response kept on a done receipt. */
  receiptOutputBytes: 2 * 1024,
  /** How long an item stays leased to a run that took it. */
  leaseTtlMs: 15 * 60 * 1000,
  /** The longest lease a caller may ask for. */
  leaseMaxTtlMs: 60 * 60 * 1000,
  /** Items taken or released in one call. */
  itemBatchMax: 100,
  /** Parked items returned by one resume pass. */
  dueParkedMax: 20,
  eventsBatchMax: 500,
  eventsPageMax: 500,
  runsPageMax: 100,
  workflowsPageMax: 100,
  versionsPageMax: 100,
  /** Named totals on a finished run, such as `taken` or `modelCalls`. */
  runCountKeysMax: 24,
  /** One source cursor value. */
  cursorValueBytes: 4 * 1024,
  /** How long a run request waits for its job to start before it is ignored. */
  runRequestTtlMs: 10 * 60 * 1000,
  /** Inbox items a test request may pin. */
  runRequestSampleItemsMax: 20,
  /** Expired requests one claim reports. */
  runRequestsExpiredMax: 20,
} as const;

const WORKFLOW_STORE_ERROR_CODES = [
  // A write named something that does not exist in this scope.
  "not_found",
  "already_exists",
  // A save or a dry-run record named a version that is no longer the current one.
  "stale_version",
  // Enabling needs one clean dry run of the current version.
  "dry_run_required",
  // A second `started` receipt for a key that already has one.
  "receipt_conflict",
  // A write that moves a run, a step's receipt, or a receipt the wrong way.
  "invalid_transition",
  // The caller no longer holds the lease it is writing under.
  "lease_lost",
  // The input is malformed, or too big to store whole. Never truncated.
  "invalid_record",
  // A stored value no longer parses. Never read as empty.
  "corrupt_record",
] as const;
export type WorkflowStoreErrorCode =
  (typeof WORKFLOW_STORE_ERROR_CODES)[number];

/**
 * A failure of the store itself. It is separate from `WorkflowError` because
 * those codes are recorded on a step for one item, while a store failure means
 * the run could not trust its own state and should stop loudly. The one
 * overlap is `output_over_cap`: a step or parked context that is too big is
 * thrown as a `WorkflowError` so the engine records it on the step.
 */
export class WorkflowStoreError extends Error {
  readonly code: WorkflowStoreErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: WorkflowStoreErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WorkflowStoreError";
    this.code = code;
    this.details = details;
  }
}

/** A bounded list. `hasMore` is how a cut-off list says so. */
export interface StorePage<T> {
  items: T[];
  hasMore: boolean;
}

export type WorkflowVersionSource = "save" | "agent" | "restore" | "template";

/** A workflow without its graph, so a list never carries 256 KB per row. */
export interface WorkflowSummary {
  id: string;
  /** The job the workflow is the body of; null when it is not tied to one. */
  automationId: string | null;
  name: string;
  /** The current graph version. */
  version: number;
  enabled: boolean;
  /** The newest version that had a clean dry run, if any. */
  lastCleanDryRunVersion: number | null;
  /** The last instant the Trigger fired; null before the first firing. */
  lastTriggerAt: string | null;
  createdAt: string;
  updatedAt: string;
  ownerEmail: string;
}

export interface WorkflowRecord extends WorkflowSummary {
  graph: WorkflowGraph;
}

export interface WorkflowVersionSummary {
  workflowId: string;
  version: number;
  source: WorkflowVersionSource;
  summary: string;
  createdAt: string;
  createdBy: string;
}

export interface WorkflowVersionRecord extends WorkflowVersionSummary {
  graph: WorkflowGraph;
}

export interface CreateWorkflowInput {
  /** Letters, digits, `-` and `_`, up to 64. Generated when omitted. */
  id?: string;
  automationId?: string;
  name: string;
  graph: WorkflowGraph;
  ownerEmail: string;
  source?: WorkflowVersionSource;
  summary?: string;
}

export interface SaveWorkflowGraphInput {
  workflowId: string;
  /** The version the caller edited. Anything else is `stale_version`. */
  expectedVersion: number;
  graph: WorkflowGraph;
  source: WorkflowVersionSource;
  summary: string;
  createdBy: string;
}

export interface RunCounts {
  [name: string]: number;
}

export interface RunError {
  code: WorkflowErrorCode;
  message: string;
}

export interface RunRecord {
  id: string;
  workflowId: string;
  graphVersion: number;
  mode: RunMode;
  tickKey: string;
  triggerKind: RunTriggerKind;
  /** `schedule`, or the email of whoever started the run. */
  startedBy: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  counts: RunCounts;
  error?: RunError;
  historyRowId?: string;
}

export interface StartRunInput {
  workflowId: string;
  /** Unique per workflow. A live tick uses its scheduled instant. */
  tickKey: string;
  mode: RunMode;
  /** `dry` is `dry_run`, `test` is `test`, and `live` is `schedule` or `manual`. */
  triggerKind: RunTriggerKind;
  /** `schedule` for a scheduled run, otherwise the starter's email. */
  startedBy: string;
  graphVersion: number;
  startedAt?: string;
  historyRowId?: string;
}

export interface FinishRunInput {
  runId: string;
  status: Exclude<RunStatus, "running">;
  counts?: RunCounts;
  /** Required for `failed` and `paused`, forbidden for `succeeded`. */
  error?: RunError;
  finishedAt?: string;
}

export interface ListRunsInput {
  workflowId: string;
  status?: RunStatus;
  mode?: RunMode;
  limit?: number;
}

export interface RunWithSteps {
  run: RunRecord;
  steps: StepRecord[];
}

export interface LeaseItemsInput {
  workflowId: string;
  /** Recorded only on an item with no state row yet. */
  graphVersion: number;
  itemIds: readonly string[];
  leasedBy: string;
  /** The tick's instant. A lease is live until `now + ttlMs`. */
  now: string;
  ttlMs?: number;
  /** Leave items parked at a Wait alone, so a Source cannot take them. */
  skipParked?: boolean;
}

export interface ReleaseLeasesInput {
  workflowId: string;
  itemIds: readonly string[];
  leasedBy: string;
}

export interface ParkItemInput {
  workflowId: string;
  itemId: string;
  leasedBy: string;
  graphVersion: number;
  nodeId: string;
  wake: Wake;
  /** Up to 8 KB. Over that is `output_over_cap`, never cut. */
  context: Record<string, unknown>;
  /** Replaces the item's counters when given. Use `incrementCounter` to bump. */
  counters?: Record<string, number>;
}

export interface ListDueParkedInput {
  workflowId: string;
  now: string;
  limit?: number;
}

export interface ClearParkingInput {
  workflowId: string;
  itemId: string;
  leasedBy: string;
}

export interface IncrementCounterInput {
  workflowId: string;
  itemId: string;
  counter: string;
  by?: number;
}

export interface ClearCountersInput {
  workflowId: string;
  itemId: string;
  /** The counters to take back to zero. One the item does not have is already zero. */
  counters: readonly string[];
}

export interface ListItemEventsInput {
  workflowId: string;
  itemId: string;
  limit?: number;
}

export interface SourceCursorRef {
  workflowId: string;
  nodeId: string;
}

export interface SourceCursor {
  value: string;
  updatedAt: string;
}

/**
 * A click that reached the job path: core's run-now carries no payload, so what
 * a dry run, a test, or a manual live run should do waits here until the job's
 * manual tick claims it.
 */
export interface RunRequest {
  id: string;
  workflowId: string;
  mode: RunMode;
  /** The node a `test` request runs; null for any other mode. */
  testNodeId: string | null;
  /** Inbox items a `test` request pins; empty for any other mode. */
  sampleItemIds: string[];
  requestedBy: string;
  createdAt: string;
  claimedAt: string | null;
  claimedByHistoryId: string | null;
}

export interface CreateRunRequestInput {
  workflowId: string;
  mode: RunMode;
  /** Required for `test`, forbidden otherwise. */
  testNodeId?: string;
  /** Only for `test`: up to 20. */
  sampleItemIds?: readonly string[];
  requestedBy: string;
}

interface ClaimRunRequestInput {
  workflowId: string;
  /** The scheduler's history row for the tick that is claiming. */
  historyId: string;
}

interface RunRequestClaim {
  /** The oldest request that has not expired; null when there is none. */
  claimed: RunRequest | null;
  /**
   * Requests that waited longer than `runRequestTtlMs` and were never claimed.
   * They are removed as they are reported, so each is reported once, and none
   * of them runs late.
   */
  expired: RunRequest[];
}

/**
 * What the engine needs from storage, written from what one tick does.
 *
 * Rules every method follows:
 * - It takes a `WorkflowScope` first. A workflow, run, item, or receipt in
 *   another scope behaves as if it did not exist.
 * - A read that matches nothing returns `null`. A list on a workflow that is
 *   not there throws `not_found`, so "no rows" never means "no workflow". A
 *   write to something missing throws `not_found`.
 * - A bounded list is a `StorePage`; `hasMore` is true when it was cut.
 * - Input that is too big is rejected, not cut. A value that no longer parses
 *   on the way out is `corrupt_record`, not an empty value.
 * - Instants are ISO strings and come back as UTC (`...Z`).
 * - Taking, parking, and counting are decided by one statement in the
 *   database, never by a read followed by a write.
 */
export interface WorkflowStore {
  // Workflows

  /** Saves version 1, disabled. `already_exists` for a taken id or automation. */
  createWorkflow(
    scope: WorkflowScope,
    input: CreateWorkflowInput,
  ): Promise<WorkflowRecord>;
  getWorkflow(
    scope: WorkflowScope,
    workflowId: string,
  ): Promise<WorkflowRecord | null>;
  getWorkflowByAutomation(
    scope: WorkflowScope,
    automationId: string,
  ): Promise<WorkflowRecord | null>;
  /** Newest first. */
  listWorkflows(
    scope: WorkflowScope,
    options?: { limit?: number },
  ): Promise<StorePage<WorkflowSummary>>;
  getWorkflowVersion(
    scope: WorkflowScope,
    workflowId: string,
    version: number,
  ): Promise<WorkflowVersionRecord | null>;
  /** Newest first, without graphs. */
  listWorkflowVersions(
    scope: WorkflowScope,
    workflowId: string,
    options?: { limit?: number },
  ): Promise<StorePage<WorkflowVersionSummary>>;
  /**
   * Saves a new version only when `expectedVersion` is still the current one;
   * otherwise `stale_version`. A workflow that was enabled is switched off by
   * the save, in the same write: the new version has had no dry run, so no tick
   * may find it on.
   */
  saveWorkflowGraph(
    scope: WorkflowScope,
    input: SaveWorkflowGraphInput,
  ): Promise<WorkflowRecord>;
  /**
   * Disabling always works. Enabling needs a clean dry run recorded for the
   * current version, otherwise `dry_run_required`.
   */
  setWorkflowEnabled(
    scope: WorkflowScope,
    workflowId: string,
    enabled: boolean,
  ): Promise<WorkflowSummary>;
  /** `stale_version` when `version` is not the current one. */
  recordCleanDryRun(
    scope: WorkflowScope,
    input: { workflowId: string; version: number },
  ): Promise<WorkflowSummary>;
  /** Keeps the latest instant if called out of order. */
  recordTriggerRun(
    scope: WorkflowScope,
    input: { workflowId: string; at: string },
  ): Promise<void>;
  /**
   * Hard delete: the workflow and everything under it, including its runs,
   * parked items, and cursors. False when there was nothing to delete.
   */
  deleteWorkflow(scope: WorkflowScope, workflowId: string): Promise<boolean>;

  // Runs and steps

  /**
   * One run per `(workflowId, tickKey)`, decided by the database's unique
   * constraint. `created: false` returns the run that already holds the key,
   * whatever state it is in.
   */
  startRun(
    scope: WorkflowScope,
    input: StartRunInput,
  ): Promise<{ created: boolean; run: RunRecord }>;
  /** Only a `running` run can finish; a second finish is `invalid_transition`. */
  finishRun(scope: WorkflowScope, input: FinishRunInput): Promise<RunRecord>;
  /** Newest first. */
  listRuns(
    scope: WorkflowScope,
    input: ListRunsInput,
  ): Promise<StorePage<RunRecord>>;
  getRun(scope: WorkflowScope, runId: string): Promise<RunWithSteps | null>;
  /**
   * Creates or replaces the step for `(runId, nodeId)`. Port item-id lists
   * over the step cap, or `fields` over 8 KB, throw `output_over_cap`.
   */
  putStep(scope: WorkflowScope, step: StepRecord): Promise<void>;

  // Item state, leases, and parking

  getItemState(
    scope: WorkflowScope,
    workflowId: string,
    itemId: string,
  ): Promise<ItemState | null>;
  /**
   * Takes each item that has no live lease and returns exactly the ones won,
   * in the order asked. An item with no state row gets one. An expired lease is
   * free again.
   */
  leaseItems(
    scope: WorkflowScope,
    input: LeaseItemsInput,
  ): Promise<ItemState[]>;
  /** Releases only leases held by `leasedBy`. Returns how many it released. */
  releaseLeases(
    scope: WorkflowScope,
    input: ReleaseLeasesInput,
  ): Promise<number>;
  /**
   * Parks a leased item at a Wait and ends its lease. `lease_lost` when
   * another run holds it; `not_found` when it has no state row.
   */
  parkItem(scope: WorkflowScope, input: ParkItemInput): Promise<ItemState>;
  /**
   * Parked items whose `wake.dueAt` or `wake.nextCheckAt` has passed and that
   * nobody holds, earliest first. Up to 20.
   */
  listDueParked(
    scope: WorkflowScope,
    input: ListDueParkedInput,
  ): Promise<ItemState[]>;
  /**
   * The item ended: removes its parking and context and ends its lease. Keeps
   * its counters. Call it when the item is done, not when it wakes, so a run
   * that stops partway finds the row again.
   */
  clearParking(
    scope: WorkflowScope,
    input: ClearParkingInput,
  ): Promise<ItemState>;
  /** Adds `by` (default 1) and returns the new value. `not_found` with no row. */
  incrementCounter(
    scope: WorkflowScope,
    input: IncrementCounterInput,
  ): Promise<number>;
  /** Takes the named counters back to zero, leaving the others. `not_found` with no row. */
  clearCounters(scope: WorkflowScope, input: ClearCountersInput): Promise<void>;

  // Item events

  appendItemEvent(scope: WorkflowScope, event: ItemEvent): Promise<void>;
  appendItemEvents(
    scope: WorkflowScope,
    events: readonly ItemEvent[],
  ): Promise<void>;
  /** Oldest first. */
  listItemEvents(
    scope: WorkflowScope,
    input: ListItemEventsInput,
  ): Promise<StorePage<ItemEvent>>;

  // Receipts

  getReceipt(scope: WorkflowScope, key: string): Promise<Receipt | null>;
  /**
   * `started` creates the receipt, and a second `started` for the same key
   * throws `receipt_conflict` so the caller can tell a crashed attempt. `done`
   * and `failed` close a `started` receipt; anything else is
   * `invalid_transition`.
   */
  putReceipt(
    scope: WorkflowScope,
    workflowId: string,
    receipt: Receipt,
  ): Promise<void>;

  // Source cursors

  getSourceCursor(
    scope: WorkflowScope,
    ref: SourceCursorRef,
  ): Promise<SourceCursor | null>;
  setSourceCursor(
    scope: WorkflowScope,
    input: SourceCursorRef & { value: string; ownerEmail: string },
  ): Promise<void>;

  // Run requests

  /** `not_found` when the workflow is not in this scope. */
  createRunRequest(
    scope: WorkflowScope,
    input: CreateRunRequestInput,
  ): Promise<RunRequest>;
  getRunRequest(
    scope: WorkflowScope,
    requestId: string,
  ): Promise<RunRequest | null>;
  /**
   * Hands the oldest unexpired, unclaimed request to the tick that asks, in one
   * statement, so two ticks never get the same one and a tick that loses a race
   * takes the next. Also reports the requests that expired unclaimed.
   */
  claimRunRequest(
    scope: WorkflowScope,
    input: ClaimRunRequestInput,
  ): Promise<RunRequestClaim>;
  /** Removes a request no tick has claimed. False when one has, or it was never there. */
  cancelRunRequest(scope: WorkflowScope, requestId: string): Promise<boolean>;
}

// The host: what a tick calls besides the store.
//
// Every interface below returns a discriminated result for a failure the
// caller should expect (a provider error, a model that did not answer). A
// throw means a bug or a dead dependency: the engine does not catch it, so the
// run stops loudly instead of recording a plausible-looking failure.

/** What a failed write may already have done outside. `maybe` is what a timeout returns. */
export type SideEffect = "none" | "maybe" | "done";

export interface OperationRequest {
  readonly operation: OperationDefinition;
  /** Resolved values with defaults filled. A source's window and cursor params are already in. */
  readonly fields: Readonly<Record<string, unknown>>;
  /** The provider id whose credential this call runs under. */
  readonly credentialSlot: string;
  /** Set only on a live write: the key to read back whether it already ran. */
  readonly receiptKey?: string;
  readonly mode: RunMode;
  readonly signal: AbortSignal;
  /** Sources only: the most items the engine will take. */
  readonly limit?: number;
}

export type OperationResult =
  | {
      ok: true;
      /** Bounded JSON. The engine fails the step instead of cutting it. */
      output: unknown;
      /** Sources only: already normalized. The cursor must cover exactly these. */
      items?: readonly NormalizedItem[];
      /** Sources only: how many the provider had, when more than `items`. */
      totalAvailable?: number;
      cursor?: string;
      externalRef?: string;
      url?: string;
    }
  | {
      ok: false;
      code: WorkflowErrorCode;
      message: string;
      retryable: boolean;
      sideEffect: SideEffect;
    };

export interface OperationExecutor {
  execute(request: OperationRequest): Promise<OperationResult>;
}

type SourceNodeSettings = WorkflowNodeOfKind<"source">["settings"];

/** The two sources that read Factory's own inbox instead of calling a provider. */
export interface InboxRequest {
  readonly settings: Extract<
    SourceNodeSettings,
    { source: "inbox-poll" | "status" }
  >;
  readonly mode: RunMode;
  readonly signal: AbortSignal;
}

export type InboxResult =
  | {
      ok: true;
      items: readonly NormalizedItem[];
      totalAvailable?: number;
    }
  | {
      ok: false;
      code: WorkflowErrorCode;
      message: string;
      retryable: boolean;
    };

/**
 * What a provider-query source asks for beside what its provider offers: the
 * rows its operation brought in that this workflow already took.
 */
export interface RequeuedRequest {
  /** The source's operation; the rows it brought in carry its id. */
  readonly operationId: string;
  /** The most rows to hand back. */
  readonly limit: number;
  readonly mode: RunMode;
  readonly signal: AbortSignal;
}

export interface InboxReader {
  take(request: InboxRequest): Promise<InboxResult>;
  /**
   * The rows `operationId` brought in that this workflow took before and that
   * are back in their queue status with nothing holding them: put back by a
   * person, or left open by a run that died. A provider that has moved past
   * them (a cursor) never offers them again, so the source asks here. Newest
   * first, bounded by `limit`. A read that cannot be completed is a failure,
   * never an empty list.
   */
  takeRequeued(request: RequeuedRequest): Promise<InboxResult>;
}

/** Moves an inbox item to a new status. Never called outside a live run. */
export interface ItemStatusWriter {
  setStatus(request: {
    workflowId: string;
    runId: string;
    itemId: string;
    status: string;
    reason?: string;
    /**
     * Values an End node records, written onto the item's extras in the same
     * write as the status. A write over the cap is refused, never cut.
     */
    extras?: Readonly<Record<string, unknown>>;
    signal: AbortSignal;
  }): Promise<
    | { ok: true }
    | {
        ok: false;
        code: WorkflowErrorCode;
        message: string;
        retryable: boolean;
      }
  >;
}

/**
 * Where a row stood when its item was offered. `terminal` is a row already
 * handled: `resolved`, `dismissed` or `needs_manual`. A row a person or a
 * release put back in its queue is `open`, so it can be taken again.
 */
export type ItemRowState = "created" | "open" | "terminal";

export type ItemUpsertResult =
  | {
      ok: true;
      inserted: number;
      updated: number;
      unchanged: number;
      /** Rows a person or a poll changed meanwhile; left as they are. */
      skipped: number;
      /** One per item given, in the order given. */
      states: readonly { id: string; state: ItemRowState }[];
    }
  | {
      ok: false;
      code: WorkflowErrorCode;
      message: string;
      retryable: boolean;
    };

/**
 * What the engine needs to give the items a provider source brought in a row
 * in Factory's inbox, so an End has something to move, and to learn which of
 * them were already handled. Idempotent on the item id, all or nothing. A row
 * whose status cannot be read is a failure, never a new item.
 */
export interface ItemWriter extends ItemStatusWriter {
  upsertItems(request: {
    items: readonly NormalizedItem[];
    /** Reads each row's state and writes nothing: what a dry or test run asks. */
    dryRun?: boolean;
  }): Promise<ItemUpsertResult>;
}

export type AiFailureCode =
  | "no_result"
  | "result_invalid"
  | "timeout"
  | "budget"
  | "credentials"
  | "engine_error";

export interface AiUsage {
  modelCalls: number;
  inputTokens?: number;
  outputTokens?: number;
}

/** What the model sees of one item: its own fields and what earlier nodes added. */
export interface AiTurnItem {
  id: string;
  item: Readonly<Record<string, unknown>>;
  nodes: Readonly<Record<string, unknown>>;
}

/** The model calls one run may still make. The runner takes one before every call, repairs included. */
export interface RunBudget {
  remainingModelCalls(): number;
  /** False, and takes nothing, when none is left. */
  takeModelCall(): boolean;
}

export interface AiTurnRequest {
  readonly instruction: string;
  readonly items: readonly AiTurnItem[];
  /** `perItem` answers each item; `wholeList` answers once for all of them. */
  readonly mode: "perItem" | "wholeList";
  readonly resultSchemaFields: Readonly<Record<string, ResultField>>;
  /** Ids of read operations the model may call while it answers. The engine has checked each reads; empty for none. */
  readonly tools: readonly string[];
  /** How many times a bad answer may be shown back to the model. */
  readonly maxRepairs: number;
  readonly budget: RunBudget;
  readonly inputBudgetTokens?: number;
  readonly signal: AbortSignal;
  /** The run the turn belongs to, and the node it runs for when the caller names it; both go on the tripwire events the turn records. */
  readonly runId: string;
  readonly nodeId?: string;
}

export type AiItemOutcome =
  | { itemId: string; ok: true; fields: Record<string, unknown> }
  | { itemId: string; ok: false; code: AiFailureCode; reason: string };

/**
 * Things the turn did not manage to save around its answer. The answer stands;
 * these are recorded on the step so the audit can say the thread link or the
 * usage count is missing rather than showing a clean turn.
 */
interface AiTurnSaveFailures {
  /** The reasoning thread could not be stored, so `threadId` is absent or stale. */
  threadPersistError?: string;
  /** Usage could not be recorded, so the run's model-call cost is undercounted. */
  usageRecordError?: string;
}

export type AiTurnResult =
  | ({
      ok: true;
      mode: "perItem";
      /** One per input item, answered or not. The engine fails any it is missing. */
      results: readonly AiItemOutcome[];
      usage: AiUsage;
      threadId?: string;
      inputTruncated?: boolean;
    } & AiTurnSaveFailures)
  | ({
      ok: true;
      mode: "wholeList";
      fields: Record<string, unknown>;
      usage: AiUsage;
      threadId?: string;
      inputTruncated?: boolean;
    } & AiTurnSaveFailures)
  | ({
      ok: false;
      code: AiFailureCode;
      reason: string;
      usage: AiUsage;
      threadId?: string;
    } & AiTurnSaveFailures);

export interface AiTurnRunner {
  run(request: AiTurnRequest): Promise<AiTurnResult>;
}

/** Who may answer a reply Wait. `owner` is the person the thread is with, or the workflow's owner when it is a channel. */
type ReplyAcceptance =
  | "anyone"
  | "owner"
  | { readonly emails: readonly string[] };

export interface ThreadReplyRequest {
  /** What to read: a Slack thread, a pull request, or a ticket. The host picks the provider from which fields are set. */
  readonly thread: ThreadRef;
  /**
   * Only messages after this instant count. Slack gives a reaction no time, so
   * a reaction counts when it sits on the thread's messages at or after it.
   */
  readonly since: string;
  readonly acceptFrom: ReplyAcceptance;
  /** The reaction that also answers, from the same people. */
  readonly ackReaction: string;
  /** The workflow owner's email: what `acceptFrom: "owner"` falls back to. */
  readonly ownerEmail: string;
  readonly signal: AbortSignal;
}

export interface ThreadReply {
  id: string;
  /** When it was posted; for a reaction, when the host saw it. */
  at: string;
  kind: "message" | "reaction";
  author?: string;
  /** Bounded by the host. */
  text?: string;
  url?: string;
}

/**
 * `replies` is already filtered: humans in `acceptFrom`, after `since`. An
 * empty list means the whole thread was read and nobody answered. A thread the
 * host could not read in full (a page it never reached, a missing scope) is
 * `ok: false`, never a short list, because "no answer yet" would time the item
 * out on a read that failed.
 */
export type ThreadReplyResult =
  | { ok: true; replies: readonly ThreadReply[] }
  | {
      ok: false;
      code: WorkflowErrorCode;
      message: string;
      retryable: boolean;
    };

export interface ThreadReader {
  readReplies(request: ThreadReplyRequest): Promise<ThreadReplyResult>;
}

export interface Clock {
  now(): Date;
  /** Backoff goes through here so a test never waits. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface IdSource {
  next(kind: string): string;
}

/** The soft deadline: true once the run should take no more work. */
type ShouldStop = () => boolean;

/**
 * What the engine records when something at a risky boundary is not what was
 * expected: `host.tripwire?.({ area, code, severity, ... })`. Observe only: it
 * returns nothing, never throws, and the engine's behavior never depends on
 * it. The host binds the factory, so an event carries no scope. Types live in
 * `server/tripwire/types.ts`, which imports nothing.
 */
export type { TripwireInput, TripwireSink };

export interface WorkflowHost {
  readonly store: WorkflowStore;
  /** The operations a graph may name; the engine re-validates against it each run. */
  readonly catalog: OperationCatalog;
  readonly operations: OperationExecutor;
  readonly inbox: InboxReader;
  readonly items: ItemWriter;
  readonly ai: AiTurnRunner;
  /** What a reply Wait reads. */
  readonly threads: ThreadReader;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly shouldStop: ShouldStop;
  /**
   * The longest the scheduler lets one tick run before it abandons it, in ms.
   * A run still open well past it is a tick that died. Absent: the lease
   * lifetime stands in.
   */
  readonly runTimeoutMs?: number;
  /** Absent in the in-memory host of a spec that does not look at tripwires. */
  readonly tripwire?: TripwireSink;
}
