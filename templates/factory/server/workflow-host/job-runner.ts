import { isValidCron, nextOccurrence } from "@agent-native/core/jobs";
import type {
  JobRunner,
  JobRunnerContext,
  JobRunnerResult,
} from "@agent-native/core/server";

import { getDb } from "../db/index.js";
import { factoryIdFromAutomationName } from "../lib/factory-automation-resources.js";
import {
  createTripwireSink,
  flushTripwires,
  type TripwireSink,
} from "../tripwire/index.js";
import {
  WorkflowStoreError,
  type RunError,
  type WorkflowHost,
  type WorkflowRecord,
  type WorkflowScope,
  type WorkflowStore,
} from "../workflow/adapter.js";
import {
  SCHEDULE_STARTER,
  type RunMode,
  type RunTriggerKind,
} from "../workflow/contract.js";
import {
  runTick,
  type SampleItem,
  type TickResult,
} from "../workflow/engine/index.js";
import {
  createFactoryWorkflowHost,
  type FactoryWorkflowHostDeps,
} from "./create-host.js";
import { getWorkflowStore } from "./factory-store.js";
import { findOverdueWakes } from "./read-models/overdue.js";
import {
  WorkflowRunFailure,
  createSampleItemLoader,
  resolveManualRun,
  type SampleItemLoader,
} from "./run-requests.js";

export interface WorkflowJobRunnerDeps {
  store?: () => WorkflowStore;
  createHost?: typeof createFactoryWorkflowHost;
  runTick?: typeof runTick;
  loadSampleItems?: SampleItemLoader;
  /** Passed to the host the runner builds. */
  hostDeps?: FactoryWorkflowHostDeps;
  /** Where a warning that is not a failure goes. */
  log?: (message: string) => void;
  /** Epoch ms; read once per tick, to tell how late the scheduler started it. */
  now?: () => number;
  /** Runs at the end of every tick. Defaults to the shared tripwire recorder's flush. */
  flush?: () => Promise<void>;
}

interface RunPlan {
  mode: RunMode;
  triggerKind: RunTriggerKind;
  startedBy: string;
  tickKey: string;
  testNodeId?: string;
  sampleItems: SampleItem[];
  scheduledFor?: string;
}

function storeFailure(error: WorkflowStoreError): WorkflowRunFailure {
  return new WorkflowRunFailure(
    error.code === "corrupt_record"
      ? "workflow_graph_unreadable"
      : `workflow_store_${error.code}`,
    error.message,
    { ...error.details },
    error,
  );
}

const MINUTE_MS = 60_000;

/**
 * A scheduled tick that started after the instant following its own was
 * already due: the scheduler skipped at least one whole tick. The instant a
 * tick was due is the job file's `nextRun`, which core passes as
 * `scheduledFor` and leaves untouched until a tick runs, so a gap shows up as
 * lateness with no history to read. (The run history cannot answer this: core
 * evicts skipped ticks once a job has enough real runs.)
 */
function noteMissedTick(
  ctx: JobRunnerContext,
  workflowId: string,
  startedAt: number,
  tripwire: TripwireSink,
): void {
  const { schedule, timezone } = ctx.meta;
  if (ctx.manual || ctx.scheduledFor === null) return;
  const dueAt = Date.parse(ctx.scheduledFor);
  if (!schedule || !isValidCron(schedule) || Number.isNaN(dueAt)) return;
  const cadenceMs =
    nextOccurrence(schedule, new Date(dueAt), timezone).getTime() - dueAt;
  const lateMs = startedAt - dueAt;
  if (lateMs <= cadenceMs) return;
  tripwire({
    area: "scheduler",
    code: "tick_missed",
    severity: "warn",
    workflowId,
    details: {
      lateMinutes: Math.floor(lateMs / MINUTE_MS),
      cadenceMinutes: Math.round(cadenceMs / MINUTE_MS),
      schedule,
    },
  });
}

/**
 * The host, with a look at the due parked items the engine's resume pass is
 * handed: when some woke more than two check cadences after their time, one
 * `wait_overdue` is recorded for the tick. The list itself is passed on as it
 * came.
 */
function watchDueWakes(
  host: WorkflowHost,
  workflow: WorkflowRecord,
  tripwire: TripwireSink,
): WorkflowHost {
  return {
    ...host,
    store: {
      ...host.store,
      async listDueParked(scope, query) {
        const due = await host.store.listDueParked(scope, query);
        const overdue = findOverdueWakes(
          due,
          Date.parse(query.now),
          workflow.graph.settings.checkCadenceMinutes,
        );
        if (overdue) {
          tripwire({
            area: "scheduler",
            code: "wait_overdue",
            severity: "warn",
            workflowId: workflow.id,
            details: { ...overdue },
          });
        }
        return due;
      },
    },
  };
}

/**
 * What core's scheduler reads as a failure of a provider rather than of the
 * automation (`TRANSIENT_FAILURE_CODES` in core's `automation-outcome.ts`). The
 * job still backs off and pauses after five, but the pause lifts itself on a
 * timed probe, so waiting items are not stranded. Any other code is a plain
 * runtime failure that stays paused until a person turns the job back on.
 */
const TRANSIENT_FAILURE_CODE = "provider_network_error";

interface RetryableFailures {
  host: WorkflowHost;
  /** Whether the call that failed the run said a later attempt might not fail. */
  includes(error: RunError): boolean;
}

/**
 * The host, noting each provider call and inbox read that failed as
 * retryable. A failed run keeps only a code and a message, so this is how it
 * is told apart from a problem a person has to fix. A message is matched
 * either way round because the run's copy may have been cut.
 */
function watchRetryableFailures(host: WorkflowHost): RetryableFailures {
  const seen: { code: string; message: string }[] = [];
  const note = (result: {
    ok: boolean;
    retryable?: boolean;
    code?: string;
    message?: string;
  }) => {
    if (!result.ok && result.retryable && result.code && result.message) {
      seen.push({ code: result.code, message: result.message });
    }
  };
  return {
    host: {
      ...host,
      operations: {
        async execute(request) {
          const result = await host.operations.execute(request);
          note(result);
          return result;
        },
      },
      inbox: {
        async take(request) {
          const result = await host.inbox.take(request);
          note(result);
          return result;
        },
        async takeRequeued(request) {
          const result = await host.inbox.takeRequeued(request);
          note(result);
          return result;
        },
      },
    },
    includes: (error) =>
      seen.some(
        (failure) =>
          failure.code === error.code &&
          (failure.message.startsWith(error.message) ||
            error.message.startsWith(failure.message)),
      ),
  };
}

function hasErrorCode(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { errorCode?: unknown }).errorCode === "string"
  );
}

/**
 * The function core runs, in place of the agent loop, for a job whose
 * frontmatter says `runner: workflow`. It turns one scheduler tick into one
 * engine tick and one core outcome:
 *
 * - succeeded, or paused at the soft deadline: `success` (a paused run keeps
 *   its `paused` status in the workflow's own run row; the next tick goes on);
 * - failed, or not runnable: thrown with an `errorCode`, so core records the
 *   failure and counts it toward pausing the job. A run that failed on a
 *   provider call the executor called retryable carries core's transient code,
 *   with the workflow's own code in the details;
 * - nothing due, or a tick key that already has a run: `skipped`.
 */
export function createWorkflowJobRunner(
  deps: WorkflowJobRunnerDeps = {},
): JobRunner {
  const getStore = deps.store ?? getWorkflowStore;
  const buildHost = deps.createHost ?? createFactoryWorkflowHost;
  const tick = deps.runTick ?? runTick;
  const loadSampleItems =
    deps.loadSampleItems ?? createSampleItemLoader(() => getDb());
  const log = deps.log ?? ((message) => console.warn(message));
  const now = deps.now ?? Date.now;
  const flush = deps.flush ?? flushTripwires;

  async function loadWorkflow(
    store: WorkflowStore,
    ctx: JobRunnerContext,
  ): Promise<{ scope: WorkflowScope; workflow: WorkflowRecord }> {
    const { triggerId, triggerName } = ctx.actionAutomation;
    const factoryId = factoryIdFromAutomationName(triggerName);
    if (!ctx.orgId || !factoryId) {
      throw new WorkflowRunFailure(
        "config_invalid",
        `"${ctx.name}" runs a workflow but does not belong to a factory in an organization, so there is no workflow to find.`,
      );
    }
    const scope: WorkflowScope = { orgId: ctx.orgId, factoryId };
    let workflow: WorkflowRecord | null;
    try {
      workflow = await store.getWorkflowByAutomation(scope, triggerId);
    } catch (error) {
      if (error instanceof WorkflowStoreError) throw storeFailure(error);
      throw error;
    }
    if (!workflow) {
      throw new WorkflowRunFailure(
        "config_invalid",
        `"${ctx.name}" runs a workflow, but no saved workflow belongs to this job. Save the workflow again, or delete the job.`,
        { automationId: triggerId },
      );
    }
    return { scope, workflow };
  }

  async function planRun(
    store: WorkflowStore,
    ctx: JobRunnerContext,
    scope: WorkflowScope,
    workflow: WorkflowRecord,
  ): Promise<RunPlan> {
    if (!ctx.manual) {
      if (ctx.scheduledFor === null) {
        throw new WorkflowRunFailure(
          "scheduled_for_required",
          `The scheduler started "${ctx.name}" without saying which tick it is, so the run could not be told from a repeat of it.`,
        );
      }
      return {
        mode: "live",
        triggerKind: "schedule",
        startedBy: SCHEDULE_STARTER,
        tickKey: ctx.scheduledFor,
        sampleItems: [],
        scheduledFor: ctx.scheduledFor,
      };
    }
    const manual = await resolveManualRun({
      store,
      scope,
      workflowId: workflow.id,
      historyId: ctx.historyId,
      loadSampleItems,
      log,
    });
    if (manual.kind === "plain") {
      return {
        mode: "live",
        triggerKind: "manual",
        startedBy: ctx.ownerEmail,
        tickKey: `manual:${ctx.historyId}`,
        sampleItems: [],
      };
    }
    return {
      mode: manual.mode,
      triggerKind: manual.triggerKind,
      startedBy: manual.startedBy,
      tickKey: `manual:${manual.request.id}`,
      ...(manual.testNodeId === undefined
        ? {}
        : { testNodeId: manual.testNodeId }),
      sampleItems: manual.sampleItems,
    };
  }

  async function settle(
    store: WorkflowStore,
    scope: WorkflowScope,
    workflow: WorkflowRecord,
    plan: RunPlan,
    result: TickResult,
    failures: RetryableFailures,
  ): Promise<JobRunnerResult> {
    switch (result.kind) {
      case "duplicate_tick":
        return {
          status: "skipped",
          reason: `Tick ${plan.tickKey} already has run ${result.run.id}.`,
          runId: result.run.id,
        };
      case "nothing_due":
        return { status: "skipped", reason: result.message };
      case "not_runnable":
        throw new WorkflowRunFailure(result.reason, result.message);
      case "ran": {
        const { run } = result;
        if (run.status === "failed") {
          const retryable = run.error && failures.includes(run.error);
          throw new WorkflowRunFailure(
            retryable
              ? TRANSIENT_FAILURE_CODE
              : (run.error?.code ?? "engine_error"),
            `Workflow run ${run.id} failed${run.error ? `: ${run.error.message}` : "."}`,
            {
              runId: run.id,
              ...(retryable ? { workflowCode: run.error?.code } : {}),
            },
          );
        }
        if (run.status === "paused") {
          log(
            `[workflow-job] run_paused: workflow run ${run.id} stopped early${run.error ? ` (${run.error.code}: ${run.error.message})` : ""}; the next tick goes on.`,
          );
        }
        if (plan.mode === "dry" && result.clean) {
          try {
            await store.recordCleanDryRun(scope, {
              workflowId: workflow.id,
              version: run.graphVersion,
            });
          } catch (error) {
            // A save landed while the dry run ran: this run proved the old
            // version, and the new one still needs its own.
            if (
              !(error instanceof WorkflowStoreError) ||
              error.code !== "stale_version"
            ) {
              throw error;
            }
            log(
              `[workflow-job] dry_run_not_recorded: workflow ${workflow.id} moved past version ${run.graphVersion} while the dry run ran, so it did not count.`,
            );
          }
        }
        return { status: "success", runId: run.id };
      }
    }
  }

  async function runOnce(ctx: JobRunnerContext): Promise<JobRunnerResult> {
    const store = getStore();
    const { scope, workflow } = await loadWorkflow(store, ctx);
    const tripwire =
      deps.hostDeps?.tripwire ??
      createTripwireSink({ scope, workflowId: workflow.id });
    noteMissedTick(ctx, workflow.id, now(), tripwire);
    await ctx.assertCanContinue();
    const plan = await planRun(store, ctx, scope, workflow);
    if (plan.mode === "live" && !workflow.enabled) {
      throw new WorkflowRunFailure(
        "workflow_disabled",
        `Workflow "${workflow.name}" is switched off, so it will not run for real. A dry run still works.`,
        { workflowId: workflow.id },
      );
    }
    await ctx.assertCanContinue();

    const failures = watchRetryableFailures(
      watchDueWakes(
        buildHost({
          scope,
          ownerEmail: ctx.ownerEmail,
          workflow,
          automation: ctx.actionAutomation,
          runId: ctx.historyId,
          historyRowId: ctx.historyId,
          mode: plan.mode,
          signal: ctx.signal,
          deadlineAt: ctx.deadlineAt,
          hardDeadlineAt: ctx.hardDeadlineAt,
          settings: workflow.graph.settings,
          deps: { ...deps.hostDeps, tripwire },
        }),
        workflow,
        tripwire,
      ),
    );
    let result: TickResult;
    try {
      result = await tick({
        host: failures.host,
        scope,
        workflowId: workflow.id,
        tickKey: plan.tickKey,
        mode: plan.mode,
        triggerKind: plan.triggerKind,
        startedBy: plan.startedBy,
        ...(plan.scheduledFor === undefined
          ? {}
          : { scheduledFor: plan.scheduledFor }),
        ...(plan.testNodeId === undefined
          ? {}
          : { testNodeId: plan.testNodeId }),
        ...(plan.mode === "test" ? { sampleItems: plan.sampleItems } : {}),
        signal: ctx.signal,
      });
    } catch (error) {
      // The engine has already marked its run failed; this is what core sees.
      if (hasErrorCode(error)) throw error;
      throw new WorkflowRunFailure(
        "engine_error",
        `The workflow engine stopped: ${error instanceof Error ? error.message : String(error)}`,
        { workflowId: workflow.id },
        error,
      );
    }
    return settle(store, scope, workflow, plan, result, failures);
  }

  // Events written near the end of a tick are still in flight when a
  // serverless function freezes, so every way out of a tick waits for them.
  return async (ctx) => {
    try {
      return await runOnce(ctx);
    } finally {
      await flush();
    }
  };
}
