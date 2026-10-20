import {
  WORKFLOW_STORE_LIMITS,
  WorkflowStoreError,
  type ClearParkingInput,
  type CreateWorkflowInput,
  type FinishRunInput,
  type ClearCountersInput,
  type IncrementCounterInput,
  type LeaseItemsInput,
  type ListDueParkedInput,
  type ListItemEventsInput,
  type ListRunsInput,
  type ParkItemInput,
  type ReleaseLeasesInput,
  type RunRecord,
  type RunRequest,
  type RunWithSteps,
  type SaveWorkflowGraphInput,
  type SourceCursor,
  type SourceCursorRef,
  type StartRunInput,
  type StoreClock,
  type StorePage,
  type WorkflowRecord,
  type WorkflowScope,
  type WorkflowStore,
  type WorkflowSummary,
  type WorkflowVersionRecord,
  type WorkflowVersionSource,
  type WorkflowVersionSummary,
} from "../adapter.js";
import type {
  ItemEvent,
  ItemState,
  Receipt,
  StepRecord,
  Wake,
  WorkflowGraph,
} from "../contract.js";
import {
  assembleItemState,
  assertCounterIncrement,
  assertCounterNames,
  assertCursorRef,
  assertEmail,
  assertId,
  assertScope,
  assertVersion,
  normalizeInstant,
  prepareCreateWorkflow,
  prepareCursorValue,
  prepareEvent,
  prepareFinishRun,
  prepareGraph,
  prepareLeaseItems,
  preparePark,
  prepareReceipt,
  prepareRunRequest,
  prepareSaveWorkflowGraph,
  prepareStartRun,
  prepareStep,
  receiptTransitionError,
  resolveLimit,
  uniqueItemIds,
  alreadyExists,
  invalidRecord,
} from "../store-rules.js";

interface InMemoryStoreOptions {
  /**
   * Bookkeeping time for `createdAt` and `updatedAt`. The default starts at
   * 2026-01-01 and moves one millisecond per read, so ordering is the same on
   * every run. Tick-time inputs (`now`, `startedAt`) come from the caller.
   */
  clock?: StoreClock;
  newId?: (kind: "workflow" | "run") => string;
  /**
   * The rows to run on. Two stores made over the same state are two processes
   * over one database: what the first wrote, the second reads. Omitted, the
   * store gets state of its own.
   */
  state?: InMemoryStoreState;
}

interface ScopedRow {
  orgId: string;
  factoryId: string;
}

interface WorkflowRow extends ScopedRow {
  id: string;
  automationId: string | null;
  name: string;
  version: number;
  enabled: boolean;
  lastCleanDryRunVersion: number | null;
  lastTriggerAt: string | null;
  createdAt: string;
  updatedAt: string;
  ownerEmail: string;
}

interface VersionRow extends ScopedRow {
  workflowId: string;
  version: number;
  graph: WorkflowGraph;
  source: WorkflowVersionSource;
  summary: string;
  createdAt: string;
  createdBy: string;
}

interface RunRow extends ScopedRow {
  seq: number;
  run: RunRecord;
}

interface StepRow extends ScopedRow {
  step: StepRecord;
}

interface ItemRow extends ScopedRow {
  workflowId: string;
  itemId: string;
  graphVersion: number;
  parkedAtNode: string | null;
  wake: Wake | null;
  dueAt: string | null;
  nextCheckAt: string | null;
  context: Record<string, unknown>;
  counters: Record<string, number>;
  leasedBy: string | null;
  leaseUntil: string | null;
  updatedAt: string;
}

interface EventRow extends ScopedRow {
  seq: number;
  event: ItemEvent;
}

interface ReceiptRow extends ScopedRow {
  workflowId: string;
  receipt: Receipt;
}

interface CursorRow extends ScopedRow {
  value: string;
  updatedAt: string;
}

interface RunRequestRow extends ScopedRow {
  request: RunRequest;
}

const SEP = "\u0000";

function sameScope(row: ScopedRow, scope: WorkflowScope): boolean {
  return row.orgId === scope.orgId && row.factoryId === scope.factoryId;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function takeWindow<T>(rows: T[], limit: number): StorePage<T> {
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

/** The rows behind an in-memory store; hand one to two stores to model a restart. */
export interface InMemoryStoreState {
  tick: number;
  sequence: { workflow: number; run: number; row: number; request: number };
  workflows: Map<string, WorkflowRow>;
  versions: Map<string, VersionRow[]>;
  runs: Map<string, RunRow>;
  tickKeys: Map<string, string>;
  steps: Map<string, StepRow>;
  itemStates: Map<string, ItemRow>;
  events: EventRow[];
  receipts: Map<string, ReceiptRow>;
  cursors: Map<string, CursorRow>;
  runRequests: Map<string, RunRequestRow>;
}

export function createInMemoryStoreState(): InMemoryStoreState {
  return {
    tick: 0,
    sequence: { workflow: 0, run: 0, row: 0, request: 0 },
    workflows: new Map(),
    versions: new Map(),
    runs: new Map(),
    tickKeys: new Map(),
    steps: new Map(),
    itemStates: new Map(),
    events: [],
    receipts: new Map(),
    cursors: new Map(),
    runRequests: new Map(),
  };
}

/**
 * The whole `WorkflowStore` in memory, for engine tests. It applies the same
 * rules as the database store (`store-rules.ts`) and passes the same
 * conformance suite. State is held and returned as copies, so a caller cannot
 * change what is stored by changing what it was given or got back.
 */
export function createInMemoryWorkflowStore(
  options: InMemoryStoreOptions = {},
): WorkflowStore {
  const state = options.state ?? createInMemoryStoreState();
  const {
    sequence,
    workflows,
    versions,
    runs,
    tickKeys,
    steps,
    itemStates,
    events,
    receipts,
    cursors,
    runRequests,
  } = state;
  const clock: StoreClock =
    options.clock ?? (() => new Date(Date.UTC(2026, 0, 1) + state.tick++));
  const newId =
    options.newId ??
    ((kind: "workflow" | "run") => `${kind}-${(sequence[kind] += 1)}`);
  const nowIso = () => clock().toISOString();

  function requireWorkflow(
    scope: WorkflowScope,
    workflowId: string,
  ): WorkflowRow {
    const row = workflows.get(assertId(workflowId, "workflow id"));
    if (!row || !sameScope(row, scope)) {
      throw new WorkflowStoreError(
        "not_found",
        `Workflow "${workflowId}" was not found.`,
        { workflowId },
      );
    }
    return row;
  }

  function assertKnownVersion(workflow: WorkflowRow, graphVersion: number) {
    if (graphVersion > workflow.version) {
      throw invalidRecord(
        `Version ${graphVersion} does not exist; the workflow is at ${workflow.version}.`,
        { graphVersion, currentVersion: workflow.version },
      );
    }
  }

  function currentGraph(row: WorkflowRow): WorkflowGraph {
    const version = versions
      .get(row.id)
      ?.find((candidate) => candidate.version === row.version);
    if (!version) {
      throw new WorkflowStoreError(
        "corrupt_record",
        `Workflow "${row.id}" has no row for its current version ${row.version}.`,
      );
    }
    return structuredClone(version.graph);
  }

  function summaryOf(row: WorkflowRow): WorkflowSummary {
    return {
      id: row.id,
      automationId: row.automationId,
      name: row.name,
      version: row.version,
      enabled: row.enabled,
      lastCleanDryRunVersion: row.lastCleanDryRunVersion,
      lastTriggerAt: row.lastTriggerAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ownerEmail: row.ownerEmail,
    };
  }

  function recordOf(row: WorkflowRow): WorkflowRecord {
    return { ...summaryOf(row), graph: currentGraph(row) };
  }

  function itemStateOf(row: ItemRow): ItemState {
    return assembleItemState({
      workflowId: row.workflowId,
      graphVersion: row.graphVersion,
      itemId: row.itemId,
      parkedAtNode: row.parkedAtNode,
      wake: row.wake === null ? null : structuredClone(row.wake),
      context: structuredClone(row.context),
      counters: { ...row.counters },
      leasedBy: row.leasedBy,
      leaseUntil: row.leaseUntil,
      updatedAt: row.updatedAt,
    });
  }

  function itemKey(workflowId: string, itemId: string): string {
    return `${workflowId}${SEP}${itemId}`;
  }

  function ownItem(
    scope: WorkflowScope,
    workflowId: string,
    itemId: string,
  ): ItemRow | undefined {
    const row = itemStates.get(itemKey(workflowId, itemId));
    return row && sameScope(row, scope) ? row : undefined;
  }

  function heldItem(
    scope: WorkflowScope,
    workflowId: string,
    itemId: string,
    leasedBy: string,
  ): ItemRow {
    const row = ownItem(scope, workflowId, itemId);
    if (!row) {
      throw new WorkflowStoreError(
        "not_found",
        `Item "${itemId}" has no state in workflow "${workflowId}".`,
        { workflowId, itemId },
      );
    }
    if (row.leasedBy !== leasedBy) {
      throw new WorkflowStoreError(
        "lease_lost",
        `Item "${itemId}" is not leased to "${leasedBy}".`,
        { workflowId, itemId, leasedBy, heldBy: row.leasedBy },
      );
    }
    return row;
  }

  const store: WorkflowStore = {
    async createWorkflow(scope, input: CreateWorkflowInput) {
      assertScope(scope);
      const meta = prepareCreateWorkflow(input);
      const { graph } = prepareGraph(input.graph);
      const id = meta.id ?? newId("workflow");
      if (workflows.has(id)) {
        throw alreadyExists(id, meta.automationId);
      }
      if (
        meta.automationId !== null &&
        [...workflows.values()].some(
          (row) =>
            sameScope(row, scope) && row.automationId === meta.automationId,
        )
      ) {
        throw alreadyExists(id, meta.automationId);
      }
      const now = nowIso();
      const row: WorkflowRow = {
        ...scope,
        id,
        automationId: meta.automationId,
        name: meta.name,
        version: 1,
        enabled: false,
        lastCleanDryRunVersion: null,
        lastTriggerAt: null,
        createdAt: now,
        updatedAt: now,
        ownerEmail: meta.ownerEmail,
      };
      workflows.set(id, row);
      versions.set(id, [
        {
          ...scope,
          workflowId: id,
          version: 1,
          graph,
          source: meta.source,
          summary: meta.summary,
          createdAt: now,
          createdBy: meta.ownerEmail,
        },
      ]);
      return recordOf(row);
    },

    async getWorkflow(scope, workflowId) {
      assertScope(scope);
      const row = workflows.get(workflowId);
      return row && sameScope(row, scope) ? recordOf(row) : null;
    },

    async getWorkflowByAutomation(scope, automationId) {
      assertScope(scope);
      const row = [...workflows.values()].find(
        (candidate) =>
          sameScope(candidate, scope) &&
          candidate.automationId === automationId,
      );
      return row ? recordOf(row) : null;
    },

    async listWorkflows(scope, options = {}) {
      assertScope(scope);
      const limit = resolveLimit(
        options.limit,
        WORKFLOW_STORE_LIMITS.workflowsPageMax,
        "Workflow list",
      );
      const rows = [...workflows.values()]
        .filter((row) => sameScope(row, scope))
        .sort(
          (a, b) =>
            compareText(b.updatedAt, a.updatedAt) || compareText(b.id, a.id),
        );
      const page = takeWindow(rows, limit);
      return { items: page.items.map(summaryOf), hasMore: page.hasMore };
    },

    async getWorkflowVersion(scope, workflowId, version) {
      assertScope(scope);
      const row = versions
        .get(workflowId)
        ?.find((candidate) => candidate.version === version);
      if (!row || !sameScope(row, scope)) return null;
      const record: WorkflowVersionRecord = {
        workflowId: row.workflowId,
        version: row.version,
        source: row.source,
        summary: row.summary,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
        graph: structuredClone(row.graph),
      };
      return record;
    },

    async listWorkflowVersions(scope, workflowId, options = {}) {
      assertScope(scope);
      const limit = resolveLimit(
        options.limit,
        WORKFLOW_STORE_LIMITS.versionsPageMax,
        "Version list",
      );
      requireWorkflow(scope, workflowId);
      const rows = [...(versions.get(workflowId) ?? [])].sort(
        (a, b) => b.version - a.version,
      );
      const page = takeWindow(rows, limit);
      return {
        items: page.items.map(
          (row): WorkflowVersionSummary => ({
            workflowId: row.workflowId,
            version: row.version,
            source: row.source,
            summary: row.summary,
            createdAt: row.createdAt,
            createdBy: row.createdBy,
          }),
        ),
        hasMore: page.hasMore,
      };
    },

    async saveWorkflowGraph(scope, input: SaveWorkflowGraphInput) {
      assertScope(scope);
      const meta = prepareSaveWorkflowGraph(input);
      const { graph } = prepareGraph(input.graph);
      const row = requireWorkflow(scope, meta.workflowId);
      if (row.version !== meta.expectedVersion) {
        throw new WorkflowStoreError(
          "stale_version",
          `Workflow "${row.id}" is at version ${row.version}, not ${meta.expectedVersion}; reload and apply the change again.`,
          {
            workflowId: row.id,
            expectedVersion: meta.expectedVersion,
            currentVersion: row.version,
          },
        );
      }
      const now = nowIso();
      row.version += 1;
      // The new version has had no dry run, so no tick may find it on.
      row.enabled = false;
      row.updatedAt = now;
      versions.get(row.id)?.push({
        ...scope,
        workflowId: row.id,
        version: row.version,
        graph,
        source: meta.source,
        summary: meta.summary,
        createdAt: now,
        createdBy: meta.createdBy,
      });
      return recordOf(row);
    },

    async setWorkflowEnabled(scope, workflowId, enabled) {
      assertScope(scope);
      const row = requireWorkflow(scope, workflowId);
      if (enabled && row.lastCleanDryRunVersion !== row.version) {
        throw new WorkflowStoreError(
          "dry_run_required",
          `Workflow "${row.id}" needs a clean dry run of version ${row.version} before it can be enabled.`,
          {
            workflowId: row.id,
            currentVersion: row.version,
            lastCleanDryRunVersion: row.lastCleanDryRunVersion,
          },
        );
      }
      row.enabled = enabled;
      row.updatedAt = nowIso();
      return summaryOf(row);
    },

    async recordCleanDryRun(scope, input) {
      assertScope(scope);
      const version = assertVersion(input.version, "Dry-run version");
      const row = requireWorkflow(scope, input.workflowId);
      if (row.version !== version) {
        throw new WorkflowStoreError(
          "stale_version",
          `A dry run of version ${version} does not count: the workflow is at ${row.version}.`,
          { workflowId: row.id, version, currentVersion: row.version },
        );
      }
      row.lastCleanDryRunVersion = version;
      row.updatedAt = nowIso();
      return summaryOf(row);
    },

    async recordTriggerRun(scope, input) {
      assertScope(scope);
      const at = normalizeInstant(input.at, "Trigger instant");
      const row = requireWorkflow(scope, input.workflowId);
      if (row.lastTriggerAt === null || row.lastTriggerAt < at) {
        row.lastTriggerAt = at;
      }
    },

    async deleteWorkflow(scope, workflowId) {
      assertScope(scope);
      const row = workflows.get(workflowId);
      if (!row || !sameScope(row, scope)) return false;
      workflows.delete(workflowId);
      versions.delete(workflowId);
      for (const [id, run] of runs) {
        if (run.run.workflowId !== workflowId) continue;
        runs.delete(id);
        tickKeys.delete(`${workflowId}${SEP}${run.run.tickKey}`);
        for (const key of [...steps.keys()]) {
          if (key.startsWith(`${id}${SEP}`)) steps.delete(key);
        }
      }
      for (const [key, item] of itemStates) {
        if (item.workflowId === workflowId) itemStates.delete(key);
      }
      for (let index = events.length - 1; index >= 0; index -= 1) {
        if (events[index].event.workflowId === workflowId) {
          events.splice(index, 1);
        }
      }
      for (const [key, receipt] of receipts) {
        if (receipt.workflowId === workflowId) receipts.delete(key);
      }
      for (const key of [...cursors.keys()]) {
        if (key.split(SEP)[2] === workflowId) cursors.delete(key);
      }
      for (const [id, row] of runRequests) {
        if (row.request.workflowId === workflowId) runRequests.delete(id);
      }
      return true;
    },

    async startRun(scope, input: StartRunInput) {
      assertScope(scope);
      const prepared = prepareStartRun(input, nowIso());
      const workflow = requireWorkflow(scope, prepared.workflowId);
      assertKnownVersion(workflow, prepared.graphVersion);
      const key = `${prepared.workflowId}${SEP}${prepared.tickKey}`;
      const existingId = tickKeys.get(key);
      if (existingId !== undefined) {
        const existing = runs.get(existingId);
        if (!existing || !sameScope(existing, scope)) {
          throw new WorkflowStoreError(
            "not_found",
            `Tick key "${prepared.tickKey}" is held by a run outside this scope.`,
          );
        }
        return { created: false, run: structuredClone(existing.run) };
      }
      const run: RunRecord = {
        id: newId("run"),
        workflowId: prepared.workflowId,
        graphVersion: prepared.graphVersion,
        mode: prepared.mode,
        tickKey: prepared.tickKey,
        triggerKind: prepared.triggerKind,
        startedBy: prepared.startedBy,
        status: "running",
        startedAt: prepared.startedAt,
        counts: {},
        ...(prepared.historyRowId === null
          ? {}
          : { historyRowId: prepared.historyRowId }),
      };
      sequence.row += 1;
      runs.set(run.id, { ...scope, seq: sequence.row, run });
      tickKeys.set(key, run.id);
      return { created: true, run: structuredClone(run) };
    },

    async finishRun(scope, input: FinishRunInput) {
      assertScope(scope);
      const prepared = prepareFinishRun(input, nowIso());
      const row = runs.get(prepared.runId);
      if (!row || !sameScope(row, scope)) {
        throw new WorkflowStoreError(
          "not_found",
          `Run "${prepared.runId}" was not found.`,
          { runId: prepared.runId },
        );
      }
      if (row.run.status !== "running") {
        throw new WorkflowStoreError(
          "invalid_transition",
          `Run "${row.run.id}" already finished as ${row.run.status}.`,
          { runId: row.run.id, status: row.run.status },
        );
      }
      const finished: RunRecord = {
        ...row.run,
        status: prepared.status,
        finishedAt: prepared.finishedAt,
        counts: prepared.counts,
        ...(prepared.error === null ? {} : { error: prepared.error }),
      };
      row.run = finished;
      return structuredClone(finished);
    },

    async listRuns(scope, input: ListRunsInput) {
      assertScope(scope);
      const limit = resolveLimit(
        input.limit,
        WORKFLOW_STORE_LIMITS.runsPageMax,
        "Run list",
      );
      requireWorkflow(scope, input.workflowId);
      const rows = [...runs.values()]
        .filter(
          (row) =>
            sameScope(row, scope) &&
            row.run.workflowId === input.workflowId &&
            (input.status === undefined || row.run.status === input.status) &&
            (input.mode === undefined || row.run.mode === input.mode),
        )
        .sort(
          (a, b) =>
            compareText(b.run.startedAt, a.run.startedAt) || b.seq - a.seq,
        );
      const page = takeWindow(rows, limit);
      return {
        items: page.items.map((row) => structuredClone(row.run)),
        hasMore: page.hasMore,
      };
    },

    async getRun(scope, runId): Promise<RunWithSteps | null> {
      assertScope(scope);
      const row = runs.get(runId);
      if (!row || !sameScope(row, scope)) return null;
      const runSteps = [...steps.values()]
        .filter((step) => step.step.runId === runId && sameScope(step, scope))
        .map((step) => structuredClone(step.step))
        .sort(
          (a, b) =>
            compareText(a.startedAt, b.startedAt) ||
            compareText(a.nodeId, b.nodeId),
        );
      return { run: structuredClone(row.run), steps: runSteps };
    },

    async putStep(scope, step) {
      assertScope(scope);
      const prepared = prepareStep(step);
      const run = runs.get(prepared.runId);
      if (!run || !sameScope(run, scope)) {
        throw new WorkflowStoreError(
          "not_found",
          `Run "${prepared.runId}" was not found.`,
          { runId: prepared.runId },
        );
      }
      steps.set(`${prepared.runId}${SEP}${prepared.nodeId}`, {
        ...scope,
        step: prepared,
      });
    },

    async getItemState(scope, workflowId, itemId) {
      assertScope(scope);
      const row = ownItem(scope, workflowId, itemId);
      return row ? itemStateOf(row) : null;
    },

    async leaseItems(scope, input: LeaseItemsInput) {
      assertScope(scope);
      const prepared = prepareLeaseItems(input);
      const workflow = requireWorkflow(scope, prepared.workflowId);
      assertKnownVersion(workflow, prepared.graphVersion);
      const won: ItemState[] = [];
      for (const itemId of prepared.itemIds) {
        const key = itemKey(prepared.workflowId, itemId);
        const existing = itemStates.get(key);
        if (!existing) {
          const created: ItemRow = {
            ...scope,
            workflowId: prepared.workflowId,
            itemId,
            graphVersion: prepared.graphVersion,
            parkedAtNode: null,
            wake: null,
            dueAt: null,
            nextCheckAt: null,
            context: {},
            counters: {},
            leasedBy: prepared.leasedBy,
            leaseUntil: prepared.leaseUntil,
            updatedAt: nowIso(),
          };
          itemStates.set(key, created);
          won.push(itemStateOf(created));
          continue;
        }
        const live =
          existing.leaseUntil !== null && existing.leaseUntil > prepared.now;
        if (
          !sameScope(existing, scope) ||
          live ||
          (prepared.skipParked && existing.parkedAtNode !== null)
        ) {
          continue;
        }
        existing.leasedBy = prepared.leasedBy;
        existing.leaseUntil = prepared.leaseUntil;
        existing.updatedAt = nowIso();
        won.push(itemStateOf(existing));
      }
      return won;
    },

    async releaseLeases(scope, input: ReleaseLeasesInput) {
      assertScope(scope);
      const itemIds = uniqueItemIds(input.itemIds, "Release");
      assertId(input.leasedBy, "leasedBy");
      requireWorkflow(scope, input.workflowId);
      let released = 0;
      for (const itemId of itemIds) {
        const row = ownItem(scope, input.workflowId, itemId);
        if (!row || row.leasedBy !== input.leasedBy) continue;
        row.leasedBy = null;
        row.leaseUntil = null;
        row.updatedAt = nowIso();
        released += 1;
      }
      return released;
    },

    async parkItem(scope, input: ParkItemInput) {
      assertScope(scope);
      const prepared = preparePark(input);
      const workflow = requireWorkflow(scope, prepared.workflowId);
      assertKnownVersion(workflow, prepared.graphVersion);
      const row = heldItem(
        scope,
        prepared.workflowId,
        prepared.itemId,
        prepared.leasedBy,
      );
      row.graphVersion = prepared.graphVersion;
      row.parkedAtNode = prepared.nodeId;
      row.wake = prepared.wake.wake;
      row.dueAt = prepared.wake.dueAt;
      row.nextCheckAt = prepared.wake.nextCheckAt;
      row.context = prepared.context.value;
      if (prepared.counters !== null) row.counters = prepared.counters.value;
      row.leasedBy = null;
      row.leaseUntil = null;
      row.updatedAt = nowIso();
      return itemStateOf(row);
    },

    async listDueParked(scope, input: ListDueParkedInput) {
      assertScope(scope);
      const limit = resolveLimit(
        input.limit,
        WORKFLOW_STORE_LIMITS.dueParkedMax,
        "Due parked",
      );
      const now = normalizeInstant(input.now, "now");
      requireWorkflow(scope, input.workflowId);
      const wakeAt = (row: ItemRow): string =>
        row.nextCheckAt !== null &&
        row.dueAt !== null &&
        row.nextCheckAt < row.dueAt
          ? row.nextCheckAt
          : (row.dueAt ?? "");
      return [...itemStates.values()]
        .filter(
          (row) =>
            sameScope(row, scope) &&
            row.workflowId === input.workflowId &&
            row.parkedAtNode !== null &&
            (row.leaseUntil === null || row.leaseUntil <= now) &&
            ((row.dueAt !== null && row.dueAt <= now) ||
              (row.nextCheckAt !== null && row.nextCheckAt <= now)),
        )
        .sort(
          (a, b) =>
            compareText(wakeAt(a), wakeAt(b)) ||
            compareText(a.itemId, b.itemId),
        )
        .slice(0, limit)
        .map(itemStateOf);
    },

    async clearParking(scope, input: ClearParkingInput) {
      assertScope(scope);
      assertId(input.workflowId, "workflow id");
      const row = heldItem(
        scope,
        input.workflowId,
        assertId(input.itemId, "item id"),
        assertId(input.leasedBy, "leasedBy"),
      );
      row.parkedAtNode = null;
      row.wake = null;
      row.dueAt = null;
      row.nextCheckAt = null;
      row.context = {};
      row.leasedBy = null;
      row.leaseUntil = null;
      row.updatedAt = nowIso();
      return itemStateOf(row);
    },

    async incrementCounter(scope, input: IncrementCounterInput) {
      assertScope(scope);
      const by = input.by ?? 1;
      assertCounterIncrement(input.counter, by);
      const row = ownItem(
        scope,
        assertId(input.workflowId, "workflow id"),
        assertId(input.itemId, "item id"),
      );
      if (!row) {
        throw new WorkflowStoreError(
          "not_found",
          `Item "${input.itemId}" has no state in workflow "${input.workflowId}".`,
          { workflowId: input.workflowId, itemId: input.itemId },
        );
      }
      const next = (row.counters[input.counter] ?? 0) + by;
      row.counters[input.counter] = next;
      row.updatedAt = nowIso();
      return next;
    },

    async clearCounters(scope, input: ClearCountersInput) {
      assertScope(scope);
      const names = assertCounterNames(input.counters);
      const row = ownItem(
        scope,
        assertId(input.workflowId, "workflow id"),
        assertId(input.itemId, "item id"),
      );
      if (!row) {
        throw new WorkflowStoreError(
          "not_found",
          `Item "${input.itemId}" has no state in workflow "${input.workflowId}".`,
          { workflowId: input.workflowId, itemId: input.itemId },
        );
      }
      for (const name of names) delete row.counters[name];
      row.updatedAt = nowIso();
    },

    async appendItemEvent(scope, event) {
      await store.appendItemEvents(scope, [event]);
    },

    async appendItemEvents(scope, batch) {
      assertScope(scope);
      if (batch.length > WORKFLOW_STORE_LIMITS.eventsBatchMax) {
        throw invalidRecord(
          `At most ${WORKFLOW_STORE_LIMITS.eventsBatchMax} events go in at once; got ${batch.length}.`,
          { count: batch.length },
        );
      }
      const prepared = batch.map(prepareEvent);
      for (const workflowId of new Set(
        prepared.map((event) => event.workflowId),
      )) {
        requireWorkflow(scope, workflowId);
      }
      for (const event of prepared) {
        sequence.row += 1;
        events.push({ ...scope, seq: sequence.row, event });
      }
    },

    async listItemEvents(scope, input: ListItemEventsInput) {
      assertScope(scope);
      const limit = resolveLimit(
        input.limit,
        WORKFLOW_STORE_LIMITS.eventsPageMax,
        "Event list",
      );
      requireWorkflow(scope, input.workflowId);
      const rows = events
        .filter(
          (row) =>
            sameScope(row, scope) &&
            row.event.workflowId === input.workflowId &&
            row.event.itemId === input.itemId,
        )
        .sort((a, b) => compareText(a.event.at, b.event.at) || a.seq - b.seq);
      const page = takeWindow(rows, limit);
      return {
        items: page.items.map((row) => structuredClone(row.event)),
        hasMore: page.hasMore,
      };
    },

    async getReceipt(scope, key) {
      assertScope(scope);
      const row = receipts.get(key);
      return row && sameScope(row, scope) ? structuredClone(row.receipt) : null;
    },

    async putReceipt(scope, workflowId, receipt) {
      assertScope(scope);
      const prepared = prepareReceipt(receipt);
      requireWorkflow(scope, workflowId);
      const stored = receipts.get(prepared.key);
      if (stored && !sameScope(stored, scope)) {
        throw new WorkflowStoreError(
          "receipt_conflict",
          `Receipt "${prepared.key}" is held outside this scope.`,
          { key: prepared.key },
        );
      }
      const failure = receiptTransitionError(
        stored ? stored.receipt : null,
        prepared,
      );
      if (failure) throw failure;
      receipts.set(prepared.key, { ...scope, workflowId, receipt: prepared });
    },

    async getSourceCursor(scope, ref: SourceCursorRef) {
      assertScope(scope);
      const { workflowId, nodeId } = assertCursorRef(ref);
      const row = cursors.get(
        [scope.orgId, scope.factoryId, workflowId, nodeId].join(SEP),
      );
      const cursor: SourceCursor | null = row
        ? { value: row.value, updatedAt: row.updatedAt }
        : null;
      return cursor;
    },

    async setSourceCursor(scope, input) {
      assertScope(scope);
      const { workflowId, nodeId } = assertCursorRef(input);
      const value = prepareCursorValue(input.value);
      assertEmail(input.ownerEmail, "ownerEmail");
      requireWorkflow(scope, workflowId);
      cursors.set(
        [scope.orgId, scope.factoryId, workflowId, nodeId].join(SEP),
        { ...scope, value, updatedAt: nowIso() },
      );
    },

    async createRunRequest(scope, input) {
      assertScope(scope);
      const prepared = prepareRunRequest(input);
      requireWorkflow(scope, prepared.workflowId);
      const request: RunRequest = {
        id: `request-${(sequence.request += 1)}`,
        workflowId: prepared.workflowId,
        mode: prepared.mode,
        testNodeId: prepared.testNodeId,
        sampleItemIds: prepared.sampleItemIds,
        requestedBy: prepared.requestedBy,
        createdAt: nowIso(),
        claimedAt: null,
        claimedByHistoryId: null,
      };
      runRequests.set(request.id, { ...scope, request });
      return structuredClone(request);
    },

    async getRunRequest(scope, requestId) {
      assertScope(scope);
      const row = runRequests.get(assertId(requestId, "requestId"));
      return row && sameScope(row, scope) ? structuredClone(row.request) : null;
    },

    async claimRunRequest(scope, input) {
      assertScope(scope);
      const workflowId = assertId(input.workflowId, "workflowId");
      const historyId = assertId(input.historyId, "historyId");
      requireWorkflow(scope, workflowId);
      const now = nowIso();
      const cutoff = new Date(
        Date.parse(now) - WORKFLOW_STORE_LIMITS.runRequestTtlMs,
      ).toISOString();
      const unclaimed = [...runRequests.values()]
        .filter(
          (row) =>
            sameScope(row, scope) &&
            row.request.workflowId === workflowId &&
            row.request.claimedAt === null,
        )
        .map((row) => row.request)
        .sort(
          (a, b) =>
            compareText(a.createdAt, b.createdAt) || compareText(a.id, b.id),
        );
      const next = unclaimed.find((request) => request.createdAt >= cutoff);
      if (next) {
        next.claimedAt = now;
        next.claimedByHistoryId = historyId;
      }
      const stale = unclaimed
        .filter((request) => request.createdAt < cutoff)
        .slice(0, WORKFLOW_STORE_LIMITS.runRequestsExpiredMax);
      for (const request of stale) runRequests.delete(request.id);
      return {
        claimed: next ? structuredClone(next) : null,
        expired: structuredClone(stale),
      };
    },

    async cancelRunRequest(scope, requestId) {
      assertScope(scope);
      const id = assertId(requestId, "requestId");
      const row = runRequests.get(id);
      if (!row || !sameScope(row, scope) || row.request.claimedAt !== null) {
        return false;
      }
      runRequests.delete(id);
      return true;
    },
  };

  return store;
}
