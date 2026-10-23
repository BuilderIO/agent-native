import type { OperationResult } from "../adapter.js";
import {
  SCHEDULE_STARTER,
  type ItemEvent,
  type RunMode,
  type StepRecord,
  type WorkflowGraph,
} from "../contract.js";
import {
  runTick,
  type RunTickInput,
  type TickResult,
} from "../engine/run-tick.js";
import type { NormalizedItem } from "../items.js";
import { portsFor } from "../ports.js";
import {
  buildGraph,
  parseNode,
  type NodeSpec,
} from "../story-graphs.fixture.js";
import { ok } from "./fakes.js";
import type { TestHost } from "./make-host.js";

/** The fake clock's default start: a Monday at noon UTC, on every 5-minute grid. */
export const T0 = "2026-10-19T12:00:00.000Z";

/** An instant `minutes` after `from`. */
export function minutesAfter(minutes: number, from: string = T0): string {
  return new Date(Date.parse(from) + minutes * 60_000).toISOString();
}

/** A valid normalized item; override whatever a test cares about. */
export function normalizedItem(
  id: string,
  overrides: Partial<NormalizedItem> = {},
): NormalizedItem {
  return {
    id,
    externalId: id,
    kind: "message",
    provider: "test",
    title: `Item ${id}`,
    occurredAt: "2026-10-19T11:00:00.000Z",
    extras: {},
    ...overrides,
  };
}

/** A source answer: these items, and anything else the result may carry. */
export function sourceResult(
  items: readonly NormalizedItem[],
  extra: Partial<Extract<OperationResult, { ok: true }>> = {},
): OperationResult {
  return ok(null, { items, ...extra });
}

export const EVERY_5M = { schedule: { every: "5m" } } as const;

export const providerQuery = (extra: Record<string, unknown> = {}) => ({
  source: "provider-query",
  operation: "test.items",
  args: {},
  memory: "inbox",
  maxItems: 50,
  ...extra,
});

export const endWith = (
  outcome: "done" | "dismissed" | "needsManual" | "released",
  extra: Record<string, unknown> = {},
) => ({
  outcome,
  ...(outcome === "dismissed" ? { reason: "not needed" } : {}),
  ...extra,
});

const tickCounters = new WeakMap<TestHost, number>();

/** Who a hand-started test run says started it. */
export const TEST_STARTER = "tester@example.test";

/** A hand-started run's trigger kind and starter for `mode`: a dry run, a test run, or a manual live run. */
export function startedByHand(
  mode: RunMode = "live",
): Pick<RunTickInput, "triggerKind" | "startedBy"> {
  return {
    triggerKind:
      mode === "dry" ? "dry_run" : mode === "test" ? "test" : "manual",
    startedBy: TEST_STARTER,
  };
}

type RanTick = Extract<TickResult, { kind: "ran" }>;

/** Runs one tick with a fresh tick key; override any input. It is a manual run unless it names `scheduledFor`, which only a scheduled tick has. */
export async function tick(
  test: TestHost,
  workflowId: string,
  options: Partial<Omit<RunTickInput, "host" | "scope" | "workflowId">> = {},
): Promise<TickResult> {
  const count = (tickCounters.get(test) ?? 0) + 1;
  tickCounters.set(test, count);
  return runTick({
    host: test.host,
    scope: test.scope,
    workflowId,
    tickKey: `tick-${count}`,
    mode: "live",
    ...(options.scheduledFor !== undefined &&
    (options.mode === undefined || options.mode === "live")
      ? { triggerKind: "schedule", startedBy: SCHEDULE_STARTER }
      : startedByHand(options.mode)),
    ...options,
  });
}

/**
 * Runs a scheduled tick: the clock moves to `instant` and the tick is keyed by
 * it, the way the job scheduler hands one over.
 */
export async function tickAt(
  test: TestHost,
  workflowId: string,
  instant: string,
  options: Partial<Omit<RunTickInput, "host" | "scope" | "workflowId">> = {},
): Promise<TickResult> {
  test.clock.set(instant);
  return runTick({
    host: test.host,
    scope: test.scope,
    workflowId,
    tickKey: instant,
    scheduledFor: instant,
    mode: "live",
    ...(options.mode === undefined || options.mode === "live"
      ? { triggerKind: "schedule", startedBy: SCHEDULE_STARTER }
      : startedByHand(options.mode)),
    ...options,
  });
}

/** Like `tickAt`, but fails the test unless the tick ran. */
export async function ranAt(
  test: TestHost,
  workflowId: string,
  instant: string,
  options: Partial<Omit<RunTickInput, "host" | "scope" | "workflowId">> = {},
): Promise<RanTick> {
  const result = await tickAt(test, workflowId, instant, options);
  if (result.kind !== "ran") {
    throw new Error(`Expected the tick to run, got ${JSON.stringify(result)}`);
  }
  return result;
}

/** Like `tick`, but fails the test unless the tick ran. */
export async function ran(
  test: TestHost,
  workflowId: string,
  options: Partial<Omit<RunTickInput, "host" | "scope" | "workflowId">> = {},
): Promise<RanTick> {
  const result = await tick(test, workflowId, options);
  if (result.kind !== "ran") {
    throw new Error(`Expected the tick to run, got ${JSON.stringify(result)}`);
  }
  return result;
}

export function stepOf(result: RanTick, nodeId: string): StepRecord {
  const step = result.steps.find((candidate) => candidate.nodeId === nodeId);
  if (!step) {
    throw new Error(
      `No step for "${nodeId}"; steps: ${result.steps.map((entry) => entry.nodeId).join(", ")}`,
    );
  }
  return step;
}

export async function eventsOf(
  test: TestHost,
  workflowId: string,
  itemId: string,
): Promise<ItemEvent[]> {
  const page = await test.store.listItemEvents(test.scope, {
    workflowId,
    itemId,
  });
  return page.items;
}

/**
 * trigger -> source -> each node in turn (all single-output) -> end `done`.
 * Nodes are named by the first element of their spec. Pass `source` to change
 * the source's settings and `settings` for the workflow's.
 */
export function chain(
  nodes: NodeSpec[],
  options: {
    source?: Record<string, unknown>;
    settings?: Record<string, unknown>;
    end?: Record<string, unknown>;
  } = {},
): WorkflowGraph {
  const all: NodeSpec[] = [
    ["start", "trigger", EVERY_5M],
    ["src", "source", options.source ?? providerQuery()],
    ...nodes,
    ["done", "end", options.end ?? endWith("done")],
  ];
  const edges: [string, string, string][] = [];
  for (let index = 1; index < all.length; index += 1) {
    edges.push([all[index - 1][0], "out", all[index][0]]);
  }
  return buildGraph({
    nodes: all,
    edges,
    ...(options.settings ? { settings: options.settings } : {}),
  });
}

/**
 * Makes the inbox offer rows the way the real one does: every row in `pool`
 * that is not in a handled status, whether or not the engine could take it. A
 * test adds to `pool` to make a row arrive; which rows the engine may take is
 * the engine's lease to decide, so a row it left unheld is offered again.
 */
export function offerRows(
  test: TestHost,
  pool: readonly NormalizedItem[],
): void {
  const handled = new Set(["resolved", "dismissed", "needs_manual"]);
  test.inbox.take = async (request) => {
    test.inbox.requests.push(request);
    for (const item of pool) {
      if (!test.statuses.rowStatus.has(item.id)) test.statuses.seedRow(item);
    }
    const open = pool.filter(
      (item) => !handled.has(test.statuses.rowStatus.get(item.id) ?? ""),
    );
    return { ok: true, items: open.slice(0, request.settings.takeLimit) };
  };
}

/**
 * Makes the inbox answer a read for rows put back in the queue the way the
 * host does: every row at its queue status that this workflow took before and
 * nothing holds. A test puts a row back by giving it that status again.
 */
export function putBackRowsFor(test: TestHost, workflowId: string): void {
  test.inbox.requeued(async (request) => {
    const queued: NormalizedItem[] = [];
    for (const [itemId, row] of test.statuses.rows) {
      if (test.statuses.rowStatus.get(itemId) !== "received") continue;
      const state = await test.store.getItemState(
        test.scope,
        workflowId,
        itemId,
      );
      if (!state || state.parkedAtNode !== undefined) continue;
      const leaseUntil = state.leaseUntil;
      if (
        leaseUntil !== undefined &&
        Date.parse(leaseUntil) > test.clock.now().getTime()
      ) {
        continue;
      }
      queued.push(row);
    }
    return { ok: true, items: queued.slice(0, request.limit) };
  });
}

/** The final entry of a list that is known not to be empty. */
export function last<T>(list: readonly T[]): T {
  const entry = list[list.length - 1];
  if (entry === undefined) throw new Error("Expected a list with an entry.");
  return entry;
}

/** A thread an item can sit in, for a reply Wait to watch; one per id, so two items never share a thread. */
export function threadOf(id: string): { channelId: string; threadTs: string } {
  return { channelId: "C0THREAD", threadTs: `1760000000.${id.padEnd(6, "0")}` };
}

/** A valid item that sits in its own thread. */
export function threadedItem(
  id: string,
  overrides: Partial<NormalizedItem> = {},
): NormalizedItem {
  return normalizedItem(id, { thread: threadOf(id), ...overrides });
}

/**
 * trigger -> source -> the nodes in `before` (single-output, in turn) -> one
 * Wait -> an End on each of the Wait's ports: `done` for the port that means
 * the wait ended well, `needsManual` for `timedOut`. The Ends are named
 * `end_<port>`.
 */
export function waitGraph(
  wait: Record<string, unknown>,
  options: {
    before?: NodeSpec[];
    trigger?: Record<string, unknown>;
    settings?: Record<string, unknown>;
    source?: Record<string, unknown>;
    /** Extra settings for every End, such as a `reason` that reads what an earlier node attached. */
    ends?: Record<string, unknown>;
  } = {},
): WorkflowGraph {
  const ports = portsFor(parseNode("wait", wait));
  const before = options.before ?? [];
  const nodes: NodeSpec[] = [
    ["start", "trigger", options.trigger ?? EVERY_5M],
    ["src", "source", options.source ?? providerQuery()],
    ...before,
    ["pause", "wait", wait],
    ...ports.map(
      (port): NodeSpec => [
        `end_${port}`,
        "end",
        endWith(port === "timedOut" ? "needsManual" : "done", options.ends),
      ],
    ),
  ];
  const chained = ["src", ...before.map(([name]) => name), "pause"];
  const edges: [string, string, string][] = [["start", "out", "src"]];
  for (let index = 1; index < chained.length; index += 1) {
    edges.push([chained[index - 1], "out", chained[index]]);
  }
  for (const port of ports) edges.push(["pause", port, `end_${port}`]);
  return buildGraph({
    nodes,
    edges,
    ...(options.settings ? { settings: options.settings } : {}),
  });
}
