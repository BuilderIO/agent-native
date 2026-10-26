import { createRequire } from "node:module";

import type { AuditEvent } from "@agent-native/core/audit";
import { drizzle } from "drizzle-orm/pglite";

import { triageItems } from "../../db/schema.js";
import { factoryMigrations } from "../../plugins/factory-migrations.js";
import type {
  RunCounts,
  RunError,
  WorkflowScope,
  WorkflowStore,
} from "../../workflow/adapter.js";
import type {
  ItemEvent,
  Receipt,
  RunMode,
  RunStatus,
  RunTriggerKind,
  StepRecord,
  Wake,
  WorkflowGraph,
} from "../../workflow/contract.js";
import { buildGraph } from "../../workflow/story-graphs.fixture.js";
import type { AuditPageQuery } from "../activity-feed.js";
import {
  createWorkflowReadModels,
  type WorkflowReadModels,
} from "../read-models.js";
import { createDrizzleWorkflowStore } from "../store.js";

const { PGlite } = createRequire(
  new URL("../../../package.json", import.meta.url),
)("@electric-sql/pglite");

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;
type Database = ReturnType<typeof drizzle>;

/**
 * A real PostgreSQL (PGlite) with Factory's migrations applied, shared by one
 * spec file: building the schema takes about a second, so each test starts
 * from emptied tables instead of a new database.
 */
const RESET_TABLES = [
  "factory_workflows",
  "factory_workflow_versions",
  "factory_workflow_runs",
  "factory_workflow_steps",
  "factory_workflow_item_state",
  "factory_workflow_item_events",
  "factory_workflow_receipts",
  "factory_poll_cursors",
  "factory_items",
];
let sharedClient: PGliteClient | undefined;

async function emptyClient(): Promise<PGliteClient> {
  if (!sharedClient) {
    sharedClient = await PGlite.create("memory://");
    for (const migration of factoryMigrations) {
      if (typeof migration.sql === "string")
        await sharedClient.exec(migration.sql);
    }
  }
  await sharedClient.exec(`TRUNCATE ${RESET_TABLES.join(", ")}`);
  return sharedClient;
}

export async function closeClient(): Promise<void> {
  await sharedClient?.close();
  sharedClient = undefined;
}

export const SCOPE: WorkflowScope = { orgId: "org-1", factoryId: "factory-1" };
export const OTHER_FACTORY: WorkflowScope = {
  orgId: "org-1",
  factoryId: "factory-2",
};
export const OTHER_ORG: WorkflowScope = {
  orgId: "org-2",
  factoryId: "factory-1",
};
export const OWNER = "owner@example.test";

/** A graph with the node kinds the read models name: a source, an AI node, two actions, a Wait, and two Ends. */
export function readGraph(): WorkflowGraph {
  return buildGraph({
    nodes: [
      ["start", "trigger", { schedule: { every: "5m" } }],
      [
        "feedback",
        "source",
        { source: "inbox-poll", poller: "slack", takeLimit: 5 },
      ],
      [
        "assess",
        "ai",
        {
          instruction: "Is this a clear bug?",
          result: { clear: { type: "boolean" } },
          mode: "perItem",
        },
      ],
      ["reply", "action", { operation: "slack.postMessage", args: {} }],
      ["hold", "wait", { wait: "reply", limitHours: 24 }],
      ["tell", "action", { operation: "slack.postMessage", args: {} }],
      ["finish", "end", { outcome: "done" }],
      ["manual", "end", { outcome: "needsManual", reason: "Needs a person" }],
    ],
    edges: [
      ["start", "out", "feedback"],
      ["feedback", "out", "assess"],
      ["assess", "out", "reply"],
      ["reply", "out", "hold"],
      ["hold", "replied", "tell"],
      ["tell", "out", "finish"],
      ["hold", "timedOut", "manual"],
    ],
  });
}

export interface World {
  client: PGliteClient;
  db: Database;
  store: WorkflowStore;
  models: WorkflowReadModels;
  /** Moves the clock the store and the read models share. */
  at(iso: string): void;
  now(): string;
}

export async function createWorld(
  start = "2026-10-18T10:00:00.000Z",
): Promise<World> {
  const client = await emptyClient();
  const db = drizzle(client);
  let current = new Date(start);
  const clock = () => new Date(current);
  return {
    client,
    db,
    store: createDrizzleWorkflowStore({ getDatabase: () => db, clock }),
    models: createWorkflowReadModels({ getDatabase: () => db, clock }),
    at(iso) {
      current = new Date(iso);
    },
    now: () => current.toISOString(),
  };
}

export async function addWorkflow(
  world: World,
  options: {
    scope?: WorkflowScope;
    name?: string;
    graph?: WorkflowGraph;
    automationId?: string;
  } = {},
) {
  return world.store.createWorkflow(options.scope ?? SCOPE, {
    name: options.name ?? "Bug report to Builder",
    graph: options.graph ?? readGraph(),
    ownerEmail: OWNER,
    ...(options.automationId === undefined
      ? {}
      : { automationId: options.automationId }),
  });
}

interface RunSeed {
  scope?: WorkflowScope;
  workflowId: string;
  tickKey: string;
  mode?: RunMode;
  /** Default: `dry_run` and `test` for those modes, and `schedule` for a live run. */
  triggerKind?: RunTriggerKind;
  /** Default: `schedule` for a scheduled run, otherwise the workflow owner. */
  startedBy?: string;
  graphVersion?: number;
  startedAt: string;
  /** Omit for a run left `running`. */
  status?: Exclude<RunStatus, "running">;
  finishedAt?: string;
  counts?: RunCounts;
  error?: RunError;
  /** A step starts with its run unless it names its own `startedAt`. */
  steps?: (Omit<StepRecord, "runId" | "mode" | "startedAt"> & {
    startedAt?: string;
  })[];
}

/** Writes a run, its steps, and its end through the store, as a tick would. */
export async function addRun(world: World, seed: RunSeed) {
  const scope = seed.scope ?? SCOPE;
  const mode = seed.mode ?? "live";
  const triggerKind =
    seed.triggerKind ??
    (mode === "dry" ? "dry_run" : mode === "test" ? "test" : "schedule");
  const { run } = await world.store.startRun(scope, {
    workflowId: seed.workflowId,
    tickKey: seed.tickKey,
    mode,
    triggerKind,
    startedBy:
      seed.startedBy ?? (triggerKind === "schedule" ? "schedule" : OWNER),
    graphVersion: seed.graphVersion ?? 1,
    startedAt: seed.startedAt,
  });
  for (const step of seed.steps ?? []) {
    await world.store.putStep(scope, {
      ...step,
      runId: run.id,
      mode,
      startedAt: step.startedAt ?? seed.startedAt,
    });
  }
  if (seed.status !== undefined) {
    await world.store.finishRun(scope, {
      runId: run.id,
      status: seed.status,
      counts: seed.counts ?? {},
      ...(seed.error === undefined ? {} : { error: seed.error }),
      finishedAt: seed.finishedAt ?? seed.startedAt,
    });
  }
  return run;
}

let eventCounter = 0;

export async function addEvents(
  world: World,
  scope: WorkflowScope,
  events: (Partial<ItemEvent> &
    Pick<ItemEvent, "workflowId" | "runId" | "itemId" | "kind" | "at">)[],
) {
  // Each event gets its own id in write order, which is how ties read back.
  for (const event of events) {
    eventCounter += 1;
    await world.store.appendItemEvent(scope, {
      mode: "live",
      summary: `event ${eventCounter}`,
      ...event,
    });
  }
}

export async function addInboxItem(
  world: World,
  options: {
    id: string;
    scope?: WorkflowScope;
    title?: string;
    source?: string;
    status?: string;
    sourceUrl?: string | null;
  },
) {
  const scope = options.scope ?? SCOPE;
  await world.db.insert(triageItems).values({
    id: options.id,
    source: options.source ?? "slack",
    externalId: options.id,
    sourceUrl: options.sourceUrl ?? null,
    title: options.title ?? `Report ${options.id}`,
    status: options.status ?? "received",
    dedupeKey: `${scope.orgId}:${scope.factoryId}:${options.id}`,
    createdAt: world.now(),
    updatedAt: world.now(),
    ownerEmail: OWNER,
    orgId: scope.orgId,
    factoryId: scope.factoryId,
  });
}

/** Gives an item a state row, optionally parks it, and sets counters. */
export async function addItemState(
  world: World,
  options: {
    scope?: WorkflowScope;
    workflowId: string;
    itemId: string;
    graphVersion?: number;
    parkAt?: { nodeId: string; wake: Wake };
    attempts?: number;
    /** Leave a live lease on the row. */
    leasedBy?: string;
  },
) {
  const scope = options.scope ?? SCOPE;
  await world.store.leaseItems(scope, {
    workflowId: options.workflowId,
    graphVersion: options.graphVersion ?? 1,
    itemIds: [options.itemId],
    leasedBy: "seed",
    now: world.now(),
  });
  if (options.attempts !== undefined) {
    await world.store.incrementCounter(scope, {
      workflowId: options.workflowId,
      itemId: options.itemId,
      counter: "attempts",
      by: options.attempts,
    });
  }
  if (options.parkAt) {
    await world.store.parkItem(scope, {
      workflowId: options.workflowId,
      itemId: options.itemId,
      leasedBy: "seed",
      graphVersion: options.graphVersion ?? 1,
      nodeId: options.parkAt.nodeId,
      wake: options.parkAt.wake,
      context: {},
    });
  } else if (options.leasedBy === undefined) {
    await world.store.releaseLeases(scope, {
      workflowId: options.workflowId,
      itemIds: [options.itemId],
      leasedBy: "seed",
    });
  }
}

export async function addReceipt(
  world: World,
  scope: WorkflowScope,
  workflowId: string,
  receipt: Receipt,
) {
  await world.store.putReceipt(scope, workflowId, {
    ...receipt,
    status: "started",
  });
  if (receipt.status !== "started") {
    await world.store.putReceipt(scope, workflowId, receipt);
  }
}

export async function rows(world: World, sql: string, params: unknown[] = []) {
  return (await world.client.query(sql, params)).rows as Record<
    string,
    unknown
  >[];
}

/**
 * The slice of the framework audit log the feed reads, with the same rules as
 * `queryAuditEventPage`: newest first by (time, id), `beforeMs` exclusive,
 * `sinceMs` inclusive, offset paging, and no recorded input on a page of rows.
 */
export class FakeAudit {
  rows: AuditEvent[] = [];
  pageCalls: AuditPageQuery[] = [];
  byIdCalls: string[] = [];
  private counter = 0;

  add(
    fields: Partial<AuditEvent> &
      Pick<AuditEvent, "action" | "createdAt" | "targetId">,
  ): AuditEvent {
    this.counter += 1;
    const event: AuditEvent = {
      id: `audit-${String(this.counter).padStart(5, "0")}`,
      caller: "frontend",
      actorKind: "human",
      actorEmail: "teammate@example.test",
      orgId: SCOPE.orgId,
      threadId: null,
      turnId: null,
      targetType: "factory-workflow",
      status: "success",
      summary: null,
      input: null,
      errorCode: null,
      ownerEmail: "teammate@example.test",
      visibility: "org",
      ...fields,
    };
    this.rows.push(event);
    return event;
  }

  readAudit = async (query: AuditPageQuery) => {
    this.pageCalls.push(query);
    const matching = this.rows
      .filter(
        (row) =>
          row.targetType === query.targetType &&
          (query.targetId === undefined || row.targetId === query.targetId) &&
          (query.actorKind === undefined ||
            row.actorKind === query.actorKind) &&
          row.status === query.status &&
          (query.sinceMs === undefined || row.createdAt >= query.sinceMs) &&
          (query.beforeMs === undefined || row.createdAt < query.beforeMs),
      )
      .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
    const window = matching.slice(query.offset, query.offset + query.limit + 1);
    const events = window
      .slice(0, query.limit)
      .map((row) => ({ ...row, input: null }));
    const hasMore = window.length > query.limit;
    return {
      events,
      hasMore,
      nextOffset: hasMore ? query.offset + events.length : null,
    };
  };

  readAuditEvent = async (id: string) => {
    this.byIdCalls.push(id);
    return this.rows.find((row) => row.id === id) ?? null;
  };
}
