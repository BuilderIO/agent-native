import {
  WORKFLOW_STORE_LIMITS,
  type RunCounts,
  type RunError,
  type RunRecord,
  type WorkflowHost,
  type WorkflowScope,
} from "../adapter.js";
import {
  WorkflowError,
  type ItemState,
  type RunMode,
  type RunTriggerKind,
  type StepRecord,
  type WorkflowErrorCode,
  type WorkflowGraph,
  type WorkflowNodeOfKind,
} from "../contract.js";
import { validateWorkflowGraph } from "../graph-validation.js";
import { nextTriggerDue } from "../schedule.js";
import { fitText } from "./bounds.js";
import { planGraph, type GraphPlan } from "./graph-order.js";
import { reapInterruptedRuns, runStaleAfterMs } from "./reap.js";
import { prepareResume } from "./resume.js";
import { createTickContext, dueCutoff } from "./tick-context.js";
import type { FlowItem, RunWindow } from "./types.js";
import { walkGraph, type WalkResult, type WalkSeed } from "./walker.js";
import { computeRunWindow } from "./window.js";

/** One pinned item for a test of a single node: its own fields and what upstream nodes would have attached. */
export interface SampleItem {
  id: string;
  item: Readonly<Record<string, unknown>>;
  nodes?: Readonly<Record<string, unknown>>;
}

export interface RunTickInput {
  host: WorkflowHost;
  scope: WorkflowScope;
  workflowId: string;
  /** Unique per workflow. A live tick uses its scheduled instant; any other run, a fresh key. */
  tickKey: string;
  mode: RunMode;
  /** What started the run, recorded on it. A live run is `schedule` or `manual`; a dry run `dry_run`; a test run `test`. */
  triggerKind: RunTriggerKind;
  /** `schedule` for a scheduled run, otherwise the email of whoever started it. */
  startedBy: string;
  /** Dry and test runs may name a saved version; a live run is always the current one. */
  graphVersion?: number;
  /** The instant a scheduled tick was scheduled for, which ends its window. Absent: now. */
  scheduledFor?: string;
  /** Test mode: the one node to run. */
  testNodeId?: string;
  sampleItems?: readonly SampleItem[];
  /** Aborts at the hard deadline. */
  signal?: AbortSignal;
}

export type NotRunnableReason =
  | "workflow_not_found"
  | "workflow_disabled"
  | "version_not_found"
  | "version_not_current"
  | "test_node_required"
  | "scheduled_for_required";

export type TickResult =
  /** The tick key already has a run. Nothing was started, read from a source, or written. */
  | { kind: "duplicate_tick"; run: RunRecord }
  /**
   * A scheduled tick with no work: the Trigger is not due and no parked item
   * has a deadline or check time that has come. No run is recorded; the
   * scheduler's own history says the tick was skipped.
   */
  | { kind: "nothing_due"; message: string }
  /** Nothing was started: there is nothing to record a run against. */
  | { kind: "not_runnable"; reason: NotRunnableReason; message: string }
  | {
      kind: "ran";
      /** Finished: `succeeded`, `paused` (stopped early, with why), or `failed`. */
      run: RunRecord;
      steps: StepRecord[];
      /** Every step succeeded. A dry run that is not clean cannot enable a workflow. */
      clean: boolean;
      /** Which passes this tick made: the new-items pass (the Trigger was due, or a manual run) and how many parked items the resume pass looked at. */
      passes: { trigger: boolean; resumed: number };
    };

type TriggerNode = WorkflowNodeOfKind<"trigger">;

function describeIssues(
  graph: WorkflowGraph,
  host: WorkflowHost,
): string | null {
  const validation = validateWorkflowGraph(graph, host.catalog);
  if (validation.ok) return null;
  const shown = validation.issues
    .slice(0, 5)
    .map(
      (issue) =>
        `${issue.code}${issue.nodeId ? ` at ${issue.nodeId}` : ""}${issue.detail ? ` (${issue.detail})` : ""}`,
    );
  const more = validation.issues.length - shown.length;
  return `${shown.join("; ")}${more > 0 ? `; and ${more} more` : ""}`;
}

type Prepared =
  | { ok: true; plan: GraphPlan; window: RunWindow; trigger: TriggerNode }
  | { ok: false; error: RunError };

const refuse = (code: WorkflowErrorCode, message: string): Prepared => ({
  ok: false,
  error: { code, message },
});

/** Everything that can be checked before any node runs, so a bad graph never runs partway. */
function prepare(args: {
  input: RunTickInput;
  graph: WorkflowGraph;
  lastTriggerAt: string | null;
  now: Date;
  /** The scheduled instant the Trigger is due for, which ends the window; null when it is not due or the run is not scheduled. */
  dueInstant: string | null;
  /** The run looks for new items. A tick that only picks parked items up again does not, and has no window of its own to cover. */
  newPass: boolean;
}): Prepared {
  const { input, graph } = args;
  const invalid = describeIssues(graph, input.host);
  if (invalid !== null) {
    return refuse("graph_invalid", `The graph does not validate: ${invalid}.`);
  }
  if (
    input.mode === "test" &&
    !graph.nodes.some((node) => node.id === input.testNodeId)
  ) {
    return refuse(
      "graph_invalid",
      `The node "${input.testNodeId}" is not in this version.`,
    );
  }

  const trigger = graph.nodes.find(
    (node): node is TriggerNode => node.kind === "trigger",
  );
  if (!trigger) return refuse("graph_invalid", "The graph has no trigger.");

  const lookback = graph.settings.lookbackMinutes;
  let end =
    args.dueInstant !== null
      ? new Date(args.dueInstant)
      : input.scheduledFor === undefined
        ? args.now
        : new Date(input.scheduledFor);
  if (Number.isNaN(end.getTime())) {
    return refuse(
      "engine_error",
      `"${input.scheduledFor}" is not a date-time.`,
    );
  }
  // A manual run that landed after this tick's instant has already covered it:
  // for a tick with no new items to look for, that is an empty window. A last
  // firing in the future is not that, and still fails in `computeRunWindow`.
  if (
    !args.newPass &&
    args.lastTriggerAt !== null &&
    Date.parse(args.lastTriggerAt) > end.getTime() &&
    Date.parse(args.lastTriggerAt) <= args.now.getTime()
  ) {
    end = new Date(args.lastTriggerAt);
  }
  const window = computeRunWindow({
    schedule: trigger.settings.schedule,
    timeZone: trigger.settings.timezone ?? graph.settings.timezone ?? "UTC",
    lastTriggerAt: args.lastTriggerAt,
    end,
    ...(lookback === undefined ? {} : { lookbackMinutes: lookback }),
  });
  if (!window.ok) return refuse("engine_error", window.message);
  try {
    return { ok: true, plan: planGraph(graph), window: window.window, trigger };
  } catch (error) {
    if (error instanceof WorkflowError) {
      return refuse(error.code, error.message);
    }
    throw error;
  }
}

/** What the Trigger says about a tick. `end` is the instant the window ends at, when the schedule names one. */
interface TriggerDue {
  run: boolean;
  end: string | null;
  /** The Trigger last fired at or after this tick's instant, so there is nothing for it to cover. */
  covered?: boolean;
}

const MIN_FIRST_RUN_LOOKBACK_MINUTES = 60;

/**
 * Whether a tick should look for new items. A manual, dry, or test run always
 * does. A scheduled tick does only when the Trigger has an instant it has
 * not fired for, so a tick that exists to wake parked items (the graph's check
 * cadence is shorter than the Trigger's) leaves the sources alone.
 *
 * A manual run can land after a tick's instant and before the sweep that
 * fires the tick, so the Trigger's last firing may already be at or past the
 * instant: that tick has nothing to cover and is not due.
 *
 * Anything else that makes the schedule unreadable here (no Trigger, a
 * scheduled instant that is not a date-time, a last firing in the future)
 * counts as due, so the run starts and fails loudly in `prepare` instead of
 * looking like a quiet tick.
 */
function triggerDueFor(args: {
  input: RunTickInput;
  graph: WorkflowGraph;
  lastTriggerAt: string | null;
  now: Date;
}): TriggerDue {
  const { input, graph, lastTriggerAt } = args;
  const always: TriggerDue = { run: true, end: null };
  if (input.triggerKind !== "schedule" || input.scheduledFor === undefined) {
    return always;
  }
  const trigger = graph.nodes.find(
    (node): node is TriggerNode => node.kind === "trigger",
  );
  const scheduled = Date.parse(input.scheduledFor);
  if (!trigger || Number.isNaN(scheduled)) return always;
  if (lastTriggerAt !== null) {
    const last = Date.parse(lastTriggerAt);
    if (last >= scheduled) {
      return last > args.now.getTime()
        ? always
        : { run: false, end: null, covered: true };
    }
  }
  const end = nextTriggerDue(
    trigger.settings,
    lastTriggerAt,
    input.scheduledFor,
    trigger.settings.timezone ?? graph.settings.timezone ?? "UTC",
    {
      firstRunLookbackMinutes: Math.max(
        MIN_FIRST_RUN_LOOKBACK_MINUTES,
        graph.settings.checkCadenceMinutes,
      ),
    },
  );
  return end === null ? { run: false, end: null } : { run: true, end };
}

function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return `${error.name}${typeof code === "string" ? ` [${code}]` : ""}: ${error.message}`;
  }
  return String(error);
}

/**
 * Runs one tick of a workflow: loads the graph, checks it, walks it once, and
 * records the run and every step through the store. It calls the outside world
 * only through `host`.
 *
 * A live tick makes up to two passes. The resume pass comes first: parked
 * items whose deadline or check time has come are looked at, and those whose
 * wait is over rejoin the graph at their Wait. The new-items pass runs the
 * Trigger, and only when it is due (a manual run always is). A scheduled tick
 * with neither pass to make returns `nothing_due` and records no run.
 *
 * A tick key that already has a run does nothing. A graph that fails
 * validation fails the run before any node runs. A step that cannot be trusted
 * fails the run; one item failing does not. A run that stopped early is
 * `paused`, never `succeeded`. An unexpected error (the store went away, a bug)
 * finishes the run `failed` with `engine_error` and is then thrown, so the
 * scheduler sees it too.
 */
export async function runTick(input: RunTickInput): Promise<TickResult> {
  const { host, scope, workflowId, tickKey, mode } = input;
  const notRunnable = (
    reason: NotRunnableReason,
    message: string,
  ): TickResult => ({ kind: "not_runnable", reason, message });

  const workflow = await host.store.getWorkflow(scope, workflowId);
  if (!workflow) {
    return notRunnable(
      "workflow_not_found",
      `Workflow "${workflowId}" was not found.`,
    );
  }
  await reapInterruptedRuns(host, scope, workflowId);
  let graph = workflow.graph;
  let graphVersion = workflow.version;
  if (mode === "live") {
    if (!workflow.enabled) {
      return notRunnable(
        "workflow_disabled",
        `Workflow "${workflowId}" is not enabled.`,
      );
    }
    if (
      input.graphVersion !== undefined &&
      input.graphVersion !== workflow.version
    ) {
      return notRunnable(
        "version_not_current",
        `A live run uses the current version (${workflow.version}), not ${input.graphVersion}.`,
      );
    }
  } else if (
    input.graphVersion !== undefined &&
    input.graphVersion !== workflow.version
  ) {
    const saved = await host.store.getWorkflowVersion(
      scope,
      workflowId,
      input.graphVersion,
    );
    if (!saved) {
      return notRunnable(
        "version_not_found",
        `Version ${input.graphVersion} of workflow "${workflowId}" was not found.`,
      );
    }
    graph = saved.graph;
    graphVersion = saved.version;
  }
  if (mode === "test" && !input.testNodeId) {
    return notRunnable(
      "test_node_required",
      "A test run names the node to run.",
    );
  }
  if (input.triggerKind === "schedule" && input.scheduledFor === undefined) {
    return notRunnable(
      "scheduled_for_required",
      "A scheduled run names the instant it was scheduled for.",
    );
  }

  // What is there to do, decided before a run row exists so that a tick with
  // nothing to do leaves no trace but the scheduler's own.
  const trigger = triggerDueFor({
    input,
    graph,
    lastTriggerAt: workflow.lastTriggerAt,
    now: host.clock.now(),
  });
  const dueParked: ItemState[] =
    mode === "live"
      ? await host.store.listDueParked(scope, {
          workflowId,
          now: dueCutoff(host.clock.now(), graph),
          limit: WORKFLOW_STORE_LIMITS.dueParkedMax,
        })
      : [];
  if (mode === "live" && !trigger.run && dueParked.length === 0) {
    return {
      kind: "nothing_due",
      message: trigger.covered
        ? `Nothing due: a run that started after this tick's instant already covered it (the Trigger last fired at ${workflow.lastTriggerAt}) and no parked item has a deadline or check time that has passed.`
        : "Nothing due: the Trigger has not come round again and no parked item has a deadline or check time that has passed.",
    };
  }

  const started = await host.store.startRun(scope, {
    workflowId,
    tickKey,
    mode,
    triggerKind: input.triggerKind,
    startedBy: input.startedBy,
    graphVersion,
    startedAt: host.clock.now().toISOString(),
  });
  if (!started.created) {
    // A finished run is a plain redelivery; one still running is a second tick on the same key.
    if (started.run.status === "running") {
      const ageMs =
        host.clock.now().getTime() - Date.parse(started.run.startedAt);
      // Past the time a tick can run, a row still `running` is a tick that
      // died, which another tick is not on.
      if (ageMs <= runStaleAfterMs(host)) {
        host.tripwire?.({
          area: "engine",
          code: "engine_invariant",
          invariant: "tick_overlap",
          severity: "warn",
          workflowId,
          runId: started.run.id,
          details: { reason: "same_tick_key_still_running", ageMs },
        });
      }
    }
    return { kind: "duplicate_tick", run: started.run };
  }
  const run = started.run;
  const stamp = () => host.clock.now().toISOString();

  const newPass = mode !== "live" || trigger.run;
  const prepared = prepare({
    input,
    graph,
    lastTriggerAt: workflow.lastTriggerAt,
    now: host.clock.now(),
    dueInstant: trigger.end,
    newPass,
  });
  if (!prepared.ok) {
    const finished = await host.store.finishRun(scope, {
      runId: run.id,
      status: "failed",
      counts: {},
      error: prepared.error,
      finishedAt: stamp(),
    });
    return {
      kind: "ran",
      run: finished,
      steps: [],
      clean: false,
      passes: { trigger: false, resumed: 0 },
    };
  }

  const ctx = createTickContext({
    host,
    scope,
    workflowId,
    ownerEmail: workflow.ownerEmail,
    graph,
    graphVersion,
    run,
    mode,
    window: prepared.window,
    scheduledFor: input.scheduledFor ?? null,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const { runtime, budget } = ctx;
  const counts = (): RunCounts => ({
    taken: runtime.taken,
    done: runtime.ended.done,
    dismissed: runtime.ended.dismissed,
    needsManual: runtime.ended.needsManual,
    released: runtime.ended.released,
    itemFailures: runtime.failed,
    // Rows a provider sent that could not be read are rows to check, the same as items flagged by a write.
    needsCheck: runtime.needsCheck + runtime.skippedRows,
    skippedRows: runtime.skippedRows,
    modelCalls: budget.usedModelCalls(),
    parked: runtime.parked,
    woke: runtime.woke,
    stillWaiting: runtime.stillWaiting,
    sentBack: runtime.sentBack,
    loopLimited: runtime.loopLimited,
    graphChanged: runtime.graphChanged,
    retryParked: runtime.retryParked,
    retried: runtime.retried,
    setAside: runtime.setAside,
    continued: runtime.continued,
    heldBack: runtime.heldBack,
  });

  const seeds: WalkSeed[] =
    mode === "test"
      ? [
          {
            kind: "input",
            nodeId: input.testNodeId ?? "",
            items: (input.sampleItems ?? []).map(
              (sample): FlowItem => ({
                id: sample.id,
                data: sample.item,
                nodes: sample.nodes ?? {},
                inbox: false,
              }),
            ),
          },
        ]
      : newPass
        ? [{ kind: "input", nodeId: prepared.trigger.id, items: [] }]
        : [];

  let walk: WalkResult | undefined;
  let crash: unknown;
  let resumed = 0;
  let holdBarriers = false;
  try {
    if (mode === "live") {
      const resume = await prepareResume(ctx, dueParked);
      seeds.push(...resume.seeds);
      resumed = resume.listed;
      holdBarriers = !resume.complete;
    }
    walk = await walkGraph(ctx, prepared.plan, seeds, {
      downstream: mode !== "test",
      holdBarriers,
    });
    if (walk.settled && mode === "live" && newPass) {
      await host.store.recordTriggerRun(scope, {
        workflowId,
        at: prepared.window.end,
      });
      if (runtime.cursorsHeld.length > 0) {
        ctx.invariantBroken({
          invariant: "cursor_not_advanced_after_complete_run",
          severity: "warn",
          nodeId: runtime.cursorsHeld[0],
          details: {
            reason: "items_past_bound",
            sources: runtime.cursorsHeld.length,
          },
        });
      }
    }
  } catch (error) {
    crash = error;
  }

  // Events written before a failure are the trail of what happened; keep them,
  // and give the leases back either way so the items can be taken again.
  try {
    await runtime.flushEvents();
    await runtime.releaseAll();
  } catch (error) {
    crash ??= error;
  }

  if (crash !== undefined || walk === undefined) {
    const message = describeFailure(crash);
    try {
      await host.store.finishRun(scope, {
        runId: run.id,
        status: "failed",
        counts: counts(),
        error: { code: "engine_error", message: fitText(message, 900) },
        finishedAt: stamp(),
      });
    } catch (finishError) {
      throw new Error(
        `${message}; the run also could not be marked failed (${describeFailure(finishError)}).`,
      );
    }
    throw crash;
  }

  const finished = await host.store.finishRun(scope, {
    runId: run.id,
    status: walk.status === "completed" ? "succeeded" : walk.status,
    counts: counts(),
    ...(walk.error ? { error: walk.error } : {}),
    finishedAt: stamp(),
  });
  return {
    kind: "ran",
    run: finished,
    steps: walk.steps,
    clean:
      finished.status === "succeeded" &&
      walk.steps.every((step) => step.status === "succeeded"),
    passes: { trigger: newPass, resumed },
  };
}
