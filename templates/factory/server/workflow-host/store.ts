import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn, PgDatabase } from "drizzle-orm/pg-core";
import { z } from "zod";

import {
  factoryPollCursors,
  factoryWorkflowItemEvents,
  factoryWorkflowItemState,
  factoryWorkflowReceipts,
  factoryWorkflowRunRequests,
  factoryWorkflowRuns,
  factoryWorkflowSteps,
  factoryWorkflowVersions,
  factoryWorkflows,
} from "../db/schema.js";
import {
  WORKFLOW_STORE_LIMITS,
  WorkflowStoreError,
  type RunRecord,
  type RunRequest,
  type StoreClock,
  type StorePage,
  type WorkflowRecord,
  type WorkflowScope,
  type WorkflowStore,
  type WorkflowSummary,
  type WorkflowVersionRecord,
  type WorkflowVersionSource,
} from "../workflow/adapter.js";
import {
  MAX_NODES,
  itemEventSchema,
  receiptSchema,
  stepRecordSchema,
  type ItemEvent,
  type ItemState,
  type Receipt,
  type StepRecord,
} from "../workflow/contract.js";
import {
  alreadyExists,
  assembleItemState,
  assembleRunRecord,
  assertCounterIncrement,
  assertCounterNames,
  assertCursorRef,
  assertEmail,
  assertId,
  assertScope,
  assertVersion,
  assembleRunRequest,
  invalidRecord,
  normalizeInstant,
  parseStoredJson,
  parseStoredValue,
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
  readContext,
  readCounters,
  readGraph,
  readRunCounts,
  readSampleItemIds,
  readWake,
  receiptTransitionError,
  resolveLimit,
  uniqueItemIds,
} from "../workflow/store-rules.js";

// Any Drizzle PostgreSQL database: the app's `getDb()`, a transaction, or a
// PGlite instance in a spec.
type WorkflowDatabase = PgDatabase<any, any>;

type WorkflowRow = typeof factoryWorkflows.$inferSelect;
type RunRow = typeof factoryWorkflowRuns.$inferSelect;
type StepRow = typeof factoryWorkflowSteps.$inferSelect;
type ItemStateRow = typeof factoryWorkflowItemState.$inferSelect;
type RunRequestRow = typeof factoryWorkflowRunRequests.$inferSelect;

type WorkflowIdKind = "workflow" | "version" | "run" | "step" | "request";

interface DrizzleWorkflowStoreOptions {
  /** Called on every operation, so a reset connection is never held. */
  getDatabase: () => WorkflowDatabase;
  /** Bookkeeping time for `createdAt` and `updatedAt`. */
  clock?: StoreClock;
  newId?: (kind: WorkflowIdKind) => string;
}

const ID_PREFIX: Record<WorkflowIdKind, string> = {
  workflow: "wf",
  version: "wfv",
  run: "wfr",
  step: "wfs",
  request: "wfq",
};

let eventCounter = 0;
let requestCounter = 0;

/**
 * Sorts by time then id, so events written in one batch, or in the same
 * millisecond, read back in the order they were appended.
 */
function newEventId(): string {
  eventCounter = (eventCounter + 1) % 0x1000000;
  return [
    "wfe",
    Date.now().toString(36).padStart(9, "0"),
    eventCounter.toString(36).padStart(5, "0"),
    randomUUID().slice(0, 8),
  ].join("_");
}

/**
 * Sorts by time then id, so two requests made in one millisecond are claimed
 * in the order they were made.
 */
function newRequestId(): string {
  requestCounter = (requestCounter + 1) % 0x1000000;
  return [
    ID_PREFIX.request,
    Date.now().toString(36).padStart(9, "0"),
    requestCounter.toString(36).padStart(5, "0"),
    randomUUID().slice(0, 8),
  ].join("_");
}

function notFound(
  message: string,
  details?: Record<string, unknown>,
): WorkflowStoreError {
  return new WorkflowStoreError("not_found", message, details);
}

function scopeOf(
  table: { orgId: AnyPgColumn; factoryId: AnyPgColumn },
  scope: WorkflowScope,
): SQL {
  return and(
    eq(table.orgId, scope.orgId),
    eq(table.factoryId, scope.factoryId),
  ) as SQL;
}

function takeWindow<T>(rows: T[], limit: number): StorePage<T> {
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

function summaryOf(row: WorkflowRow): WorkflowSummary {
  return {
    id: row.id,
    automationId: row.automationId,
    name: row.name,
    version: row.version,
    // On only while its current version has a clean dry run, which is the state
    // `setWorkflowEnabled` requires. The engine and the job runner read this
    // flag, so a row that says on for a version nobody reviewed reads as off.
    enabled: row.enabled === 1 && row.lastCleanDryRunVersion === row.version,
    lastCleanDryRunVersion: row.lastCleanDryRunVersion,
    lastTriggerAt: row.lastTriggerAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ownerEmail: row.ownerEmail,
  };
}

function runOf(row: RunRow): RunRecord {
  return assembleRunRecord({
    id: row.id,
    workflowId: row.workflowId,
    graphVersion: row.graphVersion,
    mode: row.mode,
    tickKey: row.tickKey,
    triggerKind: row.triggerKind,
    startedBy: row.startedBy,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    counts: readRunCounts(row.countsJson, `Run "${row.id}" counts`),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    historyRowId: row.historyRowId,
  });
}

function stepOf(row: StepRow): StepRecord {
  const label = `Step "${row.nodeId}" of run "${row.runId}"`;
  const json = (raw: string, column: string): unknown =>
    parseStoredJson(raw, z.unknown(), `${label} ${column}`);
  return parseStoredValue(
    {
      runId: row.runId,
      nodeId: row.nodeId,
      status: row.status,
      mode: row.mode,
      startedAt: row.startedAt,
      ...(row.finishedAt === null ? {} : { finishedAt: row.finishedAt }),
      ports: json(row.portsJson, "ports"),
      ...(row.fieldsJson === null
        ? {}
        : { fields: json(row.fieldsJson, "fields") }),
      ...(row.totalAvailable === null
        ? {}
        : { truncated: { totalAvailable: row.totalAvailable } }),
      ...(row.inputTruncated === null
        ? {}
        : { inputTruncated: row.inputTruncated === 1 }),
      ...(row.errorCode === null
        ? {}
        : { error: { code: row.errorCode, message: row.errorMessage } }),
      ...(row.receiptKeysJson === null
        ? {}
        : { receiptKeys: json(row.receiptKeysJson, "receipt keys") }),
      ...(row.agentThreadId === null
        ? {}
        : { agentThreadId: row.agentThreadId }),
    },
    stepRecordSchema,
    label,
  );
}

function runRequestOf(row: RunRequestRow): RunRequest {
  return assembleRunRequest({
    id: row.id,
    workflowId: row.workflowId,
    mode: row.mode,
    testNodeId: row.testNodeId,
    sampleItemIds: readSampleItemIds(
      row.sampleItemIdsJson,
      `Sample items of run request "${row.id}"`,
    ),
    requestedBy: row.requestedBy,
    createdAt: row.createdAt,
    claimedAt: row.claimedAt,
    claimedByHistoryId: row.claimedByHistoryId,
  });
}

function itemStateOf(row: ItemStateRow): ItemState {
  const label = `Item "${row.itemId}" of workflow "${row.workflowId}"`;
  return assembleItemState({
    workflowId: row.workflowId,
    graphVersion: row.graphVersion,
    itemId: row.itemId,
    parkedAtNode: row.parkedAtNode,
    wake:
      row.wakeJson === null ? null : readWake(row.wakeJson, `${label} wake`),
    context: readContext(row.contextJson, `${label} context`),
    counters: readCounters(row.countersJson, `${label} counters`),
    leasedBy: row.leasedBy,
    leaseUntil: row.leaseUntil,
    updatedAt: row.updatedAt,
  });
}

function eventOf(
  row: typeof factoryWorkflowItemEvents.$inferSelect,
): ItemEvent {
  const candidate = {
    workflowId: row.workflowId,
    runId: row.runId,
    itemId: row.itemId,
    ...(row.nodeId === null ? {} : { nodeId: row.nodeId }),
    kind: row.kind,
    at: row.occurredAt,
    mode: row.mode,
    summary: row.summary,
    ...(row.port === null ? {} : { port: row.port }),
    ...(row.receiptKey === null ? {} : { receiptKey: row.receiptKey }),
    ...(row.threadId === null ? {} : { threadId: row.threadId }),
    ...(row.outcome === null ? {} : { outcome: row.outcome }),
    ...(row.code === null ? {} : { code: row.code }),
  };
  return parseStoredValue(candidate, itemEventSchema, `Event "${row.id}"`);
}

function receiptOf(row: typeof factoryWorkflowReceipts.$inferSelect): Receipt {
  const candidate = {
    key: row.receiptKey,
    status: row.status,
    ...(row.externalRef === null ? {} : { externalRef: row.externalRef }),
    ...(row.url === null ? {} : { url: row.url }),
    ...(row.summary === null ? {} : { summary: row.summary }),
    ...(row.outputJson === null
      ? {}
      : {
          output: parseStoredJson(
            row.outputJson,
            z.unknown(),
            `Receipt "${row.receiptKey}" output`,
          ),
        }),
    ...(row.outputTruncated === null
      ? {}
      : { outputTruncated: row.outputTruncated === 1 }),
    at: row.recordedAt,
  };
  return parseStoredValue(
    candidate,
    receiptSchema,
    `Receipt "${row.receiptKey}"`,
  );
}

function receiptOutputColumns(
  receipt: Receipt,
): Pick<
  typeof factoryWorkflowReceipts.$inferInsert,
  "outputJson" | "outputTruncated"
> {
  return {
    outputJson:
      receipt.output === undefined ? null : JSON.stringify(receipt.output),
    outputTruncated:
      receipt.outputTruncated === undefined
        ? null
        : receipt.outputTruncated
          ? 1
          : 0,
  };
}

/**
 * `WorkflowStore` on PostgreSQL through Drizzle. Idempotent starts, leases,
 * counters, and receipts are each one statement the database decides
 * (`INSERT ... ON CONFLICT`, or `UPDATE ... WHERE ... RETURNING`), never a read
 * followed by a write. The one transaction is a save, which moves the version
 * pointer and inserts the version row together.
 */
export function createDrizzleWorkflowStore(
  options: DrizzleWorkflowStoreOptions,
): WorkflowStore {
  const { getDatabase } = options;
  const clock: StoreClock = options.clock ?? (() => new Date());
  const newId =
    options.newId ??
    ((kind: WorkflowIdKind) =>
      kind === "request"
        ? newRequestId()
        : `${ID_PREFIX[kind]}_${randomUUID().replace(/-/g, "")}`);
  const nowIso = () => clock().toISOString();

  async function requireWorkflow(
    db: WorkflowDatabase,
    scope: WorkflowScope,
    workflowId: string,
  ): Promise<WorkflowRow> {
    const row = (
      await db
        .select()
        .from(factoryWorkflows)
        .where(
          and(
            eq(factoryWorkflows.id, workflowId),
            scopeOf(factoryWorkflows, scope),
          ),
        )
        .limit(1)
    )[0];
    if (!row) {
      throw notFound(`Workflow "${workflowId}" was not found.`, { workflowId });
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

  async function workflowWithGraph(
    db: WorkflowDatabase,
    scope: WorkflowScope,
    where: SQL,
  ): Promise<WorkflowRecord | null> {
    const found = (
      await db
        .select({
          workflow: factoryWorkflows,
          graphJson: factoryWorkflowVersions.graphJson,
        })
        .from(factoryWorkflows)
        .innerJoin(
          factoryWorkflowVersions,
          and(
            eq(factoryWorkflowVersions.workflowId, factoryWorkflows.id),
            eq(factoryWorkflowVersions.version, factoryWorkflows.version),
          ),
        )
        .where(and(where, scopeOf(factoryWorkflows, scope)))
        .limit(1)
    )[0];
    if (found) {
      return {
        ...summaryOf(found.workflow),
        graph: readGraph(
          found.graphJson,
          `Graph of workflow "${found.workflow.id}" version ${found.workflow.version}`,
        ),
      };
    }
    // The join misses both when the workflow is absent and when its current
    // version row is. Only the first is "not found".
    const bare = (
      await db
        .select()
        .from(factoryWorkflows)
        .where(and(where, scopeOf(factoryWorkflows, scope)))
        .limit(1)
    )[0];
    if (bare) {
      throw new WorkflowStoreError(
        "corrupt_record",
        `Workflow "${bare.id}" has no row for its current version ${bare.version}.`,
        { workflowId: bare.id, version: bare.version },
      );
    }
    return null;
  }

  async function runInScope(
    db: WorkflowDatabase,
    scope: WorkflowScope,
    runId: string,
  ): Promise<RunRow | undefined> {
    return (
      await db
        .select()
        .from(factoryWorkflowRuns)
        .where(
          and(
            eq(factoryWorkflowRuns.id, runId),
            scopeOf(factoryWorkflowRuns, scope),
          ),
        )
        .limit(1)
    )[0];
  }

  function itemWhere(
    scope: WorkflowScope,
    workflowId: string,
    itemId: string,
  ): SQL {
    return and(
      eq(factoryWorkflowItemState.workflowId, workflowId),
      eq(factoryWorkflowItemState.itemId, itemId),
      scopeOf(factoryWorkflowItemState, scope),
    ) as SQL;
  }

  /** The update that held the lease matched nothing: say which way it failed. */
  async function leaseFailure(
    db: WorkflowDatabase,
    scope: WorkflowScope,
    workflowId: string,
    itemId: string,
    leasedBy: string,
  ): Promise<WorkflowStoreError> {
    const row = (
      await db
        .select()
        .from(factoryWorkflowItemState)
        .where(itemWhere(scope, workflowId, itemId))
        .limit(1)
    )[0];
    if (!row) {
      return notFound(
        `Item "${itemId}" has no state in workflow "${workflowId}".`,
        { workflowId, itemId },
      );
    }
    return new WorkflowStoreError(
      "lease_lost",
      `Item "${itemId}" is not leased to "${leasedBy}".`,
      { workflowId, itemId, leasedBy, heldBy: row.leasedBy },
    );
  }

  async function readReceipt(
    db: WorkflowDatabase,
    scope: WorkflowScope,
    key: string,
  ): Promise<Receipt | null> {
    const row = (
      await db
        .select()
        .from(factoryWorkflowReceipts)
        .where(
          and(
            eq(factoryWorkflowReceipts.receiptKey, key),
            scopeOf(factoryWorkflowReceipts, scope),
          ),
        )
        .limit(1)
    )[0];
    return row ? receiptOf(row) : null;
  }

  const store: WorkflowStore = {
    async createWorkflow(scope, input) {
      assertScope(scope);
      const meta = prepareCreateWorkflow(input);
      const { json, graph } = prepareGraph(input.graph);
      const id = meta.id ?? newId("workflow");
      const now = nowIso();
      const db = getDatabase();
      return db.transaction(async (tx) => {
        const inserted = await tx
          .insert(factoryWorkflows)
          .values({
            id,
            orgId: scope.orgId,
            factoryId: scope.factoryId,
            automationId: meta.automationId,
            name: meta.name,
            version: 1,
            enabled: 0,
            lastCleanDryRunVersion: null,
            lastTriggerAt: null,
            createdAt: now,
            updatedAt: now,
            ownerEmail: meta.ownerEmail,
          })
          .onConflictDoNothing()
          .returning();
        if (!inserted[0]) throw alreadyExists(id, meta.automationId);
        await tx.insert(factoryWorkflowVersions).values({
          id: newId("version"),
          workflowId: id,
          orgId: scope.orgId,
          factoryId: scope.factoryId,
          version: 1,
          graphJson: json,
          source: meta.source,
          summary: meta.summary,
          createdAt: now,
          createdBy: meta.ownerEmail,
        });
        return { ...summaryOf(inserted[0]), graph };
      });
    },

    async getWorkflow(scope, workflowId) {
      assertScope(scope);
      return workflowWithGraph(
        getDatabase(),
        scope,
        eq(factoryWorkflows.id, workflowId),
      );
    },

    async getWorkflowByAutomation(scope, automationId) {
      assertScope(scope);
      return workflowWithGraph(
        getDatabase(),
        scope,
        eq(factoryWorkflows.automationId, automationId),
      );
    },

    async listWorkflows(scope, options = {}) {
      assertScope(scope);
      const limit = resolveLimit(
        options.limit,
        WORKFLOW_STORE_LIMITS.workflowsPageMax,
        "Workflow list",
      );
      const rows = await getDatabase()
        .select()
        .from(factoryWorkflows)
        .where(scopeOf(factoryWorkflows, scope))
        .orderBy(desc(factoryWorkflows.updatedAt), desc(factoryWorkflows.id))
        .limit(limit + 1);
      const page = takeWindow(rows, limit);
      return { items: page.items.map(summaryOf), hasMore: page.hasMore };
    },

    async getWorkflowVersion(scope, workflowId, version) {
      assertScope(scope);
      const row = (
        await getDatabase()
          .select()
          .from(factoryWorkflowVersions)
          .where(
            and(
              eq(factoryWorkflowVersions.workflowId, workflowId),
              eq(factoryWorkflowVersions.version, version),
              scopeOf(factoryWorkflowVersions, scope),
            ),
          )
          .limit(1)
      )[0];
      if (!row) return null;
      const record: WorkflowVersionRecord = {
        workflowId: row.workflowId,
        version: row.version,
        source: row.source as WorkflowVersionSource,
        summary: row.summary,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
        graph: readGraph(
          row.graphJson,
          `Graph of workflow "${row.workflowId}" version ${row.version}`,
        ),
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
      const db = getDatabase();
      await requireWorkflow(db, scope, workflowId);
      const rows = await db
        .select({
          workflowId: factoryWorkflowVersions.workflowId,
          version: factoryWorkflowVersions.version,
          source: factoryWorkflowVersions.source,
          summary: factoryWorkflowVersions.summary,
          createdAt: factoryWorkflowVersions.createdAt,
          createdBy: factoryWorkflowVersions.createdBy,
        })
        .from(factoryWorkflowVersions)
        .where(
          and(
            eq(factoryWorkflowVersions.workflowId, workflowId),
            scopeOf(factoryWorkflowVersions, scope),
          ),
        )
        .orderBy(desc(factoryWorkflowVersions.version))
        .limit(limit + 1);
      const page = takeWindow(rows, limit);
      return {
        items: page.items.map((row) => ({
          ...row,
          source: row.source as WorkflowVersionSource,
        })),
        hasMore: page.hasMore,
      };
    },

    async saveWorkflowGraph(scope, input) {
      assertScope(scope);
      const meta = prepareSaveWorkflowGraph(input);
      const { json, graph } = prepareGraph(input.graph);
      const now = nowIso();
      const db = getDatabase();
      return db.transaction(async (tx) => {
        // The row lock this update takes serializes concurrent saves; the loser
        // re-evaluates `version = expected` against the winner's commit. The new
        // version has had no dry run, so the flag goes off in this same statement:
        // a tick never finds the new graph on.
        const moved = await tx
          .update(factoryWorkflows)
          .set({
            version: sql`${factoryWorkflows.version} + 1`,
            enabled: 0,
            updatedAt: now,
          })
          .where(
            and(
              eq(factoryWorkflows.id, meta.workflowId),
              scopeOf(factoryWorkflows, scope),
              eq(factoryWorkflows.version, meta.expectedVersion),
            ),
          )
          .returning();
        if (!moved[0]) {
          const current = await requireWorkflow(tx, scope, meta.workflowId);
          throw new WorkflowStoreError(
            "stale_version",
            `Workflow "${current.id}" is at version ${current.version}, not ${meta.expectedVersion}; reload and apply the change again.`,
            {
              workflowId: current.id,
              expectedVersion: meta.expectedVersion,
              currentVersion: current.version,
            },
          );
        }
        await tx.insert(factoryWorkflowVersions).values({
          id: newId("version"),
          workflowId: meta.workflowId,
          orgId: scope.orgId,
          factoryId: scope.factoryId,
          version: moved[0].version,
          graphJson: json,
          source: meta.source,
          summary: meta.summary,
          createdAt: now,
          createdBy: meta.createdBy,
        });
        return { ...summaryOf(moved[0]), graph };
      });
    },

    async setWorkflowEnabled(scope, workflowId, enabled) {
      assertScope(scope);
      const db = getDatabase();
      const updated = await db
        .update(factoryWorkflows)
        .set({ enabled: enabled ? 1 : 0, updatedAt: nowIso() })
        .where(
          and(
            eq(factoryWorkflows.id, workflowId),
            scopeOf(factoryWorkflows, scope),
            enabled
              ? eq(
                  factoryWorkflows.lastCleanDryRunVersion,
                  factoryWorkflows.version,
                )
              : undefined,
          ),
        )
        .returning();
      if (updated[0]) return summaryOf(updated[0]);
      const row = await requireWorkflow(db, scope, workflowId);
      throw new WorkflowStoreError(
        "dry_run_required",
        `Workflow "${row.id}" needs a clean dry run of version ${row.version} before it can be enabled.`,
        {
          workflowId: row.id,
          currentVersion: row.version,
          lastCleanDryRunVersion: row.lastCleanDryRunVersion,
        },
      );
    },

    async recordCleanDryRun(scope, input) {
      assertScope(scope);
      const version = assertVersion(input.version, "Dry-run version");
      const db = getDatabase();
      const updated = await db
        .update(factoryWorkflows)
        .set({ lastCleanDryRunVersion: version, updatedAt: nowIso() })
        .where(
          and(
            eq(factoryWorkflows.id, input.workflowId),
            scopeOf(factoryWorkflows, scope),
            eq(factoryWorkflows.version, version),
          ),
        )
        .returning();
      if (updated[0]) return summaryOf(updated[0]);
      const row = await requireWorkflow(db, scope, input.workflowId);
      throw new WorkflowStoreError(
        "stale_version",
        `A dry run of version ${version} does not count: the workflow is at ${row.version}.`,
        { workflowId: row.id, version, currentVersion: row.version },
      );
    },

    async recordTriggerRun(scope, input) {
      assertScope(scope);
      const at = normalizeInstant(input.at, "Trigger instant");
      const db = getDatabase();
      await requireWorkflow(db, scope, input.workflowId);
      await db
        .update(factoryWorkflows)
        .set({ lastTriggerAt: at })
        .where(
          and(
            eq(factoryWorkflows.id, input.workflowId),
            scopeOf(factoryWorkflows, scope),
            or(
              isNull(factoryWorkflows.lastTriggerAt),
              sql`${factoryWorkflows.lastTriggerAt} < ${at}`,
            ),
          ),
        );
    },

    async deleteWorkflow(scope, workflowId) {
      assertScope(scope);
      const db = getDatabase();
      return db.transaction(async (tx) => {
        const deleted = await tx
          .delete(factoryWorkflows)
          .where(
            and(
              eq(factoryWorkflows.id, workflowId),
              scopeOf(factoryWorkflows, scope),
            ),
          )
          .returning({ id: factoryWorkflows.id });
        if (deleted.length === 0) return false;
        const children = [
          factoryWorkflowVersions,
          factoryWorkflowRuns,
          factoryWorkflowSteps,
          factoryWorkflowItemState,
          factoryWorkflowItemEvents,
          factoryWorkflowReceipts,
          factoryWorkflowRunRequests,
        ] as const;
        for (const table of children) {
          await tx
            .delete(table)
            .where(
              and(eq(table.workflowId, workflowId), scopeOf(table, scope)),
            );
        }
        await tx
          .delete(factoryPollCursors)
          .where(
            and(
              eq(factoryPollCursors.orgId, scope.orgId),
              eq(factoryPollCursors.factoryId, scope.factoryId),
              eq(factoryPollCursors.source, "workflow"),
              sql`starts_with(${factoryPollCursors.destinationKey}, ${`${workflowId}:`})`,
            ),
          );
        return true;
      });
    },

    async startRun(scope, input) {
      assertScope(scope);
      const prepared = prepareStartRun(input, nowIso());
      const db = getDatabase();
      const workflow = await requireWorkflow(db, scope, prepared.workflowId);
      assertKnownVersion(workflow, prepared.graphVersion);
      const inserted = await db
        .insert(factoryWorkflowRuns)
        .values({
          id: newId("run"),
          workflowId: prepared.workflowId,
          orgId: scope.orgId,
          factoryId: scope.factoryId,
          graphVersion: prepared.graphVersion,
          mode: prepared.mode,
          status: "running",
          tickKey: prepared.tickKey,
          triggerKind: prepared.triggerKind,
          startedBy: prepared.startedBy,
          startedAt: prepared.startedAt,
          finishedAt: null,
          countsJson: "{}",
          errorCode: null,
          errorMessage: null,
          historyRowId: prepared.historyRowId,
        })
        .onConflictDoNothing({
          target: [factoryWorkflowRuns.workflowId, factoryWorkflowRuns.tickKey],
        })
        .returning();
      if (inserted[0]) return { created: true, run: runOf(inserted[0]) };
      const existing = (
        await db
          .select()
          .from(factoryWorkflowRuns)
          .where(
            and(
              eq(factoryWorkflowRuns.workflowId, prepared.workflowId),
              eq(factoryWorkflowRuns.tickKey, prepared.tickKey),
              scopeOf(factoryWorkflowRuns, scope),
            ),
          )
          .limit(1)
      )[0];
      if (!existing) {
        throw notFound(
          `Tick key "${prepared.tickKey}" is held by a run outside this scope.`,
        );
      }
      return { created: false, run: runOf(existing) };
    },

    async finishRun(scope, input) {
      assertScope(scope);
      const prepared = prepareFinishRun(input, nowIso());
      const db = getDatabase();
      const updated = await db
        .update(factoryWorkflowRuns)
        .set({
          status: prepared.status,
          finishedAt: prepared.finishedAt,
          countsJson: JSON.stringify(prepared.counts),
          errorCode: prepared.error?.code ?? null,
          errorMessage: prepared.error?.message ?? null,
        })
        .where(
          and(
            eq(factoryWorkflowRuns.id, prepared.runId),
            scopeOf(factoryWorkflowRuns, scope),
            eq(factoryWorkflowRuns.status, "running"),
          ),
        )
        .returning();
      if (updated[0]) return runOf(updated[0]);
      const existing = await runInScope(db, scope, prepared.runId);
      if (!existing) {
        throw notFound(`Run "${prepared.runId}" was not found.`, {
          runId: prepared.runId,
        });
      }
      throw new WorkflowStoreError(
        "invalid_transition",
        `Run "${existing.id}" already finished as ${existing.status}.`,
        { runId: existing.id, status: existing.status },
      );
    },

    async listRuns(scope, input) {
      assertScope(scope);
      const limit = resolveLimit(
        input.limit,
        WORKFLOW_STORE_LIMITS.runsPageMax,
        "Run list",
      );
      const db = getDatabase();
      await requireWorkflow(db, scope, input.workflowId);
      const rows = await db
        .select()
        .from(factoryWorkflowRuns)
        .where(
          and(
            eq(factoryWorkflowRuns.workflowId, input.workflowId),
            scopeOf(factoryWorkflowRuns, scope),
            input.status === undefined
              ? undefined
              : eq(factoryWorkflowRuns.status, input.status),
            input.mode === undefined
              ? undefined
              : eq(factoryWorkflowRuns.mode, input.mode),
          ),
        )
        .orderBy(
          desc(factoryWorkflowRuns.startedAt),
          desc(factoryWorkflowRuns.id),
        )
        .limit(limit + 1);
      const page = takeWindow(rows, limit);
      return { items: page.items.map(runOf), hasMore: page.hasMore };
    },

    async getRun(scope, runId) {
      assertScope(scope);
      const db = getDatabase();
      const run = await runInScope(db, scope, runId);
      if (!run) return null;
      const steps = await db
        .select()
        .from(factoryWorkflowSteps)
        .where(
          and(
            eq(factoryWorkflowSteps.runId, runId),
            scopeOf(factoryWorkflowSteps, scope),
          ),
        )
        .orderBy(
          asc(factoryWorkflowSteps.startedAt),
          asc(factoryWorkflowSteps.nodeId),
        )
        .limit(MAX_NODES);
      return { run: runOf(run), steps: steps.map(stepOf) };
    },

    async putStep(scope, step) {
      assertScope(scope);
      const prepared = prepareStep(step);
      const db = getDatabase();
      const run = await runInScope(db, scope, prepared.runId);
      if (!run) {
        throw notFound(`Run "${prepared.runId}" was not found.`, {
          runId: prepared.runId,
        });
      }
      const values = {
        workflowId: run.workflowId,
        orgId: scope.orgId,
        factoryId: scope.factoryId,
        status: prepared.status,
        mode: prepared.mode,
        startedAt: prepared.startedAt,
        finishedAt: prepared.finishedAt ?? null,
        portsJson: JSON.stringify(prepared.ports),
        fieldsJson:
          prepared.fields === undefined
            ? null
            : JSON.stringify(prepared.fields),
        totalAvailable: prepared.truncated?.totalAvailable ?? null,
        inputTruncated:
          prepared.inputTruncated === undefined
            ? null
            : prepared.inputTruncated
              ? 1
              : 0,
        errorCode: prepared.error?.code ?? null,
        errorMessage: prepared.error?.message ?? null,
        receiptKeysJson:
          prepared.receiptKeys === undefined
            ? null
            : JSON.stringify(prepared.receiptKeys),
        agentThreadId: prepared.agentThreadId ?? null,
      };
      await db
        .insert(factoryWorkflowSteps)
        .values({
          id: newId("step"),
          runId: prepared.runId,
          nodeId: prepared.nodeId,
          ...values,
        })
        .onConflictDoUpdate({
          target: [factoryWorkflowSteps.runId, factoryWorkflowSteps.nodeId],
          set: values,
        });
    },

    async getItemState(scope, workflowId, itemId) {
      assertScope(scope);
      const row = (
        await getDatabase()
          .select()
          .from(factoryWorkflowItemState)
          .where(itemWhere(scope, workflowId, itemId))
          .limit(1)
      )[0];
      return row ? itemStateOf(row) : null;
    },

    async leaseItems(scope, input) {
      assertScope(scope);
      const prepared = prepareLeaseItems(input);
      const db = getDatabase();
      const workflow = await requireWorkflow(db, scope, prepared.workflowId);
      assertKnownVersion(workflow, prepared.graphVersion);
      const now = nowIso();
      // Two callers taking overlapping ids lock rows in the order of their
      // VALUES; one fixed order keeps them from deadlocking.
      const rows = [...prepared.itemIds].sort().map((itemId) => ({
        workflowId: prepared.workflowId,
        itemId,
        orgId: scope.orgId,
        factoryId: scope.factoryId,
        graphVersion: prepared.graphVersion,
        parkedAtNode: null,
        wakeJson: null,
        dueAt: null,
        nextCheckAt: null,
        contextJson: "{}",
        countersJson: "{}",
        leasedBy: prepared.leasedBy,
        leaseUntil: prepared.leaseUntil,
        createdAt: now,
        updatedAt: now,
      }));
      const won = await db
        .insert(factoryWorkflowItemState)
        .values(rows)
        .onConflictDoUpdate({
          target: [
            factoryWorkflowItemState.workflowId,
            factoryWorkflowItemState.itemId,
          ],
          set: {
            leasedBy: sql`excluded.leased_by`,
            leaseUntil: sql`excluded.lease_until`,
            updatedAt: sql`excluded.updated_at`,
          },
          setWhere: and(
            scopeOf(factoryWorkflowItemState, scope),
            or(
              isNull(factoryWorkflowItemState.leaseUntil),
              lte(factoryWorkflowItemState.leaseUntil, prepared.now),
            ),
            prepared.skipParked
              ? isNull(factoryWorkflowItemState.parkedAtNode)
              : undefined,
          ),
        })
        .returning();
      const byItem = new Map(won.map((row) => [row.itemId, row]));
      return prepared.itemIds.flatMap((itemId) => {
        const row = byItem.get(itemId);
        return row ? [itemStateOf(row)] : [];
      });
    },

    async releaseLeases(scope, input) {
      assertScope(scope);
      const itemIds = uniqueItemIds(input.itemIds, "Release");
      const leasedBy = assertId(input.leasedBy, "leasedBy");
      const db = getDatabase();
      await requireWorkflow(db, scope, input.workflowId);
      const released = await db
        .update(factoryWorkflowItemState)
        .set({ leasedBy: null, leaseUntil: null, updatedAt: nowIso() })
        .where(
          and(
            eq(factoryWorkflowItemState.workflowId, input.workflowId),
            scopeOf(factoryWorkflowItemState, scope),
            inArray(factoryWorkflowItemState.itemId, itemIds),
            eq(factoryWorkflowItemState.leasedBy, leasedBy),
          ),
        )
        .returning({ itemId: factoryWorkflowItemState.itemId });
      return released.length;
    },

    async parkItem(scope, input) {
      assertScope(scope);
      const prepared = preparePark(input);
      const db = getDatabase();
      const workflow = await requireWorkflow(db, scope, prepared.workflowId);
      assertKnownVersion(workflow, prepared.graphVersion);
      const updated = await db
        .update(factoryWorkflowItemState)
        .set({
          graphVersion: prepared.graphVersion,
          parkedAtNode: prepared.nodeId,
          wakeJson: prepared.wake.json,
          dueAt: prepared.wake.dueAt,
          nextCheckAt: prepared.wake.nextCheckAt,
          contextJson: prepared.context.json,
          ...(prepared.counters === null
            ? {}
            : { countersJson: prepared.counters.json }),
          leasedBy: null,
          leaseUntil: null,
          updatedAt: nowIso(),
        })
        .where(
          and(
            itemWhere(scope, prepared.workflowId, prepared.itemId),
            eq(factoryWorkflowItemState.leasedBy, prepared.leasedBy),
          ),
        )
        .returning();
      if (!updated[0]) {
        throw await leaseFailure(
          db,
          scope,
          prepared.workflowId,
          prepared.itemId,
          prepared.leasedBy,
        );
      }
      return itemStateOf(updated[0]);
    },

    async listDueParked(scope, input) {
      assertScope(scope);
      const limit = resolveLimit(
        input.limit,
        WORKFLOW_STORE_LIMITS.dueParkedMax,
        "Due parked",
      );
      const now = normalizeInstant(input.now, "now");
      const db = getDatabase();
      await requireWorkflow(db, scope, input.workflowId);
      const rows = await db
        .select()
        .from(factoryWorkflowItemState)
        .where(
          and(
            eq(factoryWorkflowItemState.workflowId, input.workflowId),
            scopeOf(factoryWorkflowItemState, scope),
            isNotNull(factoryWorkflowItemState.parkedAtNode),
            or(
              isNull(factoryWorkflowItemState.leaseUntil),
              lte(factoryWorkflowItemState.leaseUntil, now),
            ),
            or(
              lte(factoryWorkflowItemState.dueAt, now),
              lte(factoryWorkflowItemState.nextCheckAt, now),
            ),
          ),
        )
        .orderBy(
          sql`LEAST(${factoryWorkflowItemState.dueAt}, COALESCE(${factoryWorkflowItemState.nextCheckAt}, ${factoryWorkflowItemState.dueAt}))`,
          asc(factoryWorkflowItemState.itemId),
        )
        .limit(limit);
      return rows.map(itemStateOf);
    },

    async clearParking(scope, input) {
      assertScope(scope);
      const workflowId = assertId(input.workflowId, "workflow id");
      const itemId = assertId(input.itemId, "item id");
      const leasedBy = assertId(input.leasedBy, "leasedBy");
      const db = getDatabase();
      const updated = await db
        .update(factoryWorkflowItemState)
        .set({
          parkedAtNode: null,
          wakeJson: null,
          dueAt: null,
          nextCheckAt: null,
          contextJson: "{}",
          leasedBy: null,
          leaseUntil: null,
          updatedAt: nowIso(),
        })
        .where(
          and(
            itemWhere(scope, workflowId, itemId),
            eq(factoryWorkflowItemState.leasedBy, leasedBy),
          ),
        )
        .returning();
      if (!updated[0]) {
        throw await leaseFailure(db, scope, workflowId, itemId, leasedBy);
      }
      return itemStateOf(updated[0]);
    },

    async incrementCounter(scope, input) {
      assertScope(scope);
      const by = input.by ?? 1;
      assertCounterIncrement(input.counter, by);
      const workflowId = assertId(input.workflowId, "workflow id");
      const itemId = assertId(input.itemId, "item id");
      const counters = factoryWorkflowItemState.countersJson;
      // One UPDATE: the row lock makes concurrent increments queue and each
      // one add to the committed value, so none is lost.
      const updated = await getDatabase()
        .update(factoryWorkflowItemState)
        .set({
          countersJson: sql`jsonb_set(${counters}::jsonb, ARRAY[${input.counter}]::text[], to_jsonb(COALESCE((${counters}::jsonb ->> ${input.counter}::text)::int, 0) + ${by}::int))::text`,
          updatedAt: nowIso(),
        })
        .where(itemWhere(scope, workflowId, itemId))
        .returning({ countersJson: counters });
      if (!updated[0]) {
        throw notFound(
          `Item "${itemId}" has no state in workflow "${workflowId}".`,
          { workflowId, itemId },
        );
      }
      const value = readCounters(
        updated[0].countersJson,
        `Item "${itemId}" counters`,
      )[input.counter];
      if (value === undefined) {
        throw new WorkflowStoreError(
          "corrupt_record",
          `Counter "${input.counter}" is missing after it was incremented.`,
        );
      }
      return value;
    },

    async clearCounters(scope, input) {
      assertScope(scope);
      const names = assertCounterNames(input.counters);
      const workflowId = assertId(input.workflowId, "workflow id");
      const itemId = assertId(input.itemId, "item id");
      const counters = factoryWorkflowItemState.countersJson;
      const updated = await getDatabase()
        .update(factoryWorkflowItemState)
        .set({
          countersJson: sql`(${counters}::jsonb - ARRAY[${sql.join(
            names.map((name) => sql`${name}`),
            sql`, `,
          )}]::text[])::text`,
          updatedAt: nowIso(),
        })
        .where(itemWhere(scope, workflowId, itemId))
        .returning({ itemId: factoryWorkflowItemState.itemId });
      if (!updated[0]) {
        throw notFound(
          `Item "${itemId}" has no state in workflow "${workflowId}".`,
          { workflowId, itemId },
        );
      }
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
      if (prepared.length === 0) return;
      const db = getDatabase();
      for (const workflowId of new Set(
        prepared.map((event) => event.workflowId),
      )) {
        await requireWorkflow(db, scope, workflowId);
      }
      await db.insert(factoryWorkflowItemEvents).values(
        prepared.map((event) => ({
          id: newEventId(),
          workflowId: event.workflowId,
          runId: event.runId,
          itemId: event.itemId,
          nodeId: event.nodeId ?? null,
          kind: event.kind,
          occurredAt: event.at,
          mode: event.mode,
          summary: event.summary,
          port: event.port ?? null,
          receiptKey: event.receiptKey ?? null,
          threadId: event.threadId ?? null,
          outcome: event.outcome ?? null,
          code: event.code ?? null,
          orgId: scope.orgId,
          factoryId: scope.factoryId,
        })),
      );
    },

    async listItemEvents(scope, input) {
      assertScope(scope);
      const limit = resolveLimit(
        input.limit,
        WORKFLOW_STORE_LIMITS.eventsPageMax,
        "Event list",
      );
      const db = getDatabase();
      await requireWorkflow(db, scope, input.workflowId);
      const rows = await db
        .select()
        .from(factoryWorkflowItemEvents)
        .where(
          and(
            eq(factoryWorkflowItemEvents.workflowId, input.workflowId),
            eq(factoryWorkflowItemEvents.itemId, input.itemId),
            scopeOf(factoryWorkflowItemEvents, scope),
          ),
        )
        .orderBy(
          asc(factoryWorkflowItemEvents.occurredAt),
          asc(factoryWorkflowItemEvents.id),
        )
        .limit(limit + 1);
      const page = takeWindow(rows, limit);
      return { items: page.items.map(eventOf), hasMore: page.hasMore };
    },

    async getReceipt(scope, key) {
      assertScope(scope);
      return readReceipt(getDatabase(), scope, key);
    },

    async putReceipt(scope, workflowId, receipt) {
      assertScope(scope);
      const prepared = prepareReceipt(receipt);
      const db = getDatabase();
      await requireWorkflow(db, scope, workflowId);
      const now = nowIso();
      if (prepared.status === "started") {
        const inserted = await db
          .insert(factoryWorkflowReceipts)
          .values({
            receiptKey: prepared.key,
            workflowId,
            orgId: scope.orgId,
            factoryId: scope.factoryId,
            status: "started",
            externalRef: prepared.externalRef ?? null,
            url: prepared.url ?? null,
            summary: prepared.summary ?? null,
            ...receiptOutputColumns(prepared),
            recordedAt: prepared.at,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .returning({ key: factoryWorkflowReceipts.receiptKey });
        if (inserted.length === 1) return;
        const existing = await readReceipt(db, scope, prepared.key);
        throw (
          receiptTransitionError(existing, prepared) ??
          new WorkflowStoreError(
            "receipt_conflict",
            `Receipt "${prepared.key}" is held outside this scope.`,
            { key: prepared.key },
          )
        );
      }
      const closed = await db
        .update(factoryWorkflowReceipts)
        .set({
          status: prepared.status,
          externalRef: prepared.externalRef ?? null,
          url: prepared.url ?? null,
          summary: prepared.summary ?? null,
          ...receiptOutputColumns(prepared),
          recordedAt: prepared.at,
          updatedAt: now,
        })
        .where(
          and(
            eq(factoryWorkflowReceipts.receiptKey, prepared.key),
            scopeOf(factoryWorkflowReceipts, scope),
            eq(factoryWorkflowReceipts.status, "started"),
          ),
        )
        .returning({ key: factoryWorkflowReceipts.receiptKey });
      if (closed.length === 1) return;
      const existing = await readReceipt(db, scope, prepared.key);
      throw (
        receiptTransitionError(existing, prepared) ??
        new WorkflowStoreError(
          "invalid_transition",
          `Receipt "${prepared.key}" could not move to ${prepared.status}.`,
          { key: prepared.key, to: prepared.status },
        )
      );
    },

    async getSourceCursor(scope, ref) {
      assertScope(scope);
      const { workflowId, nodeId } = assertCursorRef(ref);
      const row = (
        await getDatabase()
          .select({
            cursorValue: factoryPollCursors.cursorValue,
            updatedAt: factoryPollCursors.updatedAt,
          })
          .from(factoryPollCursors)
          .where(
            and(
              eq(factoryPollCursors.orgId, scope.orgId),
              eq(factoryPollCursors.factoryId, scope.factoryId),
              eq(factoryPollCursors.source, "workflow"),
              eq(factoryPollCursors.destinationKey, `${workflowId}:${nodeId}`),
            ),
          )
          .limit(1)
      )[0];
      if (!row || row.cursorValue === null) return null;
      return { value: row.cursorValue, updatedAt: row.updatedAt };
    },

    async setSourceCursor(scope, input) {
      assertScope(scope);
      const { workflowId, nodeId } = assertCursorRef(input);
      const value = prepareCursorValue(input.value);
      const ownerEmail = assertEmail(input.ownerEmail, "ownerEmail");
      const db = getDatabase();
      await requireWorkflow(db, scope, workflowId);
      const now = nowIso();
      await db
        .insert(factoryPollCursors)
        .values({
          id: [
            "workflow-cursor",
            scope.orgId,
            scope.factoryId,
            workflowId,
            nodeId,
          ]
            .map(encodeURIComponent)
            .join(":"),
          factoryId: scope.factoryId,
          source: "workflow",
          destinationKey: `${workflowId}:${nodeId}`,
          cursorValue: value,
          createdAt: now,
          updatedAt: now,
          ownerEmail,
          orgId: scope.orgId,
        })
        .onConflictDoUpdate({
          target: [
            factoryPollCursors.orgId,
            factoryPollCursors.factoryId,
            factoryPollCursors.source,
            factoryPollCursors.destinationKey,
          ],
          set: { cursorValue: value, updatedAt: now, ownerEmail },
        });
    },

    async createRunRequest(scope, input) {
      assertScope(scope);
      const prepared = prepareRunRequest(input);
      const db = getDatabase();
      await requireWorkflow(db, scope, prepared.workflowId);
      const [row] = await db
        .insert(factoryWorkflowRunRequests)
        .values({
          id: newId("request"),
          orgId: scope.orgId,
          factoryId: scope.factoryId,
          workflowId: prepared.workflowId,
          mode: prepared.mode,
          testNodeId: prepared.testNodeId,
          sampleItemIdsJson: JSON.stringify(prepared.sampleItemIds),
          requestedBy: prepared.requestedBy,
          createdAt: nowIso(),
          claimedAt: null,
          claimedByHistoryId: null,
        })
        .returning();
      if (!row) {
        throw new Error("The run request insert returned no row.");
      }
      return runRequestOf(row);
    },

    async getRunRequest(scope, requestId) {
      assertScope(scope);
      const id = assertId(requestId, "requestId");
      const row = (
        await getDatabase()
          .select()
          .from(factoryWorkflowRunRequests)
          .where(
            and(
              eq(factoryWorkflowRunRequests.id, id),
              scopeOf(factoryWorkflowRunRequests, scope),
            ),
          )
          .limit(1)
      )[0];
      return row ? runRequestOf(row) : null;
    },

    async claimRunRequest(scope, input) {
      assertScope(scope);
      const workflowId = assertId(input.workflowId, "workflowId");
      const historyId = assertId(input.historyId, "historyId");
      const db = getDatabase();
      await requireWorkflow(db, scope, workflowId);
      const requests = factoryWorkflowRunRequests;
      const now = nowIso();
      const cutoff = new Date(
        Date.parse(now) - WORKFLOW_STORE_LIMITS.runRequestTtlMs,
      ).toISOString();
      const unclaimed = and(
        eq(requests.workflowId, workflowId),
        scopeOf(requests, scope),
        isNull(requests.claimedAt),
      ) as SQL;
      // One statement picks and claims. SKIP LOCKED sends a second tick that
      // arrives mid-claim to the next request instead of to nothing, which
      // would otherwise read as "no request" and run the workflow live.
      const oldest = db
        .select({ id: requests.id })
        .from(requests)
        .where(and(unclaimed, gte(requests.createdAt, cutoff)))
        .orderBy(asc(requests.createdAt), asc(requests.id))
        .limit(1)
        .for("update", { skipLocked: true });
      const [won] = await db
        .update(requests)
        .set({ claimedAt: now, claimedByHistoryId: historyId })
        .where(
          and(eq(requests.id, sql`(${oldest})`), isNull(requests.claimedAt)),
        )
        .returning();
      const stale = db
        .select({ id: requests.id })
        .from(requests)
        .where(and(unclaimed, lt(requests.createdAt, cutoff)))
        .orderBy(asc(requests.createdAt), asc(requests.id))
        .limit(WORKFLOW_STORE_LIMITS.runRequestsExpiredMax);
      const expired = await db
        .delete(requests)
        .where(and(inArray(requests.id, stale), isNull(requests.claimedAt)))
        .returning();
      return {
        claimed: won ? runRequestOf(won) : null,
        expired: expired
          .map(runRequestOf)
          .sort(
            (a, b) =>
              a.createdAt.localeCompare(b.createdAt) ||
              a.id.localeCompare(b.id),
          ),
      };
    },

    async cancelRunRequest(scope, requestId) {
      assertScope(scope);
      const id = assertId(requestId, "requestId");
      const removed = await getDatabase()
        .delete(factoryWorkflowRunRequests)
        .where(
          and(
            eq(factoryWorkflowRunRequests.id, id),
            scopeOf(factoryWorkflowRunRequests, scope),
            isNull(factoryWorkflowRunRequests.claimedAt),
          ),
        )
        .returning({ id: factoryWorkflowRunRequests.id });
      return removed.length > 0;
    },
  };

  return store;
}
