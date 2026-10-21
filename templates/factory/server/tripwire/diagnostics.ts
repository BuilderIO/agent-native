import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn, PgDatabase } from "drizzle-orm/pg-core";

import {
  factoryWorkflowItemState,
  factoryWorkflowReceipts,
  factoryWorkflowSteps,
} from "../db/schema.js";
import type { ProviderConnection } from "../lib/factory-workflow-connections.js";
import type { WorkflowJobHealth } from "../lib/factory-workflow-job.js";
import {
  WorkflowReadError,
  decodeReceiptKey,
  type RunDetail,
  type RunView,
  type WorkflowReadModels,
} from "../workflow-host/read-models.js";
import {
  OVERDUE_AFTER_MINUTES,
  overdueAfterMinutes,
} from "../workflow-host/read-models/overdue.js";
import type {
  WorkflowRecord,
  WorkflowScope,
  WorkflowStore,
} from "../workflow/adapter.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import type { WorkflowGraph } from "../workflow/contract.js";
import { providersUsedByGraphs } from "../workflow/graph-providers.js";
import { errorDetails, redactDeep, scrub, scrubId } from "./redact.js";
import type { TripwireRow, TripwireStore } from "./store.js";

/** The most a bundle may weigh as copied: pretty-printed JSON, in bytes. */
export const DIAGNOSTICS_MAX_BYTES = 30_000;
export const DIAGNOSTICS_DEFAULT_HOURS = 24;
export const DIAGNOSTICS_MAX_HOURS = 168;
/** A write that has been `started` this long without a result needs a check. */
const RECEIPT_CHECK_AFTER_MINUTES = 10;

const RECENT_TRIPWIRES = 50;
const RUNS = 10;
const WORKFLOWS_LISTED = 25;
const GRAPHS_READ_FOR_PROVIDERS = 10;
const OPERATION_IDS_LISTED = 40;
const RECEIPTS_LISTED = 20;
const FAILED_STEP_ROWS = 100;
const FAILED_STEPS_PER_RUN = 3;
const FOCUS_TRIPWIRES = 20;
const MESSAGE_CHARS = 160;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

type ReadDatabase = PgDatabase<any, any>;

interface BuildFacts {
  app: "factory";
  release: string;
  buildId: string;
}

interface EnvironmentFacts {
  deployEnvironment: string;
  deployPlatform: string;
  serverless: boolean;
  /** Whether the in-process or platform scheduler is on, and why not when it is off. */
  recurringJobs: {
    available: boolean;
    driver?: string;
    reason?: string;
    missingSecret?: string;
  };
}

interface SchedulerReading {
  /** Epoch ms, as core stores them. */
  lastCheckedAt: number | null;
  lastDispatchedAt: number | null;
  lastError: string | null;
  runtime: string | null;
  staleAfterMs: number;
}

interface DiagnosticsDeps {
  now(): Date;
  /** Who is asking, to tell a run they started from a teammate's. */
  caller: { userEmail: string };
  build(): BuildFacts;
  environment(): EnvironmentFacts;
  scheduler(): Promise<SchedulerReading | null>;
  /** Presence and status only; never a value. A check that cannot run reports `unknown`. */
  connections(providers: string[]): Promise<ProviderConnection[]>;
  jobHealth(workflow: WorkflowRecord): Promise<WorkflowJobHealth>;
  store: Pick<WorkflowStore, "getWorkflow" | "listWorkflows">;
  models: Pick<WorkflowReadModels, "listRuns" | "getRun">;
  tripwires: TripwireStore;
  getDatabase: () => ReadDatabase;
}

interface DiagnosticsInput {
  scope: WorkflowScope;
  workflowId?: string;
  runId?: string;
  sinceHours: number;
}

interface TripwireView {
  id: string;
  at: string;
  area: string;
  code: string;
  severity: string;
  workflowId: string | null;
  runId: string | null;
  nodeId: string | null;
  /** The stored details, or `null` with `detailsUnreadable` when they do not parse. */
  details: Record<string, unknown> | null;
  detailsUnreadable?: true;
}

interface FailedStepView {
  nodeId: string;
  status: string;
  code: string | null;
  message: string | null;
}

interface RunSummary {
  id: string;
  workflowId: string;
  graphVersion: number;
  mode: string;
  status: string;
  triggerKind: string;
  startedBy: "schedule" | "you" | "teammate";
  startedAt: string;
  durationMs: number | null;
  counts: Record<string, number>;
  error: { code: string; message: string } | null;
  failedSteps: FailedStepView[];
  failedStepsTotal: number;
}

interface DiagnosticsBundle {
  schema: 1;
  generatedAt: string;
  scope: { orgId: string; factoryId: string };
  request: {
    workflowId: string | null;
    runId: string | null;
    sinceHours: number;
    since: string;
  };
  build: BuildFacts | null;
  environment: EnvironmentFacts | null;
  scheduler: {
    status: "healthy" | "stale" | "error" | "no-data";
    lastCheckedAgeSeconds: number | null;
    lastDispatchedAgeSeconds: number | null;
    staleAfterSeconds: number;
    runtime: string | null;
    lastError: string | null;
  } | null;
  connections:
    | {
        provider: string;
        status: string;
        /** Where the credential last came from, as recorded at resolution; `unobserved` before any. */
        source: string;
        detail?: string;
      }[]
    | null;
  workflow: Record<string, unknown> | null;
  workflows:
    | { id: string; name: string; version: number; enabled: boolean }[]
    | null;
  runs: RunSummary[] | null;
  focusRun: Record<string, unknown> | null;
  waiting: {
    parked: number;
    overdue: number;
    oldestOverdueAt: string | null;
    byWorkflow: {
      workflowId: string;
      parked: number;
      overdue: number;
      /** This workflow's own threshold: the one `wait_overdue` uses. */
      overdueAfterMinutes: number;
      oldestOverdueAt: string | null;
    }[];
  } | null;
  receiptsNeedingCheck: {
    count: number;
    olderThanMinutes: number;
    items: {
      workflowId: string;
      nodeId: string | null;
      attempt: number | null;
      itemId: string | null;
      startedAt: string;
      ageMinutes: number;
      summary: string | null;
    }[];
  } | null;
  tripwires: {
    windowHours: number;
    total: number;
    counts: { area: string; code: string; count: number; lastAt: string }[];
    recent: TripwireView[];
  } | null;
  /** What was cut to fit the size cap. Empty means nothing was. */
  truncated: { section: string; kept: number; of: number }[];
  /** Sections that could not be read, and why. A `null` section is always listed here. */
  unavailable: { section: string; code: string | null; message: string }[];
}

type Attempt<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function attempt<T>(run: () => Promise<T> | T): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error };
  }
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

function startedByWord(
  startedBy: string,
  caller: string,
): RunSummary["startedBy"] {
  if (startedBy === "schedule") return "schedule";
  return startedBy.trim().toLowerCase() === caller.trim().toLowerCase()
    ? "you"
    : "teammate";
}

// Stored details were written through `sanitizeDetails`, and are read through
// `scrub` again: the table is not the only place a row can come from.
function scrubJson(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrub(value);
  if (value === null || typeof value !== "object") return value;
  if (depth > 6) return "[too deep]";
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((entry) => scrubJson(entry, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 60)
      .map(([key, entry]) => [scrub(key, 60), scrubJson(entry, depth + 1)]),
  );
}

function tripwireView(row: TripwireRow): TripwireView {
  const base = {
    id: scrubId(row.id),
    at: row.createdAt,
    area: scrubId(row.area, 40),
    code: scrubId(row.code, 60),
    severity: scrubId(row.severity, 20),
    workflowId: row.workflowId === null ? null : scrubId(row.workflowId),
    runId: row.runId === null ? null : scrubId(row.runId),
    nodeId: row.nodeId === null ? null : scrubId(row.nodeId),
  };
  try {
    const parsed: unknown = JSON.parse(row.detailsJson);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error("details are not an object");
    }
    return { ...base, details: scrubJson(parsed) as Record<string, unknown> };
  } catch {
    // coercion-ok: reported as `detailsUnreadable`, a value of its own, never as empty details
    return { ...base, details: null, detailsUnreadable: true };
  }
}

function operationIdsOfGraph(graph: WorkflowGraph): string[] {
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    switch (node.kind) {
      case "source":
        if (
          node.settings.source === "provider-query" ||
          node.settings.source === "window"
        ) {
          ids.add(node.settings.operation);
        }
        break;
      case "lookup":
      case "action":
        ids.add(node.settings.operation);
        break;
      case "wait":
        if (node.settings.wait === "condition")
          ids.add(node.settings.operation);
        break;
      case "agent":
        ids.add(`${node.settings.agent}.${node.settings.op}`);
        break;
      case "ai":
        node.settings.tools.forEach((tool) => ids.add(tool));
        break;
      default:
        break;
    }
  }
  return [...ids].sort();
}

function workflowHeader(
  workflow: WorkflowRecord,
  job: Attempt<WorkflowJobHealth>,
): Record<string, unknown> {
  const { graph } = workflow;
  const kinds: Record<string, number> = {};
  for (const node of graph.nodes)
    kinds[node.kind] = (kinds[node.kind] ?? 0) + 1;
  const waitKinds = [
    ...new Set(
      graph.nodes.flatMap((node) =>
        node.kind === "wait" ? [node.settings.wait] : [],
      ),
    ),
  ].sort();
  const operationIds = operationIdsOfGraph(graph);
  return {
    id: scrubId(workflow.id),
    name: scrub(workflow.name, 80),
    version: workflow.version,
    enabled: workflow.enabled,
    lastCleanDryRunVersion: workflow.lastCleanDryRunVersion,
    // Saving into an enabled workflow switches it off until a dry run of the
    // new version is clean; the flag is not stored, this is what it leaves.
    needsCleanDryRun: workflow.lastCleanDryRunVersion !== workflow.version,
    lastTriggerAt: workflow.lastTriggerAt,
    updatedAt: workflow.updatedAt,
    nodeCount: graph.nodes.length,
    nodeKinds: kinds,
    operationIds: operationIds
      .slice(0, OPERATION_IDS_LISTED)
      .map((id) => scrubId(id)),
    operationIdsOmitted: Math.max(
      0,
      operationIds.length - OPERATION_IDS_LISTED,
    ),
    hasLoop: graph.edges.some((edge) => edge.back !== undefined),
    hasWait: waitKinds.length > 0,
    waitKinds,
    job: job.ok
      ? {
          exists: job.value.exists,
          enabled: job.value.enabled,
          schedule: job.value.schedule,
          timezone: job.value.timezone,
          lastStatus: job.value.lastStatus,
          lastRun: job.value.lastRun,
          nextRun: job.value.nextRun,
          lastErrorCode: job.value.lastErrorCode,
          lastError:
            job.value.lastError === null
              ? null
              : scrub(job.value.lastError, MESSAGE_CHARS),
          consecutiveFailures: job.value.consecutiveFailures,
          pausedReason: job.value.pausedReason,
          drift: job.value.drift,
        }
      : { unreadable: true, ...errorDetails(job.error) },
  };
}

function runSummary(
  run: RunView,
  caller: string,
  failed: FailedStepView[],
): RunSummary {
  return {
    id: scrubId(run.id),
    workflowId: scrubId(run.workflowId),
    graphVersion: run.graphVersion,
    mode: run.mode,
    status: run.status,
    triggerKind: run.triggerKind,
    startedBy: startedByWord(run.startedBy, caller),
    startedAt: run.startedAt,
    durationMs: run.durationMs,
    counts: { ...run.counts },
    error: run.error
      ? {
          code: scrubId(run.error.code, 60),
          message: scrub(run.error.message, MESSAGE_CHARS),
        }
      : null,
    failedSteps: failed.slice(0, FAILED_STEPS_PER_RUN),
    failedStepsTotal: failed.length,
  };
}

/**
 * Everything someone needs to find a cause without a debugger, as one object
 * of at most `DIAGNOSTICS_MAX_BYTES`. Every text in it is scrubbed, every id is
 * checked, and a last pass strips anything credential-shaped from the whole.
 * A section that cannot be read is `null` and listed under `unavailable` with
 * the reason; a section that was cut to fit is listed under `truncated`. Both
 * lists are empty when nothing went wrong.
 *
 * A workflow or run that is not in this factory is a `WorkflowReadError`, the
 * same as every other read.
 */
export async function buildWorkflowDiagnostics(
  deps: DiagnosticsDeps,
  input: DiagnosticsInput,
): Promise<DiagnosticsBundle> {
  const { scope } = input;
  const now = deps.now();
  const sinceHours = Math.min(
    Math.max(1, Math.floor(input.sinceHours)),
    DIAGNOSTICS_MAX_HOURS,
  );
  const since = new Date(now.getTime() - sinceHours * HOUR_MS).toISOString();
  const unavailable: DiagnosticsBundle["unavailable"] = [];

  function note(section: string, error: unknown): void {
    const details = errorDetails(error);
    unavailable.push({
      section,
      code: typeof details.errorCode === "string" ? details.errorCode : null,
      message: String(details.errorMessage),
    });
  }

  async function section<T>(
    name: string,
    run: () => Promise<T> | T,
  ): Promise<T | null> {
    const result = await attempt(run);
    if (result.ok) return result.value;
    note(name, result.error);
    return null;
  }

  // What the caller named must exist in this factory; everything else is read
  // best-effort, so one unreadable record cannot hide the rest.
  let workflow: Attempt<WorkflowRecord> | null = null;
  if (input.workflowId !== undefined) {
    const loaded = await attempt(() =>
      deps.store.getWorkflow(scope, input.workflowId as string),
    );
    if (loaded.ok && loaded.value === null) {
      throw new WorkflowReadError(
        "workflow_not_found",
        `Workflow "${input.workflowId}" was not found in this factory.`,
        { workflowId: input.workflowId },
      );
    }
    workflow = loaded as Attempt<WorkflowRecord>;
  }
  let focus: Attempt<RunDetail> | null = null;
  if (input.runId !== undefined) {
    const loaded = await attempt(() =>
      deps.models.getRun(scope, input.runId as string),
    );
    if (loaded.ok && loaded.value === null) {
      throw new WorkflowReadError(
        "run_not_found",
        `Run "${input.runId}" was not found in this factory.`,
        { runId: input.runId },
      );
    }
    focus = loaded as Attempt<RunDetail>;
  }
  const workflowFilter =
    input.workflowId === undefined
      ? undefined
      : { workflowId: input.workflowId };

  const build = await section("build", () => deps.build());
  const environment = await section("environment", () => deps.environment());

  const scheduler = await section("scheduler", async () => {
    const reading = await deps.scheduler();
    if (reading === null) {
      return {
        status: "no-data" as const,
        lastCheckedAgeSeconds: null,
        lastDispatchedAgeSeconds: null,
        staleAfterSeconds: 0,
        runtime: null,
        lastError: null,
      };
    }
    if (reading.lastCheckedAt === null) {
      return {
        status: "no-data" as const,
        lastCheckedAgeSeconds: null,
        lastDispatchedAgeSeconds:
          reading.lastDispatchedAt === null
            ? null
            : Math.round((now.getTime() - reading.lastDispatchedAt) / 1000),
        staleAfterSeconds: Math.round(reading.staleAfterMs / 1000),
        runtime: reading.runtime === null ? null : scrub(reading.runtime, 40),
        lastError:
          reading.lastError === null
            ? null
            : scrub(reading.lastError, MESSAGE_CHARS),
      };
    }
    const age = now.getTime() - reading.lastCheckedAt;
    return {
      status: reading.lastError
        ? ("error" as const)
        : age > reading.staleAfterMs
          ? ("stale" as const)
          : ("healthy" as const),
      lastCheckedAgeSeconds: Math.round(age / 1000),
      lastDispatchedAgeSeconds:
        reading.lastDispatchedAt === null
          ? null
          : Math.round((now.getTime() - reading.lastDispatchedAt) / 1000),
      staleAfterSeconds: Math.round(reading.staleAfterMs / 1000),
      runtime: reading.runtime === null ? null : scrub(reading.runtime, 40),
      lastError:
        reading.lastError === null
          ? null
          : scrub(reading.lastError, MESSAGE_CHARS),
    };
  });

  // The workflow header, and the graphs the connection check reads.
  let workflowSection: Record<string, unknown> | null = null;
  let workflows: DiagnosticsBundle["workflows"] = null;
  let graphs: WorkflowGraph[] = [];
  if (workflow !== null) {
    if (workflow.ok) {
      const record = workflow.value;
      graphs = [record.graph];
      const job = await attempt(() => deps.jobHealth(record));
      workflowSection = workflowHeader(record, job);
    } else {
      note("workflow", workflow.error);
    }
  } else {
    workflows = await section("workflows", async () => {
      const page = await deps.store.listWorkflows(scope, {
        limit: WORKFLOWS_LISTED,
      });
      const records = await Promise.all(
        page.items
          .slice(0, GRAPHS_READ_FOR_PROVIDERS)
          .map((summary) =>
            attempt(() => deps.store.getWorkflow(scope, summary.id)),
          ),
      );
      graphs = records.flatMap((record) =>
        record.ok && record.value ? [record.value.graph] : [],
      );
      for (const record of records) {
        if (!record.ok) note("workflows.graph", record.error);
      }
      return page.items.map((summary) => ({
        id: scrubId(summary.id),
        name: scrub(summary.name, 80),
        version: summary.version,
        enabled: summary.enabled,
      }));
    });
  }

  // Credential sources are what resolution recorded, not a second resolver.
  const credentialEvents = await section("credentialSources", () =>
    deps.tripwires.list(scope, {
      codes: ["credential_source_used"],
      since,
      limit: 100,
    }),
  );
  const observedSource = new Map<string, string>();
  for (const row of credentialEvents ?? []) {
    const view = tripwireView(row);
    const provider = view.details?.provider;
    const source = view.details?.source;
    if (
      typeof provider === "string" &&
      typeof source === "string" &&
      !observedSource.has(provider)
    ) {
      observedSource.set(provider, source);
    }
  }
  const connections = await section("connections", async () => {
    const providers = providersUsedByGraphs(graphs, OPERATION_CATALOG);
    if (providers.length === 0) return [];
    const reported = await deps.connections(providers);
    return reported.map((entry) => ({
      provider: scrubId(entry.provider, 60),
      status: entry.status,
      source:
        observedSource.get(entry.provider) ??
        (entry.status === "not connected" ? "none" : "unobserved"),
      ...(entry.detail === undefined
        ? {}
        : { detail: scrub(entry.detail, MESSAGE_CHARS) }),
    }));
  });

  // Runs, and the steps that failed in them.
  const caller = deps.caller.userEmail;
  const runs = await section("runs", async () => {
    const page = await deps.models.listRuns(scope, {
      ...workflowFilter,
      limit: RUNS,
    });
    const ids = page.items.map((run) => run.id);
    const failed = new Map<string, FailedStepView[]>();
    if (ids.length > 0) {
      const rows = await deps
        .getDatabase()
        .select({
          runId: factoryWorkflowSteps.runId,
          nodeId: factoryWorkflowSteps.nodeId,
          status: factoryWorkflowSteps.status,
          errorCode: factoryWorkflowSteps.errorCode,
          errorMessage: factoryWorkflowSteps.errorMessage,
        })
        .from(factoryWorkflowSteps)
        .where(
          and(
            scopeOf(factoryWorkflowSteps, scope),
            inArray(factoryWorkflowSteps.runId, ids),
            inArray(factoryWorkflowSteps.status, ["failed", "needs_check"]),
          ),
        )
        .orderBy(
          asc(factoryWorkflowSteps.startedAt),
          asc(factoryWorkflowSteps.nodeId),
        )
        .limit(FAILED_STEP_ROWS);
      for (const row of rows) {
        const list = failed.get(row.runId) ?? [];
        list.push({
          nodeId: scrubId(row.nodeId),
          status: row.status,
          code: row.errorCode === null ? null : scrubId(row.errorCode, 60),
          message:
            row.errorMessage === null
              ? null
              : scrub(row.errorMessage, MESSAGE_CHARS),
        });
        failed.set(row.runId, list);
      }
    }
    return page.items.map((run) =>
      runSummary(run, caller, failed.get(run.id) ?? []),
    );
  });

  let focusRun: Record<string, unknown> | null = null;
  if (focus !== null) {
    if (focus.ok) {
      const detail = focus.value;
      const tripwires = await section("focusRun.tripwires", () =>
        deps.tripwires.list(scope, {
          runId: detail.run.id,
          since: new Date(0).toISOString(),
          limit: FOCUS_TRIPWIRES,
        }),
      );
      focusRun = {
        run: runSummary(detail.run, caller, []),
        stepsTruncated: detail.stepsTruncated,
        steps: detail.steps.map((step) => ({
          nodeId: scrubId(step.nodeId),
          kind: step.nodeKind,
          status: step.status,
          durationMs: step.durationMs,
          ports: Object.fromEntries(
            Object.entries(step.ports).map(([port, view]) => [
              scrubId(port, 40),
              view.count,
            ]),
          ),
          error: step.error
            ? {
                code: scrubId(step.error.code, 60),
                message: scrub(step.error.message, MESSAGE_CHARS),
              }
            : null,
        })),
        tripwires: (tripwires ?? []).map(tripwireView),
      };
    } else {
      note("focusRun", focus.error);
    }
  }

  // What is waiting, and what should have woken by now. Overdue is each
  // workflow's own `wait_overdue` threshold, which follows its check cadence.
  const waiting = await section("waiting", async () => {
    const state = factoryWorkflowItemState;
    const parked = and(
      scopeOf(state, scope),
      isNotNull(state.parkedAtNode),
      input.workflowId === undefined
        ? undefined
        : eq(state.workflowId, input.workflowId),
    ) as SQL;
    const counted = await deps
      .getDatabase()
      .select({
        workflowId: state.workflowId,
        parked: sql<number>`count(*)`.mapWith(Number),
      })
      .from(state)
      .where(parked)
      .groupBy(state.workflowId)
      .limit(WORKFLOWS_LISTED);
    // A read that fails fails this section: a threshold guessed for one
    // workflow would report a count that looks like the others.
    const groups = await Promise.all(
      counted.map(async (group) => {
        const record = await deps.store.getWorkflow(scope, group.workflowId);
        return {
          ...group,
          // A workflow with no record has no cadence to follow.
          thresholdMinutes: record
            ? overdueAfterMinutes(record.graph.settings.checkCadenceMinutes)
            : OVERDUE_AFTER_MINUTES,
        };
      }),
    );
    const late = new Map<
      string,
      { overdue: number; oldestOverdueAt: string | null }
    >();
    if (groups.length > 0) {
      const cutoff = sql`case ${state.workflowId} ${sql.join(
        groups.map(
          (group) =>
            sql`when ${group.workflowId} then ${new Date(
              now.getTime() - group.thresholdMinutes * MINUTE_MS,
            ).toISOString()}`,
        ),
        sql` `,
      )} end`;
      const rows = await deps
        .getDatabase()
        .select({
          workflowId: state.workflowId,
          overdue: sql<number>`count(*)`.mapWith(Number),
          oldestOverdueAt: sql<
            string | null
          >`min(least(${state.dueAt}, ${state.nextCheckAt}))`,
        })
        .from(state)
        .where(
          and(
            parked,
            inArray(
              state.workflowId,
              groups.map((group) => group.workflowId),
            ),
            or(lt(state.dueAt, cutoff), lt(state.nextCheckAt, cutoff)),
          ),
        )
        .groupBy(state.workflowId);
      for (const row of rows) late.set(row.workflowId, row);
    }
    const byWorkflow = groups.map((group) => {
      // A workflow with no overdue item has no row in the grouped query.
      const overdue = late.get(group.workflowId);
      return {
        workflowId: scrubId(group.workflowId),
        parked: group.parked,
        overdue: overdue?.overdue ?? 0,
        overdueAfterMinutes: group.thresholdMinutes,
        oldestOverdueAt: overdue?.oldestOverdueAt ?? null,
      };
    });
    const oldest = byWorkflow
      .map((group) => group.oldestOverdueAt)
      .filter((at): at is string => at !== null)
      .sort()[0];
    return {
      parked: byWorkflow.reduce((sum, group) => sum + group.parked, 0),
      overdue: byWorkflow.reduce((sum, group) => sum + group.overdue, 0),
      oldestOverdueAt: oldest ?? null,
      byWorkflow,
    };
  });

  // Writes that began and never said how they ended.
  const receiptsNeedingCheck = await section("receipts", async () => {
    const receipts = factoryWorkflowReceipts;
    const cutoff = new Date(
      now.getTime() - RECEIPT_CHECK_AFTER_MINUTES * MINUTE_MS,
    ).toISOString();
    const needsCheck = and(
      scopeOf(receipts, scope),
      eq(receipts.status, "started"),
      lt(receipts.updatedAt, cutoff),
      input.workflowId === undefined
        ? undefined
        : eq(receipts.workflowId, input.workflowId),
    );
    const [total, listed] = await Promise.all([
      deps
        .getDatabase()
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(receipts)
        .where(needsCheck),
      deps
        .getDatabase()
        .select({
          key: receipts.receiptKey,
          workflowId: receipts.workflowId,
          summary: receipts.summary,
          updatedAt: receipts.updatedAt,
        })
        .from(receipts)
        .where(needsCheck)
        .orderBy(asc(receipts.updatedAt))
        .limit(RECEIPTS_LISTED),
    ]);
    return {
      count: total[0]?.count ?? 0,
      olderThanMinutes: RECEIPT_CHECK_AFTER_MINUTES,
      items: listed.map((row) => {
        const parts = decodeReceiptKey(row.key);
        return {
          workflowId: scrubId(row.workflowId),
          nodeId: parts === null ? null : scrubId(parts.nodeId),
          attempt: parts?.attempt ?? null,
          itemId: parts === null ? null : scrubId(parts.itemId),
          startedAt: row.updatedAt,
          ageMinutes: Math.max(
            0,
            Math.round((now.getTime() - Date.parse(row.updatedAt)) / MINUTE_MS),
          ),
          summary: row.summary === null ? null : scrub(row.summary, 120),
        };
      }),
    };
  });

  const tripwires = await section("tripwires", async () => {
    const [counts, recent] = await Promise.all([
      deps.tripwires.countsByCode(scope, {
        ...workflowFilter,
        since,
      }),
      deps.tripwires.list(scope, {
        ...workflowFilter,
        since,
        limit: RECENT_TRIPWIRES,
      }),
    ]);
    return {
      windowHours: sinceHours,
      total: counts.reduce((sum, entry) => sum + entry.count, 0),
      counts: counts.map((entry) => ({
        area: scrubId(entry.area, 40),
        code: scrubId(entry.code, 60),
        count: entry.count,
        lastAt: entry.lastAt,
      })),
      recent: recent.map(tripwireView),
    };
  });

  const bundle: DiagnosticsBundle = {
    schema: 1,
    generatedAt: now.toISOString(),
    scope: {
      orgId: scrubId(scope.orgId),
      factoryId: scrubId(scope.factoryId),
    },
    request: {
      workflowId:
        input.workflowId === undefined ? null : scrubId(input.workflowId),
      runId: input.runId === undefined ? null : scrubId(input.runId),
      sinceHours,
      since,
    },
    build,
    environment,
    scheduler,
    connections,
    workflow: workflowSection,
    workflows,
    runs,
    focusRun,
    waiting,
    receiptsNeedingCheck,
    tripwires,
    truncated: [],
    unavailable,
  };
  return fitToCap(redactDeep(bundle), DIAGNOSTICS_MAX_BYTES);
}

// Fitting the cap

function bundleBytes(bundle: unknown): number {
  return new TextEncoder().encode(JSON.stringify(bundle, null, 2)).length;
}

type Cut = (
  bundle: DiagnosticsBundle,
) => { section: string; kept: number; of: number } | null;

function halve<T>(
  list: T[] | null | undefined,
  floor: number,
  section: string,
  apply: (kept: T[]) => void,
): ReturnType<Cut> {
  if (!list || list.length <= floor) return null;
  const kept = Math.max(floor, Math.floor(list.length / 2));
  apply(list.slice(0, kept));
  return { section, kept, of: list.length };
}

// Ordered from what a person needs least to what they need most.
const CUTS: readonly Cut[] = [
  (b) =>
    halve(b.tripwires?.recent, 5, "tripwires.recent", (kept) => {
      b.tripwires!.recent = kept;
    }),
  (b) =>
    halve(b.tripwires?.counts, 10, "tripwires.counts", (kept) => {
      b.tripwires!.counts = kept;
    }),
  (b) => {
    const longest = b.runs?.find((run) =>
      run.failedSteps.some((step) => (step.message?.length ?? 0) > 60),
    );
    if (!b.runs || !longest) return null;
    for (const run of b.runs) {
      for (const step of run.failedSteps) {
        if (step.message) step.message = scrub(step.message, 60);
      }
    }
    return { section: "runs.failedSteps.message", kept: 60, of: MESSAGE_CHARS };
  },
  (b) => {
    const wide = b.runs?.some((run) => run.failedSteps.length > 1);
    if (!b.runs || !wide) return null;
    const before = b.runs.reduce((sum, run) => sum + run.failedSteps.length, 0);
    for (const run of b.runs) run.failedSteps = run.failedSteps.slice(0, 1);
    const after = b.runs.reduce((sum, run) => sum + run.failedSteps.length, 0);
    return { section: "runs.failedSteps", kept: after, of: before };
  },
  (b) =>
    halve(
      b.receiptsNeedingCheck?.items,
      3,
      "receiptsNeedingCheck.items",
      (kept) => {
        b.receiptsNeedingCheck!.items = kept;
      },
    ),
  (b) =>
    halve(b.runs, 3, "runs", (kept) => {
      b.runs = kept;
    }),
  (b) =>
    halve(b.workflows, 5, "workflows", (kept) => {
      b.workflows = kept;
    }),
  (b) => {
    const steps = b.focusRun?.steps as unknown[] | undefined;
    return halve(steps, 5, "focusRun.steps", (kept) => {
      b.focusRun!.steps = kept;
    });
  },
  (b) =>
    halve(b.waiting?.byWorkflow, 3, "waiting.byWorkflow", (kept) => {
      b.waiting!.byWorkflow = kept;
    }),
  (b) => {
    const ids = b.workflow?.operationIds as string[] | undefined;
    return halve(ids, 5, "workflow.operationIds", (kept) => {
      b.workflow!.operationIds = kept;
    });
  },
  (b) =>
    halve(b.tripwires?.recent, 1, "tripwires.recent", (kept) => {
      b.tripwires!.recent = kept;
    }),
  (b) =>
    halve(b.runs, 1, "runs", (kept) => {
      b.runs = kept;
    }),
];

/**
 * Cuts the least useful lists until the bundle fits, and says what it cut.
 * Nothing is cut silently, and a bundle that still does not fit after every cut
 * keeps its facts and its `truncated` and `unavailable` lists, which is the
 * smallest answer that still tells a person what is missing.
 */
function fitToCap(
  bundle: DiagnosticsBundle,
  maxBytes: number,
): DiagnosticsBundle {
  const merged = new Map<
    string,
    { section: string; kept: number; of: number }
  >();
  const record = (cut: { section: string; kept: number; of: number }) => {
    const earlier = merged.get(cut.section);
    merged.set(cut.section, {
      section: cut.section,
      kept: cut.kept,
      of: earlier?.of ?? cut.of,
    });
    bundle.truncated = [...merged.values()];
  };
  for (const cut of CUTS) {
    while (bundleBytes(bundle) > maxBytes) {
      const made = cut(bundle);
      if (!made) break;
      record(made);
    }
    if (bundleBytes(bundle) <= maxBytes) return bundle;
  }
  const minimal: DiagnosticsBundle = {
    ...bundle,
    workflow: null,
    workflows: null,
    runs: null,
    focusRun: null,
    waiting: null,
    receiptsNeedingCheck: null,
    connections: null,
    tripwires: bundle.tripwires && {
      ...bundle.tripwires,
      counts: bundle.tripwires.counts.slice(0, 5),
      recent: [],
    },
    truncated: [
      ...bundle.truncated,
      { section: "everything but facts", kept: 0, of: 1 },
    ],
  };
  return minimal;
}
