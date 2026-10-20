import type { RunRecord, WorkflowHost, WorkflowScope } from "../adapter.js";
import type { RunMode, WorkflowGraph } from "../contract.js";
import { loopsOf } from "./graph-order.js";
import { ItemRuntime } from "./item-runtime.js";
import { createRunBudget } from "./run-budget.js";
import { bindInvariantReporter } from "./tripwire.js";
import type { RunWindow, StopReason, TickContext } from "./types.js";

const MINUTE_MS = 60_000;
const MAX_EARLY_MS = 30_000;

/**
 * How early a tick may come and still find parked items due: a tick that
 * starts a few seconds before the previous start plus the cadence is not a
 * reason to leave an item waiting another whole cadence. A tenth of the check
 * cadence, at most 30 seconds: scheduler jitter is seconds, and a wait that
 * is due a minute from now is not due.
 */
function earlyToleranceMs(graph: WorkflowGraph): number {
  return Math.min(
    MAX_EARLY_MS,
    (graph.settings.checkCadenceMinutes * MINUTE_MS) / 10,
  );
}

/** The instant parked items are measured against: now, and a little after it. */
export function dueCutoff(now: Date, graph: WorkflowGraph): string {
  return new Date(now.getTime() + earlyToleranceMs(graph)).toISOString();
}

/**
 * Everything a node needs to run: the host, the run, the item runtime, and the
 * model-call budget this run draws from. A resume pass builds the same
 * context, which is why the walker takes it rather than making it.
 */
export function createTickContext(args: {
  host: WorkflowHost;
  scope: WorkflowScope;
  workflowId: string;
  ownerEmail: string;
  graph: WorkflowGraph;
  graphVersion: number;
  run: RunRecord;
  mode: RunMode;
  window: RunWindow;
  scheduledFor: string | null;
  signal?: AbortSignal;
}): TickContext {
  const { host } = args;
  const signal = args.signal ?? new AbortController().signal;
  const invariantBroken = bindInvariantReporter(host.tripwire, {
    workflowId: args.workflowId,
    runId: args.run.id,
  });
  const runtime = new ItemRuntime({
    store: host.store,
    scope: args.scope,
    workflowId: args.workflowId,
    runId: args.run.id,
    graphVersion: args.graphVersion,
    mode: args.mode,
    leasedBy: host.ids.next("lease"),
    items: host.items,
    signal,
    now: () => host.clock.now(),
    invariantBroken,
  });
  return {
    host,
    scope: args.scope,
    workflowId: args.workflowId,
    ownerEmail: args.ownerEmail,
    graphVersion: args.graphVersion,
    graph: args.graph,
    loops: loopsOf(args.graph),
    run: args.run,
    mode: args.mode,
    window: args.window,
    scheduledFor: args.scheduledFor,
    runtime,
    budget: createRunBudget(args.graph.settings.modelCallCap),
    signal,
    now: () => host.clock.now(),
    dueNow: () =>
      new Date(host.clock.now().getTime() + earlyToleranceMs(args.graph)),
    invariantBroken,
    stopReason: (): StopReason | null => {
      if (host.shouldStop()) {
        return {
          code: "budget_paused",
          message: "The soft deadline passed before this run finished.",
        };
      }
      return signal.aborted
        ? {
            code: "budget_paused",
            message: "The run was aborted at its hard deadline.",
          }
        : null;
    },
  };
}
