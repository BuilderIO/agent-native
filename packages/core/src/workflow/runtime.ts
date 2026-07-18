import {
  claimNextScheduledWork,
  claimNextWorkflowExecution,
  finalizeScheduledWork,
  finalizeWorkflowExecution,
  getWorkflowExecution,
  releaseWorkflowExecutionRetry,
  scheduleWorkflowWork,
  type ClaimedScheduledWork,
} from "./store.js";
import type {
  ClaimedWorkflowExecution,
  WorkflowExecutionStatus,
  WorkflowSubscriptionKind,
} from "./types.js";
import { subscribeWorkflowWake } from "./wake.js";

export interface WorkflowExecutionResult {
  status: Extract<
    WorkflowExecutionStatus,
    "succeeded" | "failed" | "retrying" | "unknown"
  >;
  errorMessage?: string;
}

export interface WorkflowExecutionHandler {
  kind: WorkflowSubscriptionKind;
  /** Optional subscription config domain, such as `content`. */
  domain?: string;
  execute(
    claim: ClaimedWorkflowExecution,
  ): Promise<WorkflowExecutionResult | void>;
}

export interface ScheduledWorkflowResult {
  status?: "completed" | "failed" | "dead_letter" | "pending";
  errorMessage?: string;
  dueAt?: number;
}

export interface ScheduledWorkflowHandler {
  workType: string;
  execute(claim: ClaimedScheduledWork): Promise<ScheduledWorkflowResult | void>;
}

export interface WorkflowRetryPolicy {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const HANDLERS_KEY = Symbol.for("@agent-native/core/workflow.handlers");
const SCHEDULED_HANDLERS_KEY = Symbol.for(
  "@agent-native/core/workflow.scheduled-handlers",
);

function handlers(): WorkflowExecutionHandler[] {
  const global = globalThis as typeof globalThis & {
    [HANDLERS_KEY]?: WorkflowExecutionHandler[];
  };
  return (global[HANDLERS_KEY] ??= []);
}

function scheduledHandlers(): ScheduledWorkflowHandler[] {
  const global = globalThis as typeof globalThis & {
    [SCHEDULED_HANDLERS_KEY]?: ScheduledWorkflowHandler[];
  };
  return (global[SCHEDULED_HANDLERS_KEY] ??= []);
}

/** Registers an effect executor, not a queue consumer or worker. */
export function registerWorkflowExecutionHandler(
  handler: WorkflowExecutionHandler,
): () => void {
  handlers().push(handler);
  return () => {
    const index = handlers().indexOf(handler);
    if (index >= 0) handlers().splice(index, 1);
  };
}

/** Register delayed work without introducing another timer or claim loop. */
export function registerScheduledWorkflowHandler(
  handler: ScheduledWorkflowHandler,
): () => void {
  if (handler.workType === "execution_retry") {
    throw new Error("execution_retry is reserved by the workflow runtime");
  }
  scheduledHandlers().push(handler);
  return () => {
    const index = scheduledHandlers().indexOf(handler);
    if (index >= 0) scheduledHandlers().splice(index, 1);
  };
}

function domainOf(claim: ClaimedWorkflowExecution): string | undefined {
  const domain = claim.subscription.config.domain;
  return typeof domain === "string" ? domain : undefined;
}

function findHandler(
  claim: ClaimedWorkflowExecution,
): WorkflowExecutionHandler | undefined {
  const domain = domainOf(claim);
  return handlers().find(
    (handler) =>
      handler.kind === claim.subscription.kind &&
      (handler.domain == null || handler.domain === domain),
  );
}

function retrySettings(policy: WorkflowRetryPolicy | undefined) {
  return {
    maxAttempts: Math.min(Math.max(policy?.maxAttempts ?? 3, 1), 20),
    baseDelayMs: Math.min(
      Math.max(policy?.baseDelayMs ?? 1_000, 1),
      60 * 60_000,
    ),
    maxDelayMs: Math.min(
      Math.max(policy?.maxDelayMs ?? 5 * 60_000, 1),
      24 * 60 * 60_000,
    ),
  };
}

function retryDelay(attempt: number, policy: WorkflowRetryPolicy | undefined) {
  const settings = retrySettings(policy);
  return Math.min(
    settings.baseDelayMs * 2 ** Math.max(attempt - 1, 0),
    settings.maxDelayMs,
  );
}

async function deferExecutionRetry(input: {
  claim: ClaimedWorkflowExecution;
  errorMessage?: string;
  now: number;
  retryPolicy?: WorkflowRetryPolicy;
}): Promise<void> {
  const settings = retrySettings(input.retryPolicy);
  if (input.claim.attempt >= settings.maxAttempts) {
    await finalizeWorkflowExecution({
      executionId: input.claim.id,
      leaseToken: input.claim.leaseToken,
      fenceVersion: input.claim.fenceVersion,
      status: "failed",
      errorMessage: input.errorMessage ?? "Workflow retry limit exhausted",
      now: input.now,
    });
    return;
  }

  await scheduleWorkflowWork({
    workType: "execution_retry",
    subjectKey: input.claim.event.subjectKey,
    eventId: input.claim.eventId,
    subscriptionId: input.claim.subscriptionId,
    payload: {
      executionId: input.claim.id,
      expectedAttempt: input.claim.attempt,
    },
    dedupeKey: `execution_retry:${input.claim.id}`,
    dueAt: input.now + retryDelay(input.claim.attempt, input.retryPolicy),
    now: input.now,
  });
  await finalizeWorkflowExecution({
    executionId: input.claim.id,
    leaseToken: input.claim.leaseToken,
    fenceVersion: input.claim.fenceVersion,
    status: "retrying",
    errorMessage: input.errorMessage,
    now: input.now,
  });
}

/** Claims and executes one immediate durable execution. */
export async function processNextWorkflowExecution(options: {
  workerId: string;
  leaseMs?: number;
  now?: number;
  retryPolicy?: WorkflowRetryPolicy;
}): Promise<ClaimedWorkflowExecution | null> {
  const claim = await claimNextWorkflowExecution(options);
  if (!claim) return null;
  const now = options.now ?? Date.now();
  const handler = findHandler(claim);
  if (!handler) {
    await finalizeWorkflowExecution({
      executionId: claim.id,
      leaseToken: claim.leaseToken,
      fenceVersion: claim.fenceVersion,
      status: "unknown",
      errorMessage: `No workflow handler registered for ${claim.subscription.kind}:${domainOf(claim) ?? "*"}`,
      now,
    });
    return claim;
  }
  try {
    const outcome = (await handler.execute(claim)) ?? { status: "succeeded" };
    if (outcome.status === "retrying") {
      await deferExecutionRetry({
        claim,
        errorMessage: outcome.errorMessage,
        now,
        retryPolicy: options.retryPolicy,
      });
    } else {
      await finalizeWorkflowExecution({
        executionId: claim.id,
        leaseToken: claim.leaseToken,
        fenceVersion: claim.fenceVersion,
        status: outcome.status,
        errorMessage: outcome.errorMessage,
        now,
      });
    }
  } catch (error) {
    await deferExecutionRetry({
      claim,
      errorMessage: error instanceof Error ? error.message : String(error),
      now,
      retryPolicy: options.retryPolicy,
    });
  }
  return claim;
}

async function executeScheduledWork(
  claim: ClaimedScheduledWork,
  options: {
    now: number;
    retryPolicy?: WorkflowRetryPolicy;
  },
): Promise<void> {
  if (claim.workType === "execution_retry") {
    const executionId = claim.payload.executionId;
    const expectedAttempt = claim.payload.expectedAttempt;
    if (
      typeof executionId !== "string" ||
      typeof expectedAttempt !== "number"
    ) {
      await finalizeScheduledWork({
        ...claim,
        status: "dead_letter",
        errorMessage: "Invalid execution retry payload",
        now: options.now,
      });
      return;
    }
    const released = await releaseWorkflowExecutionRetry({
      executionId,
      expectedAttempt,
      now: options.now,
    });
    if (!released) {
      const execution = await getWorkflowExecution(executionId);
      if (
        execution?.status === "running" &&
        execution.attempt === expectedAttempt
      ) {
        await finalizeScheduledWork({
          ...claim,
          status: "pending",
          dueAt: Math.max(
            execution.leaseExpiresAt ?? options.now + 1_000,
            options.now + 1,
          ),
          now: options.now,
        });
        return;
      }
    }
    await finalizeScheduledWork({
      ...claim,
      status: "completed",
      now: options.now,
    });
    return;
  }

  const handler = scheduledHandlers().find(
    (candidate) => candidate.workType === claim.workType,
  );
  if (!handler) {
    await finalizeScheduledWork({
      ...claim,
      status: "dead_letter",
      errorMessage: `No scheduled workflow handler registered for ${claim.workType}`,
      now: options.now,
    });
    return;
  }
  try {
    const result = (await handler.execute(claim)) ?? { status: "completed" };
    const status = result.status ?? "completed";
    await finalizeScheduledWork({
      ...claim,
      status,
      errorMessage: result.errorMessage,
      dueAt:
        status === "pending"
          ? (result.dueAt ??
            options.now + retryDelay(claim.attempt, options.retryPolicy))
          : result.dueAt,
      now: options.now,
    });
  } catch (error) {
    const settings = retrySettings(options.retryPolicy);
    const exhausted = claim.attempt >= settings.maxAttempts;
    await finalizeScheduledWork({
      ...claim,
      status: exhausted ? "dead_letter" : "pending",
      errorMessage: error instanceof Error ? error.message : String(error),
      dueAt: exhausted
        ? undefined
        : options.now + retryDelay(claim.attempt, options.retryPolicy),
      now: options.now,
    });
  }
}

/**
 * Process one row through the sole workflow claim engine. Due scheduled work is
 * drained before immediate executions, so delays, debounce, escalation, and
 * retries all share the same lease authority.
 */
export async function processNextWorkflowWork(options: {
  workerId: string;
  leaseMs?: number;
  now?: number;
  retryPolicy?: WorkflowRetryPolicy;
}): Promise<
  | { kind: "scheduled"; claim: ClaimedScheduledWork }
  | { kind: "execution"; claim: ClaimedWorkflowExecution }
  | null
> {
  const now = options.now ?? Date.now();
  const scheduled = await claimNextScheduledWork({ ...options, now });
  if (scheduled) {
    await executeScheduledWork(scheduled, {
      now,
      retryPolicy: options.retryPolicy,
    });
    return { kind: "scheduled", claim: scheduled };
  }
  const execution = await processNextWorkflowExecution({ ...options, now });
  return execution ? { kind: "execution", claim: execution } : null;
}

/** Drain a bounded batch through the one workflow claim engine. */
export async function drainWorkflowWork(options: {
  workerId: string;
  leaseMs?: number;
  maxItems?: number;
  maxDurationMs?: number;
  retryPolicy?: WorkflowRetryPolicy;
}): Promise<{ processed: number; exhausted: boolean }> {
  const maxItems = Math.min(Math.max(options.maxItems ?? 25, 1), 500);
  const maxDurationMs = Math.min(
    Math.max(options.maxDurationMs ?? 20_000, 100),
    50_000,
  );
  const deadline = Date.now() + maxDurationMs;
  let processed = 0;
  while (processed < maxItems && Date.now() < deadline) {
    const work = await processNextWorkflowWork(options);
    if (!work) return { processed, exhausted: true };
    processed += 1;
  }
  return { processed, exhausted: false };
}

/** Connect wake hints and a safety sweep to the one durable claim engine. */
export function startWorkflowWakeProcessor(options: {
  workerId: string;
  leaseMs?: number;
  maxPerWake?: number;
  pollIntervalMs?: number;
  wakeDelayMs?: number;
  busyRetryDelayMs?: number;
  retryPolicy?: WorkflowRetryPolicy;
  onError?: (error: unknown) => void;
}): () => void {
  let draining = false;
  let stopped = false;
  let pendingDrain: ReturnType<typeof setTimeout> | undefined;
  const wakeDelayMs = Math.min(Math.max(options.wakeDelayMs ?? 25, 0), 5_000);
  const busyRetryDelayMs = Math.min(
    Math.max(options.busyRetryDelayMs ?? 100, 1),
    30_000,
  );
  const isBusyError = (error: unknown) =>
    error instanceof Error &&
    /(?:database is locked|database is busy|SQLITE_BUSY)/i.test(error.message);
  const scheduleDrain = (delayMs = wakeDelayMs) => {
    if (stopped) return;
    if (pendingDrain) clearTimeout(pendingDrain);
    pendingDrain = setTimeout(() => {
      pendingDrain = undefined;
      void drain();
    }, delayMs);
    pendingDrain.unref?.();
  };
  const drain = async () => {
    if (draining || stopped) {
      if (!stopped) scheduleDrain();
      return;
    }
    draining = true;
    try {
      await drainWorkflowWork({
        ...options,
        maxItems: options.maxPerWake,
        maxDurationMs: 20_000,
      });
    } catch (error) {
      if (isBusyError(error)) scheduleDrain(busyRetryDelayMs);
      else options.onError?.(error);
    } finally {
      draining = false;
    }
  };
  const unsubscribeWake = subscribeWorkflowWake(() => scheduleDrain());
  const pollIntervalMs = Math.min(
    Math.max(options.pollIntervalMs ?? 30_000, 1_000),
    5 * 60_000,
  );
  const timer = setInterval(() => scheduleDrain(), pollIntervalMs);
  timer.unref?.();
  scheduleDrain();
  return () => {
    stopped = true;
    unsubscribeWake();
    clearInterval(timer);
    if (pendingDrain) clearTimeout(pendingDrain);
  };
}

export function __resetWorkflowExecutionHandlers(): void {
  handlers().splice(0);
  scheduledHandlers().splice(0);
}
