/**
 * Agent Teams — sub-agent orchestration for agent-native.
 *
 * The main agent chat acts as an orchestrator. It spawns sub-agents
 * for individual tasks, which run in their own threads. Sub-agents
 * appear as rich preview cards (chips) inline in the main chat.
 *
 * This module provides the server-side infrastructure:
 * - Creating sub-agent threads and running them in background
 * - Tracking task status and results
 * - Emitting SSE events for live preview cards
 * - Bidirectional messaging between main agent and sub-agents
 *
 * Task state is persisted in application_state (SQL) so it survives
 * serverless cold starts and works across multiple processes.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { AgentEngine, EngineMessage } from "../agent/engine/types.js";
import type {
  ActionEntry,
  AgentLoopFinalResponseGuard,
} from "../agent/production-agent.js";
import { actionsToEngineTools } from "../agent/production-agent.js";
import {
  runAgentLoop,
  appendAgentLoopContinuation,
} from "../agent/production-agent.js";
import {
  abortRun,
  getActiveRunForThreadAsync,
  getRun,
  startRun,
  subscribeToRun,
  type ActiveRun,
} from "../agent/run-manager.js";
import { getRunEventsSince } from "../agent/run-store.js";
import { resolveMaxSubagentDelegationDepth } from "../agent/runtime-context.js";
import {
  buildAssistantMessage,
  foldAssistantTurn,
  threadDataToEngineMessages,
} from "../agent/thread-data-builder.js";
import type { AgentChatEvent } from "../agent/types.js";
import type { RunEvent } from "../agent/types.js";
import {
  readAppState,
  writeAppState,
  listAppState,
  deleteAppState,
} from "../application-state/script-helpers.js";
import { createThread } from "../chat-threads/store.js";
import type {
  BackgroundAgentRun,
  BackgroundAgentRunStatus,
  BackgroundAgentTranscriptEvent,
} from "../code-agents/background-run.js";
import type {
  BackgroundAgentController,
  BackgroundAgentControlInput,
  BackgroundAgentControlResult,
  BackgroundAgentFollowUpInput,
  ListBackgroundAgentRunsOptions,
} from "../code-agents/index.js";
import { describeDbError } from "../db/client.js";
import { resolveOrgIdForEmail } from "../org/context.js";
import {
  completeRun as completeProgressRun,
  startRun as startProgressRun,
  updateRunProgress,
} from "../progress/registry.js";
import {
  enqueueAgentTeamRun,
  claimAgentTeamRun,
  touchAgentTeamRun,
  bumpAgentTeamContinuation,
  completeAgentTeamRun,
  getAgentTeamRunDispatchState,
  listActiveAgentTeamTaskIdsForOwner,
  MAX_AGENT_TEAM_CONTINUATIONS,
  MAX_AGENT_TEAM_NO_PROGRESS_CONTINUATIONS,
  RUN_DISPATCH_STUCK_AFTER_MS,
  RUN_PROCESSING_STUCK_AFTER_MS,
  type AgentTeamRunPayload,
} from "./agent-teams-run-queue.js";
import {
  getRequestUserEmail,
  runWithRequestContext,
} from "./request-context.js";
import { fireInternalDispatch } from "./self-dispatch.js";

/**
 * Ambient delegation depth for the agent whose run is currently executing.
 *
 * `processAgentTeamRun` runs each sub-agent inside `runWithDelegationDepth(d)`
 * where `d` is that sub-agent's own depth. So if a sub-agent calls `spawnTask`
 * (e.g. because tool-stripping was bypassed and it was handed the `agent-teams`
 * tool anyway), the spawn path reads its parent's depth from here and refuses
 * once the cap is reached — independent of any tool-level guard. The top-level
 * chat runs outside this storage, so its ambient depth is 0.
 */
const delegationDepthStorage = new AsyncLocalStorage<number>();

/**
 * Run `fn` with `depth` recorded as the ambient delegation depth so any
 * `spawnTask` call made transitively from `fn` knows the depth of the agent
 * doing the spawning.
 */
function runWithDelegationDepth<T>(
  depth: number,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return delegationDepthStorage.run(Math.max(0, Math.floor(depth || 0)), fn);
}

/** Depth of the agent currently executing (0 = top-level chat). */
function currentAmbientDelegationDepth(): number {
  return delegationDepthStorage.getStore() ?? 0;
}

/**
 * Public read of the ambient sub-agent delegation depth for the currently
 * executing agent. 0 = the top-level (user-facing) chat; 1+ = a spawned
 * sub-agent. Used by the chat plugin to thread the depth into
 * `buildRuntimeContextPrompt` so a sub-agent at the cap is told it can't
 * delegate further. Mirrors `currentAmbientDelegationDepth`; exported under a
 * descriptive name so callers outside this module don't depend on the private
 * helper or the test-only export object.
 */
export function getCurrentDelegationDepth(): number {
  return currentAmbientDelegationDepth();
}

export interface SubagentDepthDecision {
  /** Whether the spawn is allowed under the depth cap. */
  allowed: boolean;
  /** Depth of the agent doing the spawning (parent). */
  parentDepth: number;
  /** Depth the spawned sub-agent would have (parentDepth + 1). */
  childDepth: number;
  /** The effective cap (resolved from env, clamped). */
  maxDepth: number;
  /** Human-readable refusal message when `allowed` is false. */
  error?: string;
}

/**
 * Decide whether an agent at `parentDepth` may spawn another sub-agent. The
 * child would sit at `parentDepth + 1`; a child deeper than `maxDepth` is
 * refused. Pure + exported so the enforcement is unit-testable and reusable.
 */
export function evaluateSubagentDepth(
  parentDepth: number,
  env: Record<string, string | undefined> = process.env,
): SubagentDepthDecision {
  const safeParentDepth = Number.isFinite(parentDepth)
    ? Math.max(0, Math.floor(parentDepth))
    : 0;
  const childDepth = safeParentDepth + 1;
  const maxDepth = resolveMaxSubagentDelegationDepth(env);
  const allowed = childDepth <= maxDepth;
  return {
    allowed,
    parentDepth: safeParentDepth,
    childDepth,
    maxDepth,
    error: allowed
      ? undefined
      : `Delegation depth limit reached (max ${maxDepth}); cannot spawn another sub-agent.`,
  };
}

/** Framework route the self-fire dispatch targets to run a queued sub-agent in
 * a fresh function invocation. Mounted inside the agent-chat plugin (where the
 * sub-agent action/prompt/engine closures live). */
export const AGENT_TEAM_PROCESS_RUN_PATH =
  "/_agent-native/agent-teams/_process-run";

/** Heartbeat cadence for the queue row while a chunk is actively processing. */
const RUN_QUEUE_HEARTBEAT_MS = 5_000;

export interface AgentTask {
  taskId: string;
  threadId: string;
  parentThreadId?: string;
  name?: string;
  description: string;
  status: "running" | "completed" | "errored";
  preview: string;
  summary: string;
  currentStep: string;
  createdAt: number;
  updatedAt?: number;
  startedAt?: number;
  completedAt?: number;
  runId?: string;
  error?: string;
  /**
   * Delegation depth of THIS sub-agent: 1 for a sub-agent spawned by the
   * top-level chat, 2 for a sub-agent spawned by a depth-1 sub-agent, etc.
   * Drives the runaway-delegation guardrail (see `evaluateSubagentDepth`).
   */
  delegationDepth?: number;
}

export type AgentTeamBackgroundRun = Omit<
  BackgroundAgentRun,
  | "kind"
  | "source"
  | "sourceRecord"
  | "status"
  | "cwd"
  | "goalId"
  | "transcriptPath"
  | "artifactRoot"
> & {
  kind: "agent-team";
  source: "hosted-agent-team";
  sourceRecord: {
    type: "agent-team-task";
    id: string;
    threadId: string;
  };
  status: BackgroundAgentRunStatus;
  cwd?: string;
  goalId: "agent-team";
  transcriptPath?: string;
  artifactRoot?: string;
};

export type AgentTeamBackgroundTranscriptEvent = Omit<
  BackgroundAgentTranscriptEvent,
  "kind" | "source" | "sourceRecord"
> & {
  kind: "user" | "system" | "note" | "artifact" | "status";
  source: "hosted-agent-team";
  sourceRecord: {
    type: "agent-team-run-event";
    id: string;
    seq: number;
  };
};

export interface SendToAgentTeamBackgroundRunResult {
  ok: boolean;
  error?: string;
  messageId?: string;
  queuedCount?: number;
}

export interface ControlAgentTeamBackgroundRunResult {
  ok: boolean;
  error?: string;
}

export function createAgentTeamBackgroundAgentController(): BackgroundAgentController {
  return {
    async list(options?: ListBackgroundAgentRunsOptions) {
      if (options?.goalId && options.goalId !== "agent-team") return [];
      return listAgentTeamBackgroundRuns();
    },
    get: getAgentTeamBackgroundRun,
    transcript: listAgentTeamBackgroundTranscriptEvents,
    sendFollowUp: sendAgentTeamBackgroundAgentFollowUp,
    control: controlAgentTeamBackgroundAgentRun,
  };
}

export const agentTeamBackgroundAgentController =
  createAgentTeamBackgroundAgentController();

/** Key prefix for task records: agent-task:{taskId} */
const TASK_PREFIX = "agent-task:";

/** Key prefix for thread→task reverse lookup: agent-task-thread:{threadId} */
const THREAD_PREFIX = "agent-task-thread:";

/** Key prefix for queued orchestrator→sub-agent messages. */
const TASK_MESSAGE_PREFIX = "task-message:";

/**
 * Key prefix for durable completion-injection entries that tell the parent
 * thread's next turn about a finished sub-agent. Pattern mirrors
 * `TASK_MESSAGE_PREFIX` (appstate key → JSON payload consumed once).
 *
 * Key: `parent-completion:{parentThreadId}:{injectionId}`
 * Value: `ParentCompletionInjection` JSON.
 */
const PARENT_COMPLETION_PREFIX = "parent-completion:";

/** Max chars of the sub-agent summary to include inline in the injection.
 * The orchestrator can always call read-result for the full output. */
const PARENT_COMPLETION_INLINE_MAX = 2_000;

export interface ParentCompletionInjection {
  id: string;
  taskId: string;
  taskName?: string;
  status: "completed" | "errored";
  hitContinuationLimit: boolean;
  summaryExcerpt: string;
  fullSummaryAvailable: boolean;
  timestamp: number;
}

function parentCompletionQueuePrefix(parentThreadId: string): string {
  return `${PARENT_COMPLETION_PREFIX}${parentThreadId}:`;
}

function generateInjectionId(): string {
  return `inj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Append a completion-injection entry to the parent thread's queue. */
async function appendParentCompletionInjection(
  parentThreadId: string,
  task: AgentTask,
  terminal: {
    taskStatus: "completed" | "errored";
    summary: string;
    hitContinuationLimit?: boolean;
  },
): Promise<void> {
  const id = generateInjectionId();
  const summaryExcerpt =
    terminal.summary.length > PARENT_COMPLETION_INLINE_MAX
      ? terminal.summary.slice(0, PARENT_COMPLETION_INLINE_MAX)
      : terminal.summary;
  const injection: ParentCompletionInjection = {
    id,
    taskId: task.taskId,
    taskName: task.name,
    status: terminal.taskStatus,
    hitContinuationLimit: terminal.hitContinuationLimit ?? false,
    summaryExcerpt,
    fullSummaryAvailable:
      terminal.summary.length > PARENT_COMPLETION_INLINE_MAX,
    timestamp: Date.now(),
  };
  await writeAppState(
    `${parentCompletionQueuePrefix(parentThreadId)}${id}`,
    injection as any,
  );
}

/** Format a parent-completion injection as a human-readable orchestrator
 * message. Mirrors `formatQueuedTaskMessages`. */
function formatParentCompletionInjection(
  inj: ParentCompletionInjection,
): string {
  const name = inj.taskName ? `"${inj.taskName}"` : `task ${inj.taskId}`;
  const statusLine =
    inj.status === "completed"
      ? inj.hitContinuationLimit
        ? `completed (reached continuation limit — partial result)`
        : `completed`
      : `failed`;
  const tail = inj.fullSummaryAvailable
    ? `\n\n(Full output truncated — call \`agent-teams\` action "read-result" with taskId "${inj.taskId}" to retrieve the complete result.)`
    : "";
  return `Sub-agent ${name} ${statusLine}:\n\n${inj.summaryExcerpt}${tail}`;
}

/**
 * Drain the parent-completion injection queue for a thread. Returns all
 * pending injections and deletes them atomically. Exported so the agent-chat
 * plugin can drain these into the orchestrator's next user-turn.
 */
export async function drainParentCompletionInjections(
  parentThreadId: string,
): Promise<ParentCompletionInjection[]> {
  const prefix = parentCompletionQueuePrefix(parentThreadId);
  const entries = await listAppState(prefix);
  if (entries.length === 0) return [];
  const injections: ParentCompletionInjection[] = [];
  for (const entry of entries) {
    const v = entry.value as Record<string, unknown>;
    if (
      typeof v.id === "string" &&
      typeof v.taskId === "string" &&
      typeof v.status === "string"
    ) {
      injections.push(v as unknown as ParentCompletionInjection);
      await deleteAppState(entry.key);
    }
  }
  return injections.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Format all drained parent-completion injections as a single user-turn
 * message to inject into the orchestrator thread.
 */
export function formatParentCompletionInjections(
  injections: ParentCompletionInjection[],
): string {
  return injections.map(formatParentCompletionInjection).join("\n\n---\n\n");
}

const TASK_RUN_MISSING_GRACE_MS = 60_000;

export interface QueuedTaskMessage {
  id: string;
  from: "orchestrator";
  message: string;
  timestamp: number;
}

function taskMessageQueuePrefix(taskId: string): string {
  return `${TASK_MESSAGE_PREFIX}${taskId}:`;
}

function generateTaskMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeQueuedTaskMessage(
  value: Record<string, unknown>,
  fallbackId: string,
): QueuedTaskMessage | null {
  if (typeof value.message !== "string" || value.message.trim().length === 0) {
    return null;
  }
  const timestamp =
    typeof value.timestamp === "number" && Number.isFinite(value.timestamp)
      ? value.timestamp
      : Date.now();
  return {
    id: typeof value.id === "string" ? value.id : fallbackId,
    from: "orchestrator",
    message: value.message,
    timestamp,
  };
}

function formatQueuedTaskMessages(messages: QueuedTaskMessage[]): string {
  const label =
    messages.length === 1
      ? "Orchestrator message received while you were working"
      : "Orchestrator messages received while you were working";
  const body = messages
    .map((message) => {
      const sentAt = new Date(message.timestamp).toISOString();
      return `[${sentAt}] ${message.message}`;
    })
    .join("\n\n");
  return `${label}:\n\n${body}\n\nAdjust your next steps to account for this update.`;
}

const taskMessageDrainLocks = new Map<string, Promise<unknown>>();

async function withTaskMessageDrainLock<T>(
  taskId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = taskMessageDrainLocks.get(taskId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => (release = resolve));
  taskMessageDrainLocks.set(taskId, current);
  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (taskMessageDrainLocks.get(taskId) === current) {
      taskMessageDrainLocks.delete(taskId);
    }
  }
}

async function listQueuedTaskMessages(
  taskId: string,
): Promise<Array<{ key: string; message: QueuedTaskMessage }>> {
  const queuePrefix = taskMessageQueuePrefix(taskId);
  const entries = await listAppState(queuePrefix);
  const messages = entries
    .map((entry) => {
      const id = entry.key.slice(queuePrefix.length);
      const message = normalizeQueuedTaskMessage(entry.value, id);
      return message ? { key: entry.key, message } : null;
    })
    .filter(
      (
        entry,
      ): entry is {
        key: string;
        message: QueuedTaskMessage;
      } => Boolean(entry),
    );

  // Backward compatibility for messages queued by the old implementation.
  const legacyKey = `${TASK_MESSAGE_PREFIX}${taskId}`;
  const legacy = await readAppState(legacyKey);
  const legacyMessage = legacy
    ? normalizeQueuedTaskMessage(legacy, "legacy")
    : null;
  if (legacyMessage) {
    messages.push({ key: legacyKey, message: legacyMessage });
  }

  return messages.sort((a, b) => {
    const byTimestamp = a.message.timestamp - b.message.timestamp;
    return byTimestamp || a.message.id.localeCompare(b.message.id);
  });
}

async function drainQueuedTaskMessages(
  taskId: string,
): Promise<QueuedTaskMessage[]> {
  return withTaskMessageDrainLock(taskId, async () => {
    const entries = await listQueuedTaskMessages(taskId);
    if (entries.length === 0) return [];
    for (const entry of entries) {
      await deleteAppState(entry.key);
    }
    return entries.map((entry) => entry.message);
  });
}

async function appendQueuedTaskMessage(
  taskId: string,
  message: string,
): Promise<{ messageId: string; queuedCount: number }> {
  const messageId = generateTaskMessageId();
  await writeAppState(`${taskMessageQueuePrefix(taskId)}${messageId}`, {
    id: messageId,
    from: "orchestrator",
    message,
    timestamp: Date.now(),
  });
  const queuedCount = (await listQueuedTaskMessages(taskId)).length;
  return { messageId, queuedCount };
}

function createMessageAwareActions(
  taskId: string,
  actions: Record<string, ActionEntry>,
): Record<string, ActionEntry> {
  return Object.fromEntries(
    Object.entries(actions).map(([name, entry]) => [
      name,
      {
        ...entry,
        run: async (args, context) => {
          // Sub-agents / agent-teams run through the production-agent loop, so
          // the loop already passes a full ctx with caller "tool". Forward it,
          // defaulting caller to "tool" if a caller invokes this wrapper without
          // a context object.
          const result = await entry.run(args, {
            ...context,
            caller: context?.caller ?? "tool",
          });
          const queuedMessages = await drainQueuedTaskMessages(taskId);
          if (queuedMessages.length === 0) return result;

          // Tool results are already the next safe model-visible boundary:
          // the loop records all tool output, then asks the model to continue.
          // Attaching queued updates here avoids mutating message history while
          // an assistant tool-call turn is still being resolved.
          const formatted = formatQueuedTaskMessages(queuedMessages);
          const resultText =
            typeof result === "string"
              ? result
              : JSON.stringify(result, null, 2);
          return `${resultText}\n\n${formatted}`;
        },
      },
    ]),
  );
}

function createTaskMessageFinalGuard(
  taskId: string,
): AgentLoopFinalResponseGuard {
  return async () => {
    const queuedMessages = await drainQueuedTaskMessages(taskId);
    if (queuedMessages.length === 0) return null;

    // This is queued delivery, not a live interrupt: if the sub-agent is
    // already producing a final answer, the guard asks the loop for one more
    // continuation that includes the orchestrator update as a fresh user turn.
    return {
      retryMessage: formatQueuedTaskMessages(queuedMessages),
      fallbackMessage:
        "I received an orchestrator update while finishing, but could not continue from it. Please check the task status and send the update again if needed.",
    };
  };
}

async function saveTask(task: AgentTask): Promise<void> {
  task.updatedAt = Date.now();
  await writeAppState(`${TASK_PREFIX}${task.taskId}`, task as any);
  await writeAppState(`${THREAD_PREFIX}${task.threadId}`, {
    taskId: task.taskId,
  });
}

async function loadTask(taskId: string): Promise<AgentTask | null> {
  const data = await readAppState(`${TASK_PREFIX}${taskId}`);
  return data ? (data as unknown as AgentTask) : null;
}

async function loadTaskByThread(threadId: string): Promise<AgentTask | null> {
  const ref = await readAppState(`${THREAD_PREFIX}${threadId}`);
  if (!ref || !ref.taskId) return null;
  return loadTask(ref.taskId as string);
}

function applyDispatchMetadataToTask(
  task: AgentTask,
  dispatch: Awaited<ReturnType<typeof getAgentTeamRunDispatchState>> | null,
): AgentTask {
  if (!dispatch) return task;
  const parentThreadId = dispatch.payload.parentThreadId?.trim();
  const name = dispatch.payload.name?.trim();
  if (parentThreadId && !task.parentThreadId) {
    task.parentThreadId = parentThreadId;
  }
  if (name && !task.name) {
    task.name = name;
  }
  return task;
}

async function completeReconciledTask(
  task: AgentTask,
  ownerEmail: string | null,
): Promise<AgentTask> {
  task.status = "completed";
  task.summary = task.summary || task.preview || "Task completed.";
  task.currentStep = "";
  task.completedAt = Date.now();
  await saveTask(task);
  if (ownerEmail) {
    await completeTaskProgressRun(
      task,
      ownerEmail,
      "succeeded",
      "Task completed.",
    );
  }
  return task;
}

async function failReconciledTask(
  task: AgentTask,
  ownerEmail: string | null,
  message: string,
  progressStatus: TerminalProgressStatus = "failed",
): Promise<AgentTask> {
  task.status = "errored";
  task.summary = task.summary || task.preview || message;
  task.error = task.error || message;
  task.currentStep = "";
  task.completedAt = Date.now();
  await saveTask(task);
  if (ownerEmail) {
    await completeTaskProgressRun(task, ownerEmail, progressStatus, message);
  }
  // Make the dispatch row terminal too so it isn't re-fired.
  await completeAgentTeamRun(task.taskId, "failed").catch(() => {});
  return task;
}

function subAgentDispatchFailureMessage(err: unknown): string {
  return err instanceof Error
    ? `Failed to start sub-agent: ${err.message}`
    : "Failed to start sub-agent.";
}

/**
 * Re-fire a dropped self-dispatch. When the queue row is still queued/running
 * but its heartbeat has gone stale (the self-fire never landed, or the
 * processing invocation died), kick the processor again before the hard
 * stuck-cutoff fail path gives up. Best-effort — the fail path is the backstop.
 */
async function refireStuckAgentTeamRunIfNeeded(
  task: AgentTask,
  dispatch: NonNullable<
    Awaited<ReturnType<typeof getAgentTeamRunDispatchState>>
  >,
  event?: any,
): Promise<void> {
  if (dispatch.status !== "queued" && dispatch.status !== "running") return;
  const idleFor = Date.now() - dispatch.updatedAt;
  if (idleFor < RUN_DISPATCH_STUCK_AFTER_MS) return; // still fresh — leave it
  if (idleFor >= RUN_PROCESSING_STUCK_AFTER_MS) return; // fail path owns this
  try {
    await fireInternalDispatch({
      event,
      path: AGENT_TEAM_PROCESS_RUN_PATH,
      taskId: task.taskId,
      body: { mode: dispatch.continuationCount > 0 ? "continue" : "start" },
    });
  } catch (err) {
    await failReconciledTask(
      task,
      dispatch.ownerEmail,
      subAgentDispatchFailureMessage(err),
    );
  }
}

/**
 * Reconcile a task that still reads "running" against the actual run state.
 *
 * Durable-dispatch path (the normal case): the `agent_team_run_queue` row is
 * the authority. While it's queued/running the task stays running (a single
 * completed agent_runs chunk at a soft-timeout boundary does NOT mean the task
 * finished — a continuation may be queued/in-flight). A dropped dispatch is
 * re-fired; a genuinely stalled one (past the hard cutoff) is failed.
 *
 * Legacy fallback (no queue row — pre-upgrade tasks, or the in-process
 * Cloudflare path): fall back to the in-memory/SQL run state via
 * `getActiveRunForThreadAsync`, with the original missing-run grace.
 */
async function reconcileTaskWithRun(
  task: AgentTask,
  event?: any,
): Promise<AgentTask> {
  let dispatch: Awaited<ReturnType<typeof getAgentTeamRunDispatchState>> = null;
  try {
    dispatch = await getAgentTeamRunDispatchState(task.taskId);
  } catch {
    dispatch = null;
  }
  applyDispatchMetadataToTask(task, dispatch);

  if (task.status !== "running") return task;

  if (dispatch) {
    const ownerEmail = dispatch.ownerEmail ?? getRequestUserEmail() ?? null;
    if (dispatch.status === "queued" || dispatch.status === "running") {
      const stuckFor = Date.now() - dispatch.updatedAt;
      if (stuckFor < RUN_PROCESSING_STUCK_AFTER_MS) {
        await refireStuckAgentTeamRunIfNeeded(task, dispatch, event);
        return task;
      }
      return await failReconciledTask(
        task,
        ownerEmail,
        "Sub-agent run stalled and did not produce a result.",
      );
    }
    if (dispatch.status === "failed") {
      return await failReconciledTask(
        task,
        ownerEmail,
        task.error || task.summary || "Sub-agent run failed.",
      );
    }
    // status === "done" but task still running — safety net (the processor
    // normally sets the task terminal before completing the queue row).
    return await completeReconciledTask(task, ownerEmail);
  }

  // ── Legacy fallback: no durable queue row ────────────────────────────────
  if (!task.runId) return task;
  let runState:
    | Awaited<ReturnType<typeof getActiveRunForThreadAsync>>
    | undefined;
  try {
    runState = await getActiveRunForThreadAsync(task.threadId);
  } catch {
    return task;
  }
  if (runState?.status === "running") return task;

  const ownerEmail = getRequestUserEmail() ?? null;
  if (runState?.status === "completed") {
    return await completeReconciledTask(task, ownerEmail);
  }
  if (runState?.status === "errored" || runState?.status === "aborted") {
    return await failReconciledTask(
      task,
      ownerEmail,
      runState.status === "aborted" ? "Task stopped." : "Task failed.",
      runState.status === "aborted" ? "cancelled" : "failed",
    );
  }

  const referenceAt = task.startedAt ?? task.createdAt;
  if (Date.now() - referenceAt < TASK_RUN_MISSING_GRACE_MS) return task;
  return await failReconciledTask(
    task,
    ownerEmail,
    "Sub-agent run is no longer active and did not produce a result.",
  );
}

/**
 * Reconcile all of an owner's in-flight sub-agent runs. Wired into the RunsTray
 * data path (`/_agent-native/runs`) so the tray self-heals: dropped dispatches
 * are re-fired and dead runs are marked failed promptly, even when the
 * orchestrator chat never polls `status`/`read-result`.
 */
export async function reconcileAgentTeamRunsForOwner(
  owner: string,
  event?: any,
): Promise<void> {
  let taskIds: string[];
  try {
    taskIds = await listActiveAgentTeamTaskIdsForOwner(owner);
  } catch {
    return;
  }
  for (const taskId of taskIds) {
    try {
      const task = await loadTask(taskId);
      if (task) await reconcileTaskWithRun(task, event);
    } catch {
      // best-effort per task — one bad row shouldn't block the rest
    }
  }
}

function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function taskRunId(taskId: string): string {
  return `run-task-${taskId}`;
}

function taskRunChunkId(taskId: string, chunk: number): string {
  return `${taskRunId(taskId)}-c${chunk}`;
}

function taskIdFromBackgroundRunId(runId: string): string {
  const taskId = runId.startsWith("run-task-")
    ? runId.slice("run-task-".length)
    : runId;
  const chunkTaskId = taskId.match(/^(.*)-c\d+$/)?.[1];
  // Public background run ids are stable base ids. Only strip a chunk suffix
  // when the caller passed a live run-manager chunk id.
  return chunkTaskId && getRun(runId)?.status === "running"
    ? chunkTaskId
    : taskId;
}

function runningInMemoryTaskRunId(taskId: string): string {
  const baseRunId = taskRunId(taskId);
  for (let i = MAX_AGENT_TEAM_CONTINUATIONS; i >= 0; i -= 1) {
    const chunkRunId = taskRunChunkId(taskId, i);
    if (getRun(chunkRunId)?.status === "running") return chunkRunId;
  }
  if (getRun(baseRunId)?.status === "running") return baseRunId;
  return baseRunId;
}

async function durableActiveTaskRunId(taskId: string): Promise<string> {
  try {
    const dispatch = await getAgentTeamRunDispatchState(taskId);
    if (dispatch?.status === "queued" || dispatch?.status === "running") {
      return taskRunChunkId(taskId, dispatch.continuationCount);
    }
  } catch {
    // Fall back to in-memory state if queue state is temporarily unavailable.
  }
  return runningInMemoryTaskRunId(taskId);
}

function mapTaskStatusToBackgroundStatus(
  status: AgentTask["status"],
): BackgroundAgentRunStatus {
  return status;
}

function taskTimestampToIso(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime())
    ? date.toISOString()
    : new Date(0).toISOString();
}

function latestTaskText(task: AgentTask): string | undefined {
  return task.summary || task.preview || task.currentStep || undefined;
}

function formatTaskPhase(task: AgentTask): string {
  if (task.status === "running") return task.currentStep || "Running";
  if (task.status === "completed") return "Completed";
  const phase = task.error || task.summary || "Task failed.";
  return phase.length > 120 ? `${phase.slice(0, 117)}...` : phase;
}

type TerminalProgressStatus = "succeeded" | "failed" | "cancelled";

function taskProgressMetadata(task: AgentTask): Record<string, unknown> {
  return {
    kind: "agent-team",
    source: "agent-teams",
    taskId: task.taskId,
    threadId: task.threadId,
    description: task.description,
    preview: task.preview,
    summary: task.summary,
    currentStep: task.currentStep,
    surfaceUrl: `agent-native://threads/${encodeURIComponent(task.threadId)}`,
    ...(task.parentThreadId ? { parentThreadId: task.parentThreadId } : {}),
    ...(task.name ? { name: task.name } : {}),
  };
}

function currentTaskProgressStep(task: AgentTask): string {
  return (
    task.currentStep ||
    (task.preview ? "Working on response" : "Starting sub-agent")
  );
}

async function startTaskProgressRun(
  task: AgentTask,
  ownerEmail: string,
): Promise<void> {
  const runId = task.runId ?? taskRunId(task.taskId);
  task.runId = runId;
  try {
    await startProgressRun({
      id: runId,
      owner: ownerEmail,
      title: task.description,
      step: currentTaskProgressStep(task),
      metadata: taskProgressMetadata(task),
    });
  } catch {
    // Progress rows are user-facing visibility. A write failure should not
    // prevent the sub-agent from running or the task card from updating.
  }
}

async function updateTaskProgressRun(
  task: AgentTask,
  ownerEmail: string,
): Promise<void> {
  const runId = task.runId ?? taskRunId(task.taskId);
  task.runId = runId;
  try {
    await updateRunProgress(runId, ownerEmail, {
      step: currentTaskProgressStep(task),
      metadata: taskProgressMetadata(task),
    });
  } catch {
    // best-effort
  }
}

async function completeTaskProgressRun(
  task: AgentTask,
  ownerEmail: string,
  status: TerminalProgressStatus,
  step: string,
): Promise<void> {
  const runId = task.runId ?? taskRunId(task.taskId);
  task.runId = runId;
  try {
    await completeProgressRun(runId, ownerEmail, status, {
      step,
      metadata: taskProgressMetadata(task),
    });
  } catch {
    // best-effort
  }
}

/**
 * Maximum characters stored in `task.summary` (the full result surfaced to the
 * orchestrator via `read-result`). Generous enough to avoid destroying long
 * sub-agent output; matches the tool-result truncation cap used in the main
 * production-agent loop.
 */
const TASK_SUMMARY_MAX_CHARS = 50_000;

function resolveTaskCompletion(
  run: Pick<ActiveRun, "status" | "abortReason">,
  accumulatedText: string,
  options?: { hitContinuationLimit?: boolean },
): {
  taskStatus: "completed" | "errored";
  summary: string;
  progressStatus: TerminalProgressStatus;
  progressStep: string;
  error?: string;
} {
  const text = accumulatedText.trim();
  if (run.status === "aborted") {
    const stopped =
      run.abortReason && run.abortReason !== "user"
        ? `Task stopped: ${run.abortReason}`
        : "Task stopped.";
    return {
      taskStatus: "errored",
      summary: stopped,
      progressStatus: "cancelled",
      progressStep: stopped,
      error: stopped,
    };
  }
  if (run.status === "errored") {
    // Keep a reasonable tail for error context; errors are rarely huge.
    const failed = text.slice(-500) || "Task failed.";
    return {
      taskStatus: "errored",
      summary: failed,
      progressStatus: "failed",
      progressStep: "Task failed.",
      error: failed,
    };
  }
  // Store up to TASK_SUMMARY_MAX_CHARS so the orchestrator's read-result tool
  // can access the full output without truncation. If the absolute continuation
  // cap was hit, mark the result so the orchestrator can distinguish it.
  let summary =
    text.length > TASK_SUMMARY_MAX_CHARS
      ? text.slice(-TASK_SUMMARY_MAX_CHARS)
      : text || "Task completed successfully.";
  if (options?.hitContinuationLimit) {
    summary = `[hit-continuation-limit]\n\n${summary}`;
  }
  return {
    taskStatus: "completed",
    summary,
    progressStatus: "succeeded",
    progressStep: "Task completed.",
  };
}

export function toAgentTaskBackgroundRun(
  task: AgentTask,
): AgentTeamBackgroundRun {
  const createdAt = taskTimestampToIso(task.createdAt);
  const updatedAt = taskTimestampToIso(
    task.completedAt ?? task.updatedAt ?? task.createdAt,
  );
  const phase = formatTaskPhase(task);
  return {
    schemaVersion: 1,
    id: taskRunId(task.taskId),
    kind: "agent-team",
    source: "hosted-agent-team",
    sourceLabel: "Agent Teams",
    sourceRecord: {
      type: "agent-team-task",
      id: task.taskId,
      threadId: task.threadId,
      ...(task.parentThreadId ? { parentThreadId: task.parentThreadId } : {}),
      ...(task.name ? { name: task.name } : {}),
    },
    title: task.description,
    subtitle:
      task.currentStep || (task.status === "errored" ? phase : undefined),
    status: mapTaskStatusToBackgroundStatus(task.status),
    phase,
    createdAt,
    updatedAt,
    goalId: "agent-team",
    needsInput: false,
    needsApproval: false,
    details: [
      { label: "Task", value: task.taskId },
      { label: "Thread", value: task.threadId },
      ...(task.parentThreadId
        ? [{ label: "Parent", value: task.parentThreadId }]
        : []),
    ],
    surfaceUrl: `agent-native://threads/${task.threadId}`,
    metadata: {
      taskId: task.taskId,
      threadId: task.threadId,
      description: task.description,
      preview: task.preview,
      summary: task.summary,
      currentStep: task.currentStep,
      latestText: latestTaskText(task),
      completedAt: task.completedAt,
      error: task.error,
      ...(task.parentThreadId ? { parentThreadId: task.parentThreadId } : {}),
      ...(task.name ? { name: task.name } : {}),
    },
  };
}

function summarizeAgentChatEvent(event: RunEvent): {
  kind: AgentTeamBackgroundTranscriptEvent["kind"];
  message: string;
  metadata?: Record<string, unknown>;
} | null {
  const payload = event.event;
  switch (payload.type) {
    case "text":
      return { kind: "note", message: payload.text };
    case "activity":
      return {
        kind: "status",
        message: payload.label,
        metadata: payload.tool ? { tool: payload.tool } : undefined,
      };
    case "tool_start":
      return {
        kind: "status",
        message: `Running ${payload.tool}`,
        metadata: { tool: payload.tool, input: payload.input },
      };
    case "tool_done":
      return {
        kind: "artifact",
        message: payload.result,
        metadata: { tool: payload.tool },
      };
    case "agent_task":
      return {
        kind: "status",
        message: `${payload.description} (${payload.status})`,
        metadata: {
          taskId: payload.taskId,
          threadId: payload.threadId,
          status: payload.status,
        },
      };
    case "agent_task_update":
      return {
        kind: "status",
        message: payload.preview || payload.currentStep || "Task updated",
        metadata: {
          taskId: payload.taskId,
          currentStep: payload.currentStep,
        },
      };
    case "agent_task_complete":
      return {
        kind: "status",
        message: payload.summary,
        metadata: { taskId: payload.taskId },
      };
    case "error":
      return {
        kind: "status",
        message: payload.error,
        metadata: {
          errorCode: payload.errorCode,
          upgradeUrl: payload.upgradeUrl,
        },
      };
    case "missing_api_key":
      return {
        kind: "status",
        message: "Missing API key",
      };
    case "done":
      return { kind: "status", message: "Run completed" };
    case "loop_limit":
      return { kind: "status", message: "Run stopped at the loop limit" };
    case "auto_continue":
      return {
        kind: "status",
        message: "Run reached its continuation boundary",
        metadata: { reason: payload.reason },
      };
    case "clear":
      return null;
    case "agent_call":
      return {
        kind: "status",
        message: `${payload.agent} ${payload.status}`,
        metadata: { agent: payload.agent, status: payload.status },
      };
    case "agent_call_text":
      return {
        kind: "note",
        message: payload.text,
        metadata: { agent: payload.agent },
      };
    default:
      return null;
  }
}

export function toAgentTaskBackgroundTranscriptEvent(
  runId: string,
  event: RunEvent,
  options: { seq?: number; sourceRunId?: string } = {},
): AgentTeamBackgroundTranscriptEvent | null {
  const summary = summarizeAgentChatEvent(event);
  if (!summary) return null;
  const sourceRunId = options.sourceRunId ?? runId;
  const eventId = `${sourceRunId}:${event.seq}`;
  const seq = options.seq ?? event.seq;
  const metadata = {
    ...(summary.metadata ?? {}),
    seq,
    sourceSeq: event.seq,
    ...(sourceRunId === runId ? {} : { sourceRunId }),
  };
  return {
    schemaVersion: 1,
    id: eventId,
    runId,
    kind: summary.kind,
    source: "hosted-agent-team",
    sourceRecord: {
      type: "agent-team-run-event",
      id: eventId,
      seq,
    },
    message: summary.message,
    createdAt: new Date().toISOString(),
    metadata,
  };
}

export interface SpawnTaskOptions {
  /** Description of what the sub-agent should do */
  description: string;
  /** Additional instructions scoped to this sub-agent */
  instructions?: string;
  /** Model to use (e.g. "claude-haiku-4-5"). Uses default if omitted */
  model?: string;
  /** The owner email for thread creation */
  ownerEmail: string;
  /** The system prompt base for the sub-agent */
  systemPrompt: string;
  /** Available actions for the sub-agent */
  actions: Record<string, ActionEntry>;
  /** Agent engine to use. Falls back to creating an Anthropic engine with apiKey. */
  engine?: AgentEngine;
  /** API key for Anthropic (used only if engine is not provided) */
  apiKey?: string;
  /** Callback to emit events to the parent chat stream */
  parentSend: (event: AgentChatEvent) => void;
  /** Parent thread ID — used to auto-respond when the sub-agent finishes */
  parentThreadId?: string;
  /** Display name for the sub-agent tab (carried into the dispatch payload). */
  name?: string;
  /**
   * Delegation depth of the agent doing the spawning (the parent). Top-level
   * chat is 0. When omitted, the depth is read from the ambient run context
   * (set by `processAgentTeamRun` when a sub-agent is itself running), so a
   * sub-agent that reaches `spawnTask` inherits its own depth automatically.
   * The spawned sub-agent's depth is `parentDelegationDepth + 1`.
   */
  parentDelegationDepth?: number;
}

/**
 * Error thrown when a spawn is refused because it would exceed the delegation
 * depth cap. Carries the structured decision so callers (and the tool layer)
 * can surface a precise message to the parent agent.
 */
export class SubagentDelegationDepthError extends Error {
  readonly decision: SubagentDepthDecision;
  constructor(decision: SubagentDepthDecision) {
    super(
      decision.error ??
        `Delegation depth limit reached (max ${decision.maxDepth}); cannot spawn another sub-agent.`,
    );
    this.name = "SubagentDelegationDepthError";
    this.decision = decision;
  }
}

/**
 * Spawn a sub-agent task. Creates a thread, starts a background agent run,
 * and emits agent_task events to the parent chat stream.
 */
export async function spawnTask(opts: SpawnTaskOptions): Promise<AgentTask> {
  // ── Delegation-depth guardrail ────────────────────────────────────────────
  // Defensive, server-side enforcement that holds regardless of any tool-level
  // stripping in the agent-chat plugin: a sub-agent cannot infinitely spawn
  // sub-agents. The spawning agent's depth comes from the explicit option or,
  // failing that, the ambient depth recorded while a sub-agent run executes.
  const parentDepth =
    typeof opts.parentDelegationDepth === "number"
      ? opts.parentDelegationDepth
      : currentAmbientDelegationDepth();
  const decision = evaluateSubagentDepth(parentDepth);
  if (!decision.allowed) {
    throw new SubagentDelegationDepthError(decision);
  }
  const childDepth = decision.childDepth;

  const taskId = generateTaskId();

  // Create a dedicated thread for the sub-agent with the task as the first message
  const thread = await createThread(opts.ownerEmail, {
    title: opts.description.slice(0, 100),
  });

  // Save the initial user message to thread data so the tab shows content
  // immediately. Shape must match assistant-ui's ExportedMessageRepository —
  // each entry carries an explicit `parentId` so the runtime threads messages
  // into a linked list; without it, later assistant messages render as
  // orphaned siblings and only the one under `headId` is shown.
  const userMsgId = `msg-${taskId}-user`;
  try {
    const { updateThreadData } = await import("../chat-threads/store.js");
    const threadData = JSON.stringify({
      headId: userMsgId,
      messages: [
        {
          message: {
            id: userMsgId,
            role: "user",
            content: [{ type: "text", text: opts.description }],
            metadata: {},
          },
          parentId: null,
        },
      ],
    });
    await updateThreadData(
      thread.id,
      threadData,
      opts.description.slice(0, 100),
      opts.description.slice(0, 200),
      1,
    );
  } catch {
    // Best effort — thread will still work without persisted messages
  }

  const runId = taskRunId(taskId);
  const createdAt = Date.now();
  const task: AgentTask = {
    taskId,
    threadId: thread.id,
    ...(opts.parentThreadId ? { parentThreadId: opts.parentThreadId } : {}),
    ...(opts.name ? { name: opts.name } : {}),
    description: opts.description,
    status: "running",
    preview: "",
    summary: "",
    currentStep: "Starting sub-agent",
    createdAt,
    updatedAt: createdAt,
    startedAt: createdAt,
    runId,
    delegationDepth: childDepth,
  };

  await saveTask(task);
  await startTaskProgressRun(task, opts.ownerEmail);

  // Notify parent chat that a sub-agent was spawned
  opts.parentSend({
    type: "agent_task",
    taskId,
    threadId: thread.id,
    description: opts.description,
    status: "running",
  });

  // Hand the run off to the durable dispatch queue and self-fire a fresh
  // function invocation to execute it. This is what makes background
  // sub-agents survive serverless: the spawning request returns immediately
  // while the sub-agent runs in its OWN invocation (with its own timeout
  // budget) instead of as a detached in-process promise that the host freezes
  // when this response flushes. Same enqueue-to-SQL + self-fire-HTTP pattern
  // as A2A async tasks (a2a/handlers.ts) and integration webhooks
  // (integrations/webhook-handler.ts). Execution happens in `processAgentTeamRun`,
  // invoked by the `/_agent-native/agent-teams/_process-run` route mounted
  // inside the agent-chat plugin (where the action/prompt/engine closures live).
  let orgId: string | null = null;
  try {
    orgId = (await resolveOrgIdForEmail(opts.ownerEmail)) ?? null;
  } catch {
    orgId = null;
  }

  const payload: AgentTeamRunPayload = {
    description: opts.description,
    instructions: opts.instructions,
    model: opts.model,
    ...(opts.parentThreadId ? { parentThreadId: opts.parentThreadId } : {}),
    ...(opts.name ? { name: opts.name } : {}),
    // Stable across continuation chunks so the durable assistant message folds.
    turnId: runId,
  };

  try {
    await enqueueAgentTeamRun({
      taskId,
      threadId: thread.id,
      runId,
      ownerEmail: opts.ownerEmail,
      orgId,
      payload,
    });
    await fireInternalDispatch({
      path: AGENT_TEAM_PROCESS_RUN_PATH,
      taskId,
      body: { mode: "start" },
    });
  } catch (err) {
    // Enqueue/dispatch failed outright — surface as an errored task rather
    // than a ghost "running" one. (A dropped self-fire that still enqueued is
    // recovered by the reconcile stuck-refire path.)
    await failReconciledTask(
      task,
      opts.ownerEmail,
      subAgentDispatchFailureMessage(err),
    );
  }

  return task;
}

/**
 * Build the sub-agent system prompt: a "you are a sub-agent" preamble (so it
 * starts on its task instead of exploring), the base prompt, and any
 * task-specific instructions.
 */
function buildSubAgentSystemPrompt(
  baseSystemPrompt: string,
  actions: Record<string, ActionEntry>,
  instructions?: string,
): string {
  const actionNames = Object.keys(actions).join(", ");
  const preamble = `## You Are a Sub-Agent

You are a focused sub-agent with a specific task. You have been given a curated set of actions that connect directly to the app's database and services.

**Start immediately with your task. Do NOT:**
- Run \`db-schema\` to explore the database structure
- Run \`bash\` just to search/list files
- Try to \`curl\` or access external URLs to find the app
- Use \`bash\` for exploration — only for running \`pnpm action\` commands when no direct action exists

**Your available actions (${actionNames}) work directly. Use them.**

`;
  let prompt = preamble + baseSystemPrompt;
  if (instructions) {
    prompt += `\n\n## Task-Specific Instructions\n\n${instructions}`;
  }
  return prompt;
}

/**
 * Persist the sub-agent conversation to thread_data, folding continuation
 * chunks of the same turn into one assistant message (same `foldAssistantTurn`
 * mechanism the main chat uses). Returns the full folded assistant text for use
 * as the task summary so multi-chunk runs don't lose earlier chunks' output.
 */
async function persistTaskThreadData(
  task: AgentTask,
  description: string,
  run: ActiveRun,
  runId: string,
  turnId: string,
): Promise<string> {
  try {
    const { getThread, updateThreadData } =
      await import("../chat-threads/store.js");
    const thread = await getThread(task.threadId);
    let repo: any;
    try {
      repo = JSON.parse(thread?.threadData || "{}");
    } catch {
      repo = {};
    }
    if (!Array.isArray(repo.messages)) repo.messages = [];

    // Ensure the seed user message exists (first chunk / fresh thread).
    const userMsgId = `msg-${task.taskId}-user`;
    const hasUser = repo.messages.some(
      (m: any) => (m?.message ?? m)?.id === userMsgId,
    );
    if (!hasUser) {
      repo.messages.unshift({
        message: {
          id: userMsgId,
          role: "user",
          content: [{ type: "text", text: description }],
          metadata: {},
        },
        parentId: null,
      });
      if (!repo.headId) repo.headId = userMsgId;
    }

    const assistantMsg = buildAssistantMessage(run.events ?? [], runId, {
      suppressInternalContinuation: true,
      turnId,
    });
    if (assistantMsg) {
      repo = foldAssistantTurn(repo, assistantMsg, { runId, turnId });
    }

    // Extract the folded assistant text (full content across chunks).
    let assistantText = "";
    const headEntry = Array.isArray(repo.messages)
      ? repo.messages.find((m: any) => (m?.message ?? m)?.id === repo.headId)
      : undefined;
    const headMsg = headEntry?.message ?? headEntry;
    if (headMsg?.role === "assistant" && Array.isArray(headMsg.content)) {
      assistantText = headMsg.content
        .filter((c: any) => c?.type === "text" && typeof c.text === "string")
        .map((c: any) => c.text)
        .join("\n");
    }

    await updateThreadData(
      task.threadId,
      JSON.stringify(repo),
      description.slice(0, 100),
      assistantText.slice(0, 200),
      Array.isArray(repo.messages) ? repo.messages.length : 1,
    );
    return assistantText;
  } catch {
    return "";
  }
}

/** Mark a sub-agent task terminal: task record, progress row, and queue row. */
async function finalizeAgentTeamRun(
  task: AgentTask,
  run: ActiveRun,
  ownerEmail: string | null,
  fullText: string,
  options?: { hitContinuationLimit?: boolean; claimedAttempts?: number },
): Promise<void> {
  const terminal = resolveTaskCompletion(run, fullText, {
    hitContinuationLimit: options?.hitContinuationLimit,
  });
  task.status = terminal.taskStatus;
  task.summary = terminal.summary;
  task.error = terminal.error;
  task.currentStep = "";
  task.completedAt = Date.now();
  await saveTask(task);
  if (ownerEmail) {
    await completeTaskProgressRun(
      task,
      ownerEmail,
      terminal.progressStatus,
      terminal.progressStep,
    );
  }
  await completeAgentTeamRun(
    task.taskId,
    terminal.taskStatus === "completed" ? "done" : "failed",
    options?.claimedAttempts,
  );

  // ── Completion loop: notify the parent thread ─────────────────────────────
  // Append a durable injection to the parent thread's queue so the
  // orchestrator automatically sees the result at its next turn start.
  // Also write a NotificationsBell entry so the user sees a badge.
  if (task.parentThreadId) {
    try {
      await appendParentCompletionInjection(task.parentThreadId, task, {
        taskStatus: terminal.taskStatus,
        summary: terminal.summary,
        hitContinuationLimit: options?.hitContinuationLimit,
      });
    } catch {
      // best-effort — a queue write failure must not break finalization
    }
  }
  if (ownerEmail) {
    try {
      const { insertNotification } = await import("../notifications/store.js");
      const name = task.name ?? task.description.slice(0, 60);
      const statusLabel =
        terminal.taskStatus === "completed"
          ? options?.hitContinuationLimit
            ? "finished (hit limit)"
            : "finished"
          : "failed";
      await insertNotification({
        owner: ownerEmail,
        severity: terminal.taskStatus === "completed" ? "info" : "warning",
        title: `Sub-agent "${name}" ${statusLabel}`,
        body: terminal.summary.slice(0, 300) || undefined,
        metadata: {
          kind: "agent-team-complete",
          taskId: task.taskId,
          threadId: task.threadId,
          ...(task.parentThreadId
            ? { parentThreadId: task.parentThreadId }
            : {}),
        },
      });
    } catch {
      // best-effort — a notification write failure must not break finalization
    }
  }
}

/** Run config the processor route resolves from plugin-scope closures. */
export interface AgentTeamRunConfig {
  baseSystemPrompt: string;
  actions: Record<string, ActionEntry>;
  engine: AgentEngine;
  model: string;
}

export interface ProcessAgentTeamRunOptions {
  taskId: string;
  /** "start" = first chunk; "continue" = resume from thread_data after a
   * soft-timeout boundary. Defaults from the queue row's continuation count. */
  mode?: "start" | "continue";
  /** Inbound request event, used to resolve the self-dispatch base URL for
   * continuation self-fires. */
  event?: any;
  /** Count of consecutive non-progressing chunks carried forward from the
   * previous invocation. Used by the progress-aware continuation budget. */
  noProgressCount?: number;
  /** Builds the sub-agent run config from the queue payload + resolved owner.
   * The plugin supplies this because the action registry / base prompt /
   * engine are per-deployment plugin-scope closures, not serializable. */
  resolveConfig: (ctx: {
    payload: AgentTeamRunPayload;
    ownerEmail: string;
    orgId: string | null;
  }) => Promise<AgentTeamRunConfig>;
}

/**
 * Execute one chunk of a queued sub-agent run in a fresh function invocation.
 * Called by the `/_agent-native/agent-teams/_process-run` route. Atomically
 * claims the run (idempotent on duplicate self-fires), reconstructs the
 * messages (start vs continue), runs the agent loop to completion, persists
 * thread_data, and either self-fires a continuation (soft-timeout boundary,
 * under the cap) or finalizes the task.
 */
export async function processAgentTeamRun(
  opts: ProcessAgentTeamRunOptions,
): Promise<{ ok: boolean; skipped?: string }> {
  const claimed = await claimAgentTeamRun(opts.taskId);
  if (!claimed) return { ok: true, skipped: "already-claimed-or-missing" };

  return await runWithRequestContext(
    {
      userEmail: claimed.ownerEmail ?? undefined,
      orgId: claimed.orgId ?? undefined,
    },
    async () => {
      const task = await loadTask(opts.taskId);
      if (!task) {
        await completeAgentTeamRun(opts.taskId, "failed");
        return { ok: true, skipped: "task-missing" };
      }
      if (task.status !== "running") {
        await completeAgentTeamRun(
          opts.taskId,
          task.status === "completed" ? "done" : "failed",
        );
        return { ok: true, skipped: "task-terminal" };
      }

      const payload = claimed.payload;
      const ownerEmail = claimed.ownerEmail ?? getRequestUserEmail() ?? "";
      const orgId = claimed.orgId;
      const turnId = payload.turnId || taskRunId(opts.taskId);

      let config: AgentTeamRunConfig;
      try {
        config = await opts.resolveConfig({ payload, ownerEmail, orgId });
      } catch (err) {
        const message =
          err instanceof Error
            ? `Failed to prepare sub-agent: ${err.message}`
            : "Failed to prepare sub-agent.";
        await failReconciledTask(task, ownerEmail || null, message);
        return { ok: false, skipped: "config-failed" };
      }

      const mode: "start" | "continue" =
        opts.mode ?? (claimed.continuationCount > 0 ? "continue" : "start");

      const systemPrompt = buildSubAgentSystemPrompt(
        config.baseSystemPrompt,
        config.actions,
        payload.instructions,
      );

      let messages: EngineMessage[];
      if (mode === "continue") {
        let priorThreadData: string | null | undefined;
        try {
          const { getThread } = await import("../chat-threads/store.js");
          priorThreadData = (await getThread(task.threadId))?.threadData;
        } catch {
          priorThreadData = undefined;
        }
        messages = threadDataToEngineMessages(priorThreadData);
        if (messages.length === 0) {
          messages = [
            {
              role: "user",
              content: [{ type: "text", text: payload.description }],
            },
          ];
        }
        appendAgentLoopContinuation(messages, "run_timeout");
      } else {
        messages = [
          {
            role: "user",
            content: [{ type: "text", text: payload.description }],
          },
        ];
      }

      const messageAwareActions = createMessageAwareActions(
        opts.taskId,
        config.actions,
      );
      const tools = actionsToEngineTools(messageAwareActions);

      // Fresh runId per chunk (avoids agent_runs PK collisions); stable turnId so
      // the durable assistant message folds across chunks.
      const runId = `${taskRunId(opts.taskId)}-c${claimed.continuationCount}`;

      task.currentStep =
        mode === "continue" ? "Continuing sub-agent" : "Working on response";
      task.startedAt = task.startedAt ?? Date.now();
      await saveTask(task);
      if (ownerEmail) await updateTaskProgressRun(task, ownerEmail);

      // The attempts value at claim-time is the fencing token. All queue
      // writes (heartbeat, bump, complete) include AND attempts = claimedAttempts
      // so a superseded invocation that was re-claimed by a stuck-refire cannot
      // accidentally touch the new invocation's row.
      const claimedAttempts = claimed.attempts;

      const heartbeat = setInterval(() => {
        // Best-effort: a dropped Neon WebSocket (Lambda freeze/thaw) rejects
        // with a raw ErrorEvent; a floating rejection here surfaces as an
        // unhandled promise rejection, so it must be caught and logged.
        touchAgentTeamRun(opts.taskId, claimedAttempts).catch((err) => {
          console.warn(
            `[agent-teams] heartbeat update failed for task ${opts.taskId}:`,
            describeDbError(err),
          );
        });
      }, RUN_QUEUE_HEARTBEAT_MS);
      (heartbeat as unknown as { unref?: () => void }).unref?.();

      let accumulatedText = "";
      let lastProgressSent = 0;
      const PROGRESS_INTERVAL_MS = 2000;
      // Track no-progress continuation budget (Fix 3).
      let consecutiveNoProgressChunks = opts.noProgressCount ?? 0;

      // Capture loop usage for token accounting (Fix 4).
      let chunkUsage:
        | import("../agent/production-agent.js").AgentLoopUsage
        | null = null;

      await new Promise<void>((resolve) => {
        startRun(
          runId,
          task.threadId,
          async (send, signal) => {
            const wrappedSend = (event: AgentChatEvent) => {
              send(event);
              if (event.type === "text") {
                accumulatedText += event.text;
                task.preview = accumulatedText.slice(-800);
                const now = Date.now();
                if (now - lastProgressSent >= PROGRESS_INTERVAL_MS) {
                  lastProgressSent = now;
                  saveTask(task).catch((err) => {
                    console.warn(
                      `[agent-teams] progress save failed for task ${task.taskId}:`,
                      describeDbError(err),
                    );
                  });
                  if (ownerEmail) void updateTaskProgressRun(task, ownerEmail);
                }
              } else if (event.type === "tool_start") {
                task.currentStep = `Running ${event.tool}...`;
              } else if (event.type === "tool_done") {
                task.currentStep = "";
              }
            };
            await runWithRequestContext(
              { userEmail: ownerEmail || undefined, orgId: orgId ?? undefined },
              // Record THIS sub-agent's own delegation depth as the ambient
              // depth for the duration of its agent loop. If a tool call from
              // within the loop reaches `spawnTask` (even with the team tool not
              // stripped), the spawn path reads this depth and refuses once the
              // cap is hit. Fall back to depth 1 for legacy tasks persisted
              // before delegationDepth was tracked.
              () =>
                runWithDelegationDepth(task.delegationDepth ?? 1, async () => {
                  chunkUsage = await runAgentLoop({
                    engine: config.engine,
                    model: config.model,
                    systemPrompt,
                    tools,
                    messages,
                    actions: messageAwareActions,
                    send: wrappedSend,
                    signal,
                    finalResponseGuard: createTaskMessageFinalGuard(
                      opts.taskId,
                    ),
                  });
                }),
            );
          },
          async (run) => {
            clearInterval(heartbeat);
            try {
              const fullText = await persistTaskThreadData(
                task,
                payload.description,
                run,
                runId,
                turnId,
              );

              // Record token usage for this chunk (Fix 4).
              if (chunkUsage && ownerEmail) {
                try {
                  const u = chunkUsage;
                  if (
                    u.inputTokens > 0 ||
                    u.outputTokens > 0 ||
                    u.cacheReadTokens > 0 ||
                    u.cacheWriteTokens > 0
                  ) {
                    const { recordUsage } = await import("../usage/store.js");
                    const label = payload.name
                      ? `agent-team:${payload.name}`
                      : "agent-team";
                    await recordUsage({
                      ownerEmail,
                      inputTokens: u.inputTokens,
                      outputTokens: u.outputTokens,
                      cacheReadTokens: u.cacheReadTokens,
                      cacheWriteTokens: u.cacheWriteTokens,
                      model: u.model,
                      label,
                    });
                  }
                } catch {
                  // Usage recording failed — don't break the run
                }
              }

              // A soft-timeout boundary means the host function wall is near and
              // the partial turn is checkpointed in thread_data — self-fire the
              // next continuation chunk (server-side analog of the client re-POST
              // that continues the main chat) instead of finalizing.
              const reachedBoundary = (run.events ?? []).some(
                (e) => e.event.type === "auto_continue",
              );
              if (reachedBoundary) {
                // Progress check (Fix 3): count substantive events in this chunk.
                // Any text or tool activity counts as progress. An empty chunk
                // (only auto_continue with no actual work) is non-progressing.
                const substantiveEvents = (run.events ?? []).filter(
                  (e) =>
                    e.event.type === "text" ||
                    e.event.type === "tool_start" ||
                    e.event.type === "tool_done",
                ).length;
                if (substantiveEvents === 0) {
                  consecutiveNoProgressChunks += 1;
                } else {
                  consecutiveNoProgressChunks = 0;
                }

                const hitNoProgressLimit =
                  consecutiveNoProgressChunks >=
                  MAX_AGENT_TEAM_NO_PROGRESS_CONTINUATIONS;
                const count = await bumpAgentTeamContinuation(
                  opts.taskId,
                  claimedAttempts,
                );
                if (
                  count !== null &&
                  count <= MAX_AGENT_TEAM_CONTINUATIONS &&
                  !hitNoProgressLimit
                ) {
                  task.currentStep = "Continuing sub-agent";
                  task.preview = (fullText || accumulatedText).slice(-800);
                  await saveTask(task);
                  if (ownerEmail) await updateTaskProgressRun(task, ownerEmail);
                  try {
                    await fireInternalDispatch({
                      event: opts.event,
                      path: AGENT_TEAM_PROCESS_RUN_PATH,
                      taskId: opts.taskId,
                      body: {
                        mode: "continue",
                        noProgressCount: consecutiveNoProgressChunks,
                      },
                    });
                  } catch (err) {
                    await failReconciledTask(
                      task,
                      ownerEmail || null,
                      subAgentDispatchFailureMessage(err),
                    );
                  }
                  return;
                }
                // Hit the absolute cap or no-progress limit — finalize with an
                // explicit marker so the orchestrator can distinguish this from a
                // clean completion.
                await finalizeAgentTeamRun(
                  task,
                  run,
                  ownerEmail || null,
                  fullText || accumulatedText,
                  { hitContinuationLimit: true, claimedAttempts },
                );
                return;
              }

              await finalizeAgentTeamRun(
                task,
                run,
                ownerEmail || null,
                fullText || accumulatedText,
                { claimedAttempts },
              );
            } finally {
              resolve();
            }
          },
          { useHostedSoftTimeoutDefault: true, turnId },
        );
      });

      return { ok: true };
    },
  );
}

/** Get task by ID */
export async function getTask(taskId: string): Promise<AgentTask | undefined> {
  const task = await loadTask(taskId);
  return task ? await reconcileTaskWithRun(task) : undefined;
}

/** Get task by thread ID */
export async function getTaskByThread(
  threadId: string,
): Promise<AgentTask | undefined> {
  const task = await loadTaskByThread(threadId);
  return task ? await reconcileTaskWithRun(task) : undefined;
}

/** List all tasks (most recent first) */
export async function listTasks(): Promise<AgentTask[]> {
  const entries = await listAppState(TASK_PREFIX);
  const tasks = entries.map((e) => e.value as unknown as AgentTask);
  const reconciled = await Promise.all(tasks.map(reconcileTaskWithRun));
  return reconciled.sort(
    (a, b) =>
      (b.updatedAt ?? b.completedAt ?? b.createdAt) -
      (a.updatedAt ?? a.completedAt ?? a.createdAt),
  );
}

export async function listAgentTeamBackgroundRuns(): Promise<
  AgentTeamBackgroundRun[]
> {
  return (await listTasks()).map(toAgentTaskBackgroundRun);
}

export async function getAgentTeamBackgroundRun(
  runId: string,
): Promise<AgentTeamBackgroundRun | null> {
  const task = await loadTask(taskIdFromBackgroundRunId(runId));
  return task
    ? toAgentTaskBackgroundRun(await reconcileTaskWithRun(task))
    : null;
}

export async function listAgentTeamBackgroundTranscriptEvents(
  runId: string,
): Promise<AgentTeamBackgroundTranscriptEvent[]> {
  const taskId = taskIdFromBackgroundRunId(runId);
  const normalizedRunId = taskRunId(taskId);
  const runIds = await transcriptRunIdsForTask(taskId);
  const output: AgentTeamBackgroundTranscriptEvent[] = [];
  let seq = 0;

  for (const sourceRunId of runIds) {
    const activeRun = getRun(sourceRunId);
    const events = activeRun
      ? activeRun.events
      : await getPersistedRunEvents(sourceRunId);
    for (const event of events) {
      const transcriptEvent = toAgentTaskBackgroundTranscriptEvent(
        normalizedRunId,
        event,
        { seq, sourceRunId },
      );
      if (transcriptEvent) {
        output.push(transcriptEvent);
        seq += 1;
      }
    }
  }

  return output;
}

export function subscribeToAgentTeamBackgroundRun(
  runId: string,
  fromSeq = 0,
): ReadableStream<Uint8Array> | null {
  return subscribeToRun(
    runningInMemoryTaskRunId(taskIdFromBackgroundRunId(runId)),
    fromSeq,
  );
}

async function transcriptRunIdsForTask(taskId: string): Promise<string[]> {
  const baseRunId = taskRunId(taskId);
  let continuationCount = 0;
  try {
    continuationCount =
      (await getAgentTeamRunDispatchState(taskId))?.continuationCount ?? 0;
  } catch {
    continuationCount = 0;
  }

  const ids = [baseRunId];
  for (let i = 0; i <= continuationCount; i += 1) {
    ids.push(taskRunChunkId(taskId, i));
  }
  return ids;
}

async function getPersistedRunEvents(runId: string): Promise<RunEvent[]> {
  const rows = await getRunEventsSince(runId, 0);
  return rows
    .map((row): RunEvent | null => {
      try {
        return {
          seq: row.seq,
          event: JSON.parse(row.eventData) as RunEvent["event"],
        };
      } catch {
        return null;
      }
    })
    .filter((event): event is RunEvent => Boolean(event));
}

/** Send a message/update to a running sub-agent via application state */
export async function sendToTask(
  taskId: string,
  message: string,
): Promise<{
  ok: boolean;
  error?: string;
  messageId?: string;
  queuedCount?: number;
}> {
  const task = await loadTask(taskId);
  if (!task) return { ok: false, error: "Task not found" };
  if (task.status !== "running")
    return { ok: false, error: "Task is not running" };
  if (message.trim().length === 0)
    return { ok: false, error: "Message is required" };

  // Append to a durable per-task queue. Running sub-agents drain this queue
  // after tool batches and immediately before a final response. This does not
  // interrupt an in-flight model stream or tool call; it guarantees the next
  // safe continuation sees the update.
  try {
    const queued = await appendQueuedTaskMessage(taskId, message);
    return { ok: true, ...queued };
  } catch {
    const sessionId = getRequestUserEmail();
    if (!sessionId) return { ok: false, error: "no authenticated user" };
    return { ok: false, error: "Unable to queue message" };
  }
}

export async function sendToAgentTeamBackgroundRun(
  runId: string,
  message: string,
): Promise<SendToAgentTeamBackgroundRunResult> {
  return sendToTask(taskIdFromBackgroundRunId(runId), message);
}

async function sendAgentTeamBackgroundAgentFollowUp(
  input: BackgroundAgentFollowUpInput,
): Promise<BackgroundAgentControlResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return {
      ok: false,
      runId: input.runId,
      run: await getAgentTeamBackgroundRun(input.runId),
      error: "Follow-up prompt is required.",
    };
  }

  const result = await sendToAgentTeamBackgroundRun(input.runId, prompt);
  return {
    ok: result.ok,
    runId: input.runId,
    run: await getAgentTeamBackgroundRun(input.runId),
    queued: result.ok,
    message: result.ok
      ? "Follow-up queued for the Agent Teams background run."
      : undefined,
    error: result.error,
  };
}

async function controlAgentTeamBackgroundAgentRun(
  input: BackgroundAgentControlInput,
): Promise<BackgroundAgentControlResult> {
  if (input.command !== "stop") {
    return {
      ok: false,
      runId: input.runId,
      run: await getAgentTeamBackgroundRun(input.runId),
      error:
        "Agent Teams background runs currently support stop through the shared controller.",
    };
  }

  const result = await stopAgentTeamBackgroundRun(input.runId);
  return {
    ok: result.ok,
    runId: input.runId,
    run: await getAgentTeamBackgroundRun(input.runId),
    message: result.ok ? "Agent Teams background run stopped." : undefined,
    error: result.error,
  };
}

export async function stopAgentTeamBackgroundRun(
  runId: string,
  reason = "user",
): Promise<ControlAgentTeamBackgroundRunResult> {
  const taskId = taskIdFromBackgroundRunId(runId);
  const task = await loadTask(taskId);
  if (!task) return { ok: false, error: "Task not found" };
  if (task.status !== "running") {
    return { ok: false, error: "Task is not running" };
  }

  abortRun(await durableActiveTaskRunId(taskId), reason);
  task.status = "errored";
  task.summary =
    reason === "user" ? "Task stopped." : `Task stopped: ${reason}`;
  task.error = task.summary;
  task.currentStep = "";
  task.completedAt = Date.now();
  await saveTask(task);
  const ownerEmail = getRequestUserEmail();
  if (ownerEmail) {
    await completeTaskProgressRun(task, ownerEmail, "cancelled", task.summary);
  }
  await completeAgentTeamRun(task.taskId, "failed");
  return { ok: true };
}

/** Mark a task as errored */
export async function markTaskErrored(
  taskId: string,
  error: string,
): Promise<void> {
  const task = await loadTask(taskId);
  if (task) {
    task.status = "errored";
    task.summary = error;
    task.error = error;
    task.currentStep = "";
    task.completedAt = Date.now();
    await saveTask(task);
    const ownerEmail = getRequestUserEmail();
    if (ownerEmail) {
      await completeTaskProgressRun(task, ownerEmail, "failed", error);
    }
  }
}

export const _agentTeamsQueueForTests = {
  createMessageAwareActions,
  createTaskMessageFinalGuard,
  drainQueuedTaskMessages,
  formatQueuedTaskMessages,
  resolveTaskCompletion,
  evaluateSubagentDepth,
  runWithDelegationDepth,
  currentAmbientDelegationDepth,
};
