import { AsyncLocalStorage } from "node:async_hooks";

import { applyAgentTextEventToBuffer } from "../a2a/response-text.js";
import { AGENT_TEAM_PROCESS_RUN_PATH } from "../agent/durable-background.js";
import { resolveMainChatMaxOutputTokens } from "../agent/engine/output-tokens.js";
import type { AgentEngine, EngineMessage } from "../agent/engine/types.js";
import type {
  ActionEntry,
  AgentLoopFinalResponseGuard,
} from "../agent/production-agent.js";
import {
  actionsToEngineTools,
  filterActionsByAllowedNames,
  filterInitialEngineTools,
  readPersistedAllowedActionNames,
  resolveAgentRequestReasoningEffort,
} from "../agent/production-agent.js";
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
import { attachToolSearch } from "../agent/tool-search.js";
import type { AgentChatEvent } from "../agent/types.js";
import type { RunEvent } from "../agent/types.js";
import {
  readAppState,
  writeAppState,
  listAppState,
  deleteAppState,
} from "../application-state/script-helpers.js";
import { redactArgsToValue, redactTextToSummary } from "../audit/redact.js";
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
  getRun as getProgressRun,
  startRun as startProgressRun,
  updateRunProgress,
} from "../progress/registry.js";
import { dispatchAgentTeamRun } from "./agent-teams-dispatch.js";
import {
  enqueueAgentTeamRun,
  claimAgentTeamRun,
  touchAgentTeamRun,
  bumpAgentTeamContinuation,
  requeueAgentTeamRunContinuation,
  completeAgentTeamRun,
  completeAgentTeamRunIfCurrent,
  withCurrentAgentTeamRunAttempt,
  getAgentTeamRunDispatchState,
  claimAgentTeamRunReconciliationAttempt,
  listActiveAgentTeamTaskIdsForOwner,
  listStaleActiveAgentTeamRuns,
  MAX_AGENT_TEAM_CONTINUATIONS,
  MAX_AGENT_TEAM_NO_PROGRESS_CONTINUATIONS,
  RUN_DISPATCH_STUCK_AFTER_MS,
  RUN_PROCESSING_STUCK_AFTER_MS,
  RUN_RECONCILIATION_RETRY_AFTER_MS,
  type AgentTeamRunPayload,
} from "./agent-teams-run-queue.js";
import {
  getRequestOrgId,
  getRequestRunContext,
  getRequestUserEmail,
  hasRequestContext,
  runWithRequestContext,
} from "./request-context.js";

export { AGENT_TEAM_PROCESS_RUN_PATH };

const delegationDepthStorage = new AsyncLocalStorage<number>();

function runWithDelegationDepth<T>(
  depth: number,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return delegationDepthStorage.run(Math.max(0, Math.floor(depth || 0)), fn);
}

function currentAmbientDelegationDepth(): number {
  return delegationDepthStorage.getStore() ?? 0;
}

export function getCurrentDelegationDepth(): number {
  return currentAmbientDelegationDepth();
}

export interface SubagentDepthDecision {
  allowed: boolean;
  parentDepth: number;
  childDepth: number;
  maxDepth: number;
  error?: string;
}

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

const RUN_QUEUE_HEARTBEAT_MS = 5_000;
const RUN_DISPATCH_RETRY_COOLDOWN_MS = 60_000;
const MAX_STALE_AGENT_TEAM_RUNS_PER_SWEEP = 5;
const recentRunDispatchAttempts = new Map<string, number>();
const activeTaskRunIds = new Map<string, string>();

export interface AgentTask {
  taskId: string;
  threadId: string;
  parentThreadId?: string;
  ownerEmail?: string | null;
  orgId?: string | null;
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
  delegationDepth?: number;
  transcriptRunIds?: string[];
  parentCompletionEnqueued?: boolean;
  hitContinuationLimit?: boolean;
  terminalEffectsVersion?: 1;
  terminalEffectsReconciled?: boolean;
  terminalProgressStatus?: TerminalProgressStatus;
}

export interface AgentTeamOwnerScope {
  ownerEmail: string | null;
  orgId?: string | null;
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

const TASK_PREFIX = "agent-task:";

const THREAD_PREFIX = "agent-task-thread:";

const TASK_MESSAGE_PREFIX = "task-message:";

const PARENT_COMPLETION_PREFIX = "parent-completion:";

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

async function appendParentCompletionInjection(
  parentThreadId: string,
  task: AgentTask,
  terminal: {
    taskStatus: "completed" | "errored";
    summary: string;
    hitContinuationLimit?: boolean;
  },
): Promise<void> {
  const id = `inj-${task.taskId}`;
  const existing = await listAppState(
    parentCompletionQueuePrefix(parentThreadId),
  );
  if (
    existing.some(
      (entry) =>
        entry.value &&
        typeof entry.value === "object" &&
        (entry.value as { taskId?: unknown }).taskId === task.taskId,
    )
  ) {
    return;
  }
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
          const result = await entry.run(args, {
            ...context,
            caller: context?.caller ?? "tool",
          });
          const queuedMessages = await drainQueuedTaskMessages(taskId);
          if (queuedMessages.length === 0) return result;

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

    return {
      retryMessage: formatQueuedTaskMessages(queuedMessages),
      fallbackMessage:
        "I received an orchestrator update while finishing, but could not continue from it. Please check the task status and send the update again if needed.",
      expandToolSurface: true,
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
  if (dispatch.payload.transcriptRunIds) {
    task.transcriptRunIds = [
      ...new Set([
        ...(task.transcriptRunIds ?? []),
        ...dispatch.payload.transcriptRunIds,
      ]),
    ];
  }
  return task;
}

async function completeReconciledTask(
  task: AgentTask,
  ownerEmail: string | null,
  expectedDispatch?: NonNullable<
    Awaited<ReturnType<typeof getAgentTeamRunDispatchState>>
  >,
): Promise<AgentTask> {
  let progressReconciled = true;
  const complete = async () => {
    task.status = "completed";
    task.summary = task.summary || task.preview || "Task completed.";
    task.currentStep = "";
    task.completedAt = Date.now();
    task.terminalEffectsVersion = 1;
    task.terminalEffectsReconciled = false;
    task.terminalProgressStatus = "succeeded";
    task.parentCompletionEnqueued = !task.parentThreadId;
    if (task.parentThreadId) {
      await appendParentCompletionInjection(task.parentThreadId, task, {
        taskStatus: "completed",
        summary: task.summary,
      });
      task.parentCompletionEnqueued = true;
    }
    await saveTask(task);
    if (ownerEmail) {
      progressReconciled = await completeTaskProgressRun(
        task,
        ownerEmail,
        "succeeded",
        "Task completed.",
      );
    }
  };

  if (expectedDispatch) {
    const result = await withCurrentAgentTeamRunAttempt(
      task.taskId,
      expectedDispatch.attempts,
      complete,
      { statuses: ["done"], expectedUpdatedAt: expectedDispatch.updatedAt },
    );
    if (!result.current) return task;
  } else {
    await complete();
  }
  const notificationReconciled = ownerEmail
    ? await ensureTaskCompletionNotification(task, ownerEmail)
    : true;
  if (expectedDispatch && progressReconciled && notificationReconciled) {
    await markTerminalTaskEffectsReconciled(task, expectedDispatch.attempts);
  }
  return task;
}

async function failReconciledTask(
  task: AgentTask,
  ownerEmail: string | null,
  message: string,
  progressStatus: TerminalProgressStatus = "failed",
  expectedDispatch?: Pick<
    NonNullable<Awaited<ReturnType<typeof getAgentTeamRunDispatchState>>>,
    "status" | "attempts" | "updatedAt"
  >,
  checkExpectedUpdatedAt = true,
): Promise<AgentTask> {
  let progressReconciled = true;
  const markFailed = async () => {
    task.status = "errored";
    task.summary = task.summary || task.preview || message;
    task.error = task.error || message;
    task.currentStep = "";
    task.completedAt = Date.now();
    task.terminalEffectsVersion = 1;
    task.terminalEffectsReconciled = false;
    task.terminalProgressStatus = progressStatus;
    task.parentCompletionEnqueued = !task.parentThreadId;
    if (task.parentThreadId) {
      await appendParentCompletionInjection(task.parentThreadId, task, {
        taskStatus: "errored",
        summary: task.summary,
      });
      task.parentCompletionEnqueued = true;
    }
    await saveTask(task);
    if (ownerEmail) {
      progressReconciled = await completeTaskProgressRun(
        task,
        ownerEmail,
        progressStatus,
        message,
      );
    }
  };

  if (expectedDispatch) {
    const result = await withCurrentAgentTeamRunAttempt(
      task.taskId,
      expectedDispatch.attempts,
      async () => {
        await markFailed();
        if (
          !(await completeAgentTeamRun(
            task.taskId,
            "failed",
            expectedDispatch.attempts,
          ))
        ) {
          throw new Error("The agent task run changed before it could fail.");
        }
      },
      {
        statuses: [expectedDispatch.status],
        ...(checkExpectedUpdatedAt
          ? { expectedUpdatedAt: expectedDispatch.updatedAt }
          : {}),
      },
    );
    if (!result.current) return task;
    const notificationReconciled = ownerEmail
      ? await ensureTaskCompletionNotification(task, ownerEmail)
      : true;
    if (progressReconciled && notificationReconciled) {
      await markTerminalTaskEffectsReconciled(task, expectedDispatch.attempts);
    }
    return task;
  }

  await markFailed();
  await completeAgentTeamRun(task.taskId, "failed");
  const notificationReconciled = ownerEmail
    ? await ensureTaskCompletionNotification(task, ownerEmail)
    : true;
  const dispatch = await getAgentTeamRunDispatchState(task.taskId);
  if (dispatch && progressReconciled && notificationReconciled) {
    await markTerminalTaskEffectsReconciled(task, dispatch.attempts);
  }
  return task;
}

function subAgentDispatchFailureMessage(err: unknown): string {
  return err instanceof Error
    ? `Failed to start sub-agent: ${err.message}`
    : "Failed to start sub-agent.";
}

async function refireStuckAgentTeamRunIfNeeded(
  task: AgentTask,
  dispatch: NonNullable<
    Awaited<ReturnType<typeof getAgentTeamRunDispatchState>>
  >,
  event?: any,
): Promise<void> {
  if (dispatch.status !== "queued" && dispatch.status !== "running") return;
  const idleFor = Date.now() - dispatch.updatedAt;
  if (idleFor < RUN_DISPATCH_STUCK_AFTER_MS) return;
  if (idleFor >= RUN_PROCESSING_STUCK_AFTER_MS) return;
  const now = Date.now();
  for (const [taskId, attemptedAt] of recentRunDispatchAttempts) {
    if (now - attemptedAt >= RUN_PROCESSING_STUCK_AFTER_MS) {
      recentRunDispatchAttempts.delete(taskId);
    }
  }
  const lastAttemptAt = recentRunDispatchAttempts.get(task.taskId);
  if (lastAttemptAt && now - lastAttemptAt < RUN_DISPATCH_RETRY_COOLDOWN_MS) {
    return;
  }
  // Tray reads can trigger reconciliation frequently; the durable sweep still
  // retries once a minute if the current dispatch attempt cannot reach a worker.
  recentRunDispatchAttempts.set(task.taskId, now);
  await dispatchAgentTeamRun({
    event,
    taskId: task.taskId,
    body: {
      mode: dispatch.continuationCount > 0 ? "continue" : "start",
      ...(dispatch.payload.noProgressCount !== undefined
        ? { noProgressCount: dispatch.payload.noProgressCount }
        : {}),
    },
  });
}

async function reconcileTaskWithRun(
  task: AgentTask,
  event?: any,
): Promise<AgentTask> {
  if (task.status !== "running" && task.terminalEffectsReconciled) return task;

  let dispatch: Awaited<ReturnType<typeof getAgentTeamRunDispatchState>>;
  try {
    dispatch = await getAgentTeamRunDispatchState(task.taskId);
  } catch (error) {
    console.warn(
      `[agent-teams] could not read dispatch state for task ${task.taskId}:`,
      describeDbError(error),
    );
    return task;
  }
  applyDispatchMetadataToTask(task, dispatch);

  if (task.status !== "running") {
    if (dispatch?.status === "queued" || dispatch?.status === "running") {
      try {
        await completeAgentTeamRunIfCurrent(
          task.taskId,
          task.status === "completed" ? "done" : "failed",
          dispatch,
        );
      } catch (error) {
        console.warn(
          `[agent-teams] could not repair terminal task ${task.taskId}:`,
          describeDbError(error),
        );
      }
    }
    if (dispatch?.status === "done" || dispatch?.status === "failed") {
      const ownerEmail = task.ownerEmail ?? getRequestUserEmail() ?? null;
      await reconcileTerminalTaskEffects(task, dispatch, ownerEmail);
    }
    return task;
  }

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
        "failed",
        dispatch,
      );
    }
    if (dispatch.status === "failed") {
      return await failReconciledTask(
        task,
        ownerEmail,
        task.error || task.summary || "Sub-agent run failed.",
      );
    }
    return await completeReconciledTask(task, ownerEmail, dispatch);
  }

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

async function reconcileTaskForRead(task: AgentTask): Promise<AgentTask> {
  const storedTask = structuredClone(task);
  try {
    return await reconcileTaskWithRun(task);
  } catch (error) {
    console.warn(
      `[agent-teams] could not reconcile task ${task.taskId} during read:`,
      describeDbError(error),
    );
    return storedTask;
  }
}

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
    } catch (error) {
      // Best-effort per task — one bad row shouldn't block the rest.
      console.warn(
        `[agent-teams] could not reconcile task ${taskId}:`,
        describeDbError(error),
      );
    }
  }
}

export async function reconcileStaleAgentTeamRuns(
  event?: any,
  limit = 50,
): Promise<{ examined: number; failed: number }> {
  const now = Date.now();
  const updatedBefore = now - RUN_DISPATCH_STUCK_AFTER_MS;
  const reconciliationAttemptedBefore = now - RUN_RECONCILIATION_RETRY_AFTER_MS;
  const candidates = await listStaleActiveAgentTeamRuns(
    updatedBefore,
    Math.min(
      Math.max(Math.floor(limit), 0),
      MAX_STALE_AGENT_TEAM_RUNS_PER_SWEEP,
    ),
    reconciliationAttemptedBefore,
  );
  const outcomes = await Promise.allSettled(
    candidates.map(async (candidate) => {
      const claimed = await claimAgentTeamRunReconciliationAttempt(
        candidate.taskId,
        updatedBefore,
        reconciliationAttemptedBefore,
      );
      if (!claimed) return false;

      try {
        await runWithRequestContext(
          {
            userEmail: candidate.ownerEmail,
            orgId: candidate.orgId ?? undefined,
          },
          async () => {
            const task = await loadTask(candidate.taskId);
            if (task) {
              await reconcileTaskWithRun(task, event);
            } else {
              await completeAgentTeamRun(candidate.taskId, "failed");
            }
          },
        );
        return true;
      } catch (error) {
        console.warn(
          `[agent-teams] stale run reconciliation failed for task ${candidate.taskId}:`,
          describeDbError(error),
        );
        throw error;
      }
    }),
  );
  const examined = outcomes.filter(
    (outcome) => outcome.status === "fulfilled" && outcome.value,
  ).length;
  const failed = outcomes.filter(
    (outcome) => outcome.status === "rejected",
  ).length;
  return { examined, failed };
}

function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function taskRunId(taskId: string): string {
  return `run-task-${taskId}`;
}

function taskRunChunkId(
  taskId: string,
  chunk: number,
  attempt?: number,
): string {
  return `${taskRunId(taskId)}${attempt === undefined ? "" : `-a${attempt}`}-c${chunk}`;
}

function transcriptRunIdsForAttempt(
  task: AgentTask,
  runId: string,
  continuationCount: number,
): string[] {
  const legacyIds = [taskRunId(task.taskId)];
  for (let i = 0; i <= continuationCount; i += 1) {
    legacyIds.push(taskRunChunkId(task.taskId, i));
  }
  return [...new Set([...legacyIds, ...(task.transcriptRunIds ?? []), runId])];
}

function taskIdFromBackgroundRunId(runId: string): string {
  const taskId = runId.startsWith("run-task-")
    ? runId.slice("run-task-".length)
    : runId;
  return taskId.match(/^(.*?)(?:-a\d+)?-c\d+$/)?.[1] ?? taskId;
}

async function resolveTaskIdFromBackgroundRunId(
  runId: string,
): Promise<string> {
  const rawTaskId = runId.startsWith("run-task-")
    ? runId.slice("run-task-".length)
    : runId;
  if (await loadTask(rawTaskId)) return rawTaskId;
  return taskIdFromBackgroundRunId(runId);
}

function runningInMemoryTaskRunId(taskId: string): string {
  const active = activeTaskRunIds.get(taskId);
  if (active) return active;
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
      return taskRunChunkId(
        taskId,
        dispatch.continuationCount,
        dispatch.attempts,
      );
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
): Promise<boolean> {
  const runId = task.runId ?? taskRunId(task.taskId);
  task.runId = runId;
  try {
    return Boolean(
      await completeProgressRun(runId, ownerEmail, status, {
        step,
        metadata: taskProgressMetadata(task),
      }),
    );
  } catch (error) {
    console.warn(
      `[agent-teams] could not complete task progress for ${task.taskId}:`,
      describeDbError(error),
    );
    return false;
  }
}

async function reconcileTerminalProgress(
  task: AgentTask,
  ownerEmail: string,
): Promise<boolean> {
  const runId = task.runId ?? taskRunId(task.taskId);
  try {
    const progress = await getProgressRun(runId, ownerEmail);
    if (progress?.status !== "running") return true;
    return await completeTaskProgressRun(
      task,
      ownerEmail,
      task.terminalProgressStatus ??
        (task.status === "completed" ? "succeeded" : "failed"),
      task.summary || task.error || "Task finished.",
    );
  } catch (error) {
    console.warn(
      `[agent-teams] could not reconcile task progress for ${task.taskId}:`,
      describeDbError(error),
    );
    return false;
  }
}

async function ensureTaskCompletionNotification(
  task: AgentTask,
  ownerEmail: string,
  hitContinuationLimit = false,
): Promise<boolean> {
  try {
    const { hasNotificationWithMetadata, insertNotification } =
      await import("../notifications/store.js");
    if (
      await hasNotificationWithMetadata(ownerEmail, {
        kind: "agent-team-complete",
        taskId: task.taskId,
      })
    ) {
      return true;
    }
    const name = task.name ?? task.description.slice(0, 60);
    const statusLabel =
      task.status === "completed"
        ? hitContinuationLimit
          ? "finished (hit limit)"
          : "finished"
        : "failed";
    await insertNotification({
      owner: ownerEmail,
      severity: task.status === "completed" ? "info" : "warning",
      title: `Sub-agent "${name}" ${statusLabel}`,
      body: task.summary.slice(0, 300) || undefined,
      idempotencyKey: `agent-team-complete:${task.taskId}`,
      metadata: {
        kind: "agent-team-complete",
        taskId: task.taskId,
        threadId: task.threadId,
        ...(task.parentThreadId ? { parentThreadId: task.parentThreadId } : {}),
      },
    });
    return true;
  } catch (error) {
    console.warn(
      `[agent-teams] could not notify completion for task ${task.taskId}:`,
      describeDbError(error),
    );
    return false;
  }
}

async function markTerminalTaskEffectsReconciled(
  task: AgentTask,
  attempts: number,
): Promise<void> {
  try {
    const result = await withCurrentAgentTeamRunAttempt(
      task.taskId,
      attempts,
      async () => {
        const currentTask = await loadTask(task.taskId);
        if (!currentTask || currentTask.terminalEffectsReconciled) return;
        currentTask.terminalEffectsReconciled = true;
        await saveTask(currentTask);
      },
      { statuses: ["done", "failed"] },
    );
    if (result.current) task.terminalEffectsReconciled = true;
  } catch (error) {
    console.warn(
      `[agent-teams] could not mark terminal effects reconciled for task ${task.taskId}:`,
      describeDbError(error),
    );
  }
}

async function reconcileTerminalTaskEffects(
  task: AgentTask,
  dispatch: NonNullable<
    Awaited<ReturnType<typeof getAgentTeamRunDispatchState>>
  >,
  ownerEmail: string | null,
): Promise<void> {
  if (task.terminalEffectsReconciled) return;

  try {
    let progressReconciled = true;
    let effectsPending = true;
    const result = await withCurrentAgentTeamRunAttempt(
      task.taskId,
      dispatch.attempts,
      async () => {
        const currentTask = await loadTask(task.taskId);
        if (currentTask?.terminalEffectsReconciled) {
          task.terminalEffectsReconciled = true;
          effectsPending = false;
          return;
        }
        if (task.parentThreadId && !task.parentCompletionEnqueued) {
          await appendParentCompletionInjection(task.parentThreadId, task, {
            taskStatus: task.status === "completed" ? "completed" : "errored",
            summary: task.summary || task.error || "Task finished.",
            hitContinuationLimit: task.hitContinuationLimit,
          });
          task.parentCompletionEnqueued = true;
          await saveTask(task);
        }
        if (ownerEmail) {
          progressReconciled = await reconcileTerminalProgress(
            task,
            ownerEmail,
          );
        }
      },
      { statuses: ["done", "failed"] },
    );
    if (result.current && effectsPending && progressReconciled) {
      const notificationReconciled = ownerEmail
        ? await ensureTaskCompletionNotification(
            task,
            ownerEmail,
            task.hitContinuationLimit,
          )
        : true;
      if (notificationReconciled) {
        await markTerminalTaskEffectsReconciled(task, dispatch.attempts);
      }
    }
  } catch (error) {
    console.warn(
      `[agent-teams] could not reconcile terminal effects for task ${task.taskId}:`,
      describeDbError(error),
    );
  }
}

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
    const failed = text.slice(-500) || "Task failed.";
    return {
      taskStatus: "errored",
      summary: failed,
      progressStatus: "failed",
      progressStep: "Task failed.",
      error: failed,
    };
  }
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
        metadata: {
          tool: payload.tool,
          input: redactArgsToValue(payload.input),
        },
      };
    case "tool_done":
      return {
        kind: "artifact",
        message: payload.result,
        metadata: {
          tool: payload.tool,
          input: redactArgsToValue(payload.input),
          result: redactTextToSummary(payload.result),
        },
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
      return {
        kind: "status",
        message: "",
        metadata: { agentChatEventType: "clear" },
      };
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
  description: string;
  instructions?: string;
  model?: string;
  ownerEmail: string;
  systemPrompt: string;
  actions: Record<string, ActionEntry>;
  engine?: AgentEngine;
  apiKey?: string;
  parentSend: (event: AgentChatEvent) => void;
  parentThreadId?: string;
  parentSourceAppId?: string | null;
  parentRunId?: string;
  name?: string;
  parentDelegationDepth?: number;
}

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

export async function spawnTask(opts: SpawnTaskOptions): Promise<AgentTask> {
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

  const parentSourceAppId = opts.parentSourceAppId?.trim();
  const thread = await createThread(opts.ownerEmail, {
    title: opts.description.slice(0, 100),
    ...(parentSourceAppId ? { source: { appId: parentSourceAppId } } : {}),
  });

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
  let orgId: string | null;
  if (hasRequestContext()) {
    orgId = getRequestOrgId() ?? null;
  } else {
    try {
      orgId = await resolveOrgIdForEmail(opts.ownerEmail);
    } catch {
      orgId = null;
    }
  }
  const task: AgentTask = {
    taskId,
    threadId: thread.id,
    ...(opts.parentThreadId ? { parentThreadId: opts.parentThreadId } : {}),
    ownerEmail: opts.ownerEmail,
    orgId,
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

  opts.parentSend({
    type: "agent_task",
    taskId,
    threadId: thread.id,
    description: opts.description,
    status: "running",
  });

  const payload: AgentTeamRunPayload = {
    description: opts.description,
    instructions: opts.instructions,
    model: opts.model,
    ...(opts.parentThreadId ? { parentThreadId: opts.parentThreadId } : {}),
    ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
    ...(opts.name ? { name: opts.name } : {}),
    ...(getRequestRunContext()?.allowedActionNames !== undefined
      ? { allowedActionNames: Object.keys(opts.actions) }
      : {}),
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
  } catch (err) {
    await failReconciledTask(
      task,
      opts.ownerEmail,
      subAgentDispatchFailureMessage(err),
    );
    return task;
  }

  try {
    await dispatchAgentTeamRun({
      taskId,
      body: { mode: "start" },
    });
  } catch (err) {
    console.warn(
      `[agent-teams] initial dispatch failed for task ${taskId}; the queued run remains retryable:`,
      describeDbError(err),
    );
  }

  return task;
}

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

async function persistTaskThreadData(
  task: AgentTask,
  description: string,
  run: ActiveRun,
  runId: string,
  turnId: string,
): Promise<string> {
  const { getThread, updateThreadData } =
    await import("../chat-threads/store.js");
  const thread = await getThread(task.threadId);
  if (!thread) throw new Error("Sub-agent thread disappeared before save.");
  let repo: any;
  try {
    repo = JSON.parse(thread.threadData || "{}");
  } catch (error) {
    throw new Error("Sub-agent thread data is unreadable.", { cause: error });
  }
  if (!Array.isArray(repo.messages)) repo.messages = [];

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

  const updated = await updateThreadData(
    task.threadId,
    JSON.stringify(repo),
    description.slice(0, 100),
    assistantText.slice(0, 200),
    Array.isArray(repo.messages) ? repo.messages.length : 1,
  );
  if (!updated) {
    throw new Error("Sub-agent thread data could not be saved.");
  }
  return assistantText;
}

async function failAgentTeamRunAfterActionPersistenceError(
  task: AgentTask,
  claimedAttempts: number,
  summaryText: string,
  error: unknown,
  hitContinuationLimit = false,
): Promise<void> {
  console.warn(
    `[agent-teams] result persistence failed for task ${task.taskId}; completed actions will not be retried:`,
    describeDbError(error),
  );
  if (!(await completeAgentTeamRun(task.taskId, "failed", claimedAttempts))) {
    throw new Error(
      "The agent task run changed before transcript failure was saved.",
    );
  }

  const failure =
    "Sub-agent result could not be saved. Automatic retry was stopped to avoid repeating completed actions.";
  const summary = summaryText.trim() || task.preview.trim() || failure;
  task.status = "errored";
  task.summary = summary.slice(-TASK_SUMMARY_MAX_CHARS);
  task.preview = task.summary.slice(-800);
  task.error = failure;
  task.currentStep = "";
  task.completedAt = Date.now();
  task.hitContinuationLimit = hitContinuationLimit;
  task.terminalEffectsVersion = 1;
  task.terminalEffectsReconciled = false;
  task.parentCompletionEnqueued = !task.parentThreadId;

  try {
    await saveTask(task);
  } catch (saveError) {
    console.warn(
      `[agent-teams] could not save transcript failure for task ${task.taskId}; the failed queue state prevents replay:`,
      describeDbError(saveError),
    );
  }
}

async function stopAgentTeamRunAfterActionPersistenceError(
  task: AgentTask,
  claimedAttempts: number,
  summaryText: string,
  error: unknown,
  ownerEmail: string | null,
  hitContinuationLimit = false,
): Promise<void> {
  await failAgentTeamRunAfterActionPersistenceError(
    task,
    claimedAttempts,
    summaryText,
    error,
    hitContinuationLimit,
  );
  const dispatch = await getAgentTeamRunDispatchState(task.taskId);
  if (dispatch) {
    await reconcileTerminalTaskEffects(task, dispatch, ownerEmail);
  }
}

async function finalizeAgentTeamRun(
  task: AgentTask,
  run: ActiveRun,
  ownerEmail: string | null,
  fullText: string,
  options: {
    hitContinuationLimit?: boolean;
    claimedAttempts: number;
    continuationCount: number;
    payload: AgentTeamRunPayload;
    runId: string;
  },
): Promise<void> {
  const result = await withCurrentAgentTeamRunAttempt(
    task.taskId,
    options.claimedAttempts,
    async () => {
      if (options.hitContinuationLimit) {
        await bumpAgentTeamContinuation(task.taskId, options.claimedAttempts, {
          requeue: false,
        });
      }
      const transcriptText = await persistTaskThreadData(
        task,
        task.description,
        run,
        options.runId,
        run.turnId,
      );
      const terminal = resolveTaskCompletion(run, transcriptText || fullText, {
        hitContinuationLimit: options.hitContinuationLimit,
      });
      const transcriptRunIds = transcriptRunIdsForAttempt(
        task,
        options.runId,
        options.continuationCount,
      );
      const completed = await completeAgentTeamRun(
        task.taskId,
        terminal.taskStatus === "completed" ? "done" : "failed",
        options.claimedAttempts,
        { ...options.payload, transcriptRunIds },
      );
      return completed ? { terminal, transcriptRunIds } : null;
    },
  ).catch(async (error) => {
    await stopAgentTeamRunAfterActionPersistenceError(
      task,
      options.claimedAttempts,
      fullText,
      error,
      ownerEmail,
      options.hitContinuationLimit,
    );
    return { current: false as const };
  });
  if (!result.current || !result.value) return;
  const { terminal, transcriptRunIds } = result.value;
  task.status = terminal.taskStatus;
  task.summary = terminal.summary;
  task.error = terminal.error;
  task.currentStep = "";
  task.completedAt = Date.now();
  task.hitContinuationLimit = options.hitContinuationLimit ?? false;
  task.terminalEffectsVersion = 1;
  task.terminalEffectsReconciled = false;
  task.terminalProgressStatus = terminal.progressStatus;
  task.transcriptRunIds = transcriptRunIds;
  task.parentCompletionEnqueued = !task.parentThreadId;
  try {
    await saveTask(task);
  } catch (error) {
    console.warn(
      `[agent-teams] terminal task projection failed for ${task.taskId}; queue state prevents action replay:`,
      describeDbError(error),
    );
    return;
  }
  try {
    const dispatch = await getAgentTeamRunDispatchState(task.taskId);
    if (dispatch) {
      await reconcileTerminalTaskEffects(task, dispatch, ownerEmail);
    }
  } catch (error) {
    console.warn(
      `[agent-teams] terminal effect reconciliation failed for ${task.taskId}; queue state prevents action replay:`,
      describeDbError(error),
    );
  }
}

export interface AgentTeamRunConfig {
  baseSystemPrompt: string;
  actions: Record<string, ActionEntry>;
  engine: AgentEngine;
  model: string;
  initialToolNames?: string[];
}

export interface ProcessAgentTeamRunOptions {
  taskId: string;
  mode?: "start" | "continue";
  event?: any;
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

export async function processAgentTeamRun(
  opts: ProcessAgentTeamRunOptions,
): Promise<{ ok: boolean; skipped?: string }> {
  const claimed = await claimAgentTeamRun(opts.taskId);
  if (!claimed) return { ok: true, skipped: "already-claimed-or-missing" };
  const persistedAllowedActionNames = readPersistedAllowedActionNames(
    claimed.payload,
  );
  const payload =
    persistedAllowedActionNames === undefined
      ? claimed.payload
      : {
          ...claimed.payload,
          allowedActionNames: persistedAllowedActionNames,
        };

  const claimedAttempts = claimed.attempts;
  const runId = taskRunChunkId(
    opts.taskId,
    claimed.continuationCount,
    claimedAttempts,
  );
  let lastSuccessfulHeartbeatAt = Date.now();
  let leaseLost = false;
  let heartbeatInFlight: Promise<void> | undefined;
  const markLeaseLost = () => {
    if (leaseLost) return;
    leaseLost = true;
    abortRun(runId, "superseded");
  };
  activeTaskRunIds.set(opts.taskId, runId);
  const heartbeat = setInterval(() => {
    if (leaseLost || heartbeatInFlight) return;
    heartbeatInFlight = touchAgentTeamRun(opts.taskId, claimedAttempts)
      .then(async (current) => {
        if (!current) {
          const dispatch = await getAgentTeamRunDispatchState(opts.taskId);
          if (
            dispatch?.attempts === claimedAttempts &&
            dispatch.status !== "running"
          ) {
            lastSuccessfulHeartbeatAt = Date.now();
            return;
          }
          markLeaseLost();
          return;
        }
        lastSuccessfulHeartbeatAt = Date.now();
      })
      .catch((err) => {
        console.warn(
          `[agent-teams] heartbeat update failed for task ${opts.taskId}:`,
          describeDbError(err),
        );
        if (
          Date.now() - lastSuccessfulHeartbeatAt >=
          RUN_DISPATCH_STUCK_AFTER_MS
        ) {
          markLeaseLost();
        }
      })
      .finally(() => {
        heartbeatInFlight = undefined;
      });
  }, RUN_QUEUE_HEARTBEAT_MS);
  (heartbeat as unknown as { unref?: () => void }).unref?.();

  const run = runWithRequestContext(
    {
      userEmail: claimed.ownerEmail ?? undefined,
      orgId: claimed.orgId ?? undefined,
      run:
        persistedAllowedActionNames === undefined
          ? undefined
          : { allowedActionNames: persistedAllowedActionNames },
    },
    async () => {
      const task = await loadTask(opts.taskId);
      if (!task) {
        await completeAgentTeamRun(opts.taskId, "failed", claimed.attempts);
        return { ok: true, skipped: "task-missing" };
      }
      if (claimed.payload.transcriptRunIds) {
        task.transcriptRunIds = [
          ...new Set([
            ...(task.transcriptRunIds ?? []),
            ...claimed.payload.transcriptRunIds,
          ]),
        ];
      }
      if (task.status !== "running") {
        await completeAgentTeamRun(
          opts.taskId,
          task.status === "completed" ? "done" : "failed",
          claimed.attempts,
        );
        return { ok: true, skipped: "task-terminal" };
      }

      const ownerEmail = claimed.ownerEmail ?? getRequestUserEmail() ?? "";
      const orgId = claimed.orgId;
      const turnId = payload.turnId || taskRunId(opts.taskId);

      let config: AgentTeamRunConfig;
      try {
        config = await opts.resolveConfig({ payload, ownerEmail, orgId });
        if (persistedAllowedActionNames !== undefined) {
          config = {
            ...config,
            actions: filterActionsByAllowedNames(
              config.actions,
              persistedAllowedActionNames,
            ),
          };
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? `Failed to prepare sub-agent: ${err.message}`
            : "Failed to prepare sub-agent.";
        await failReconciledTask(
          task,
          ownerEmail || null,
          message,
          "failed",
          claimed,
          false,
        );
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
        const { getThread } = await import("../chat-threads/store.js");
        const priorThreadData = (await getThread(task.threadId))?.threadData;
        messages = threadDataToEngineMessages(priorThreadData, {
          includeToolCalls: true,
        });
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

      const initialToolNames = config.initialToolNames;
      const baseActions = initialToolNames
        ? attachToolSearch({ ...config.actions })
        : config.actions;
      const messageAwareActions = createMessageAwareActions(
        opts.taskId,
        baseActions,
      );
      const availableTools = actionsToEngineTools(messageAwareActions);
      const tools = filterInitialEngineTools(availableTools, initialToolNames);

      if (leaseLost) return { ok: true, skipped: "superseded" };
      const started = await withCurrentAgentTeamRunAttempt(
        opts.taskId,
        claimedAttempts,
        async () => {
          task.currentStep =
            mode === "continue"
              ? "Continuing sub-agent"
              : "Working on response";
          task.startedAt = task.startedAt ?? Date.now();
          await saveTask(task);
          if (ownerEmail) await updateTaskProgressRun(task, ownerEmail);
        },
      );
      if (!started.current) {
        markLeaseLost();
        return { ok: true, skipped: "superseded" };
      }

      let accumulatedText = "";
      let lastProgressSent = 0;
      const PROGRESS_INTERVAL_MS = 2000;
      let consecutiveNoProgressChunks =
        claimed.payload.noProgressCount ?? opts.noProgressCount ?? 0;

      let chunkUsage:
        | import("../agent/production-agent.js").AgentLoopUsage
        | null = null;

      let progressWriteChain = Promise.resolve();
      let continuationDispatch: { noProgressCount: number } | undefined;
      const scheduleProgressWrite = () => {
        const snapshot: AgentTask = {
          ...task,
          ...(task.transcriptRunIds
            ? { transcriptRunIds: [...task.transcriptRunIds] }
            : {}),
        };
        progressWriteChain = progressWriteChain
          .then(async () => {
            if (leaseLost) return;
            const result = await withCurrentAgentTeamRunAttempt(
              opts.taskId,
              claimedAttempts,
              async () => {
                await saveTask(snapshot);
                if (ownerEmail) {
                  await updateTaskProgressRun(snapshot, ownerEmail);
                }
              },
            );
            if (!result.current) markLeaseLost();
          })
          .catch((err) => {
            console.warn(
              `[agent-teams] progress save failed for task ${task.taskId}:`,
              describeDbError(err),
            );
          });
      };

      await new Promise<void>((resolve) => {
        const startedRun = startRun(
          runId,
          task.threadId,
          async (send, signal) => {
            const wrappedSend = (event: AgentChatEvent) => {
              if (leaseLost) return;
              send(event);
              if (event.type === "text") {
                accumulatedText = applyAgentTextEventToBuffer(
                  accumulatedText,
                  event,
                );
                task.preview = accumulatedText.slice(-800);
                const now = Date.now();
                if (now - lastProgressSent >= PROGRESS_INTERVAL_MS) {
                  lastProgressSent = now;
                  scheduleProgressWrite();
                }
              } else if (event.type === "clear") {
                accumulatedText = applyAgentTextEventToBuffer(
                  accumulatedText,
                  event,
                );
                task.preview = "";
                lastProgressSent = Date.now();
                scheduleProgressWrite();
              } else if (event.type === "tool_start") {
                task.currentStep = `Running ${event.tool}...`;
                scheduleProgressWrite();
              } else if (event.type === "tool_done") {
                task.currentStep = "";
                scheduleProgressWrite();
              }
            };
            await runWithRequestContext(
              {
                userEmail: ownerEmail || undefined,
                orgId: orgId ?? undefined,
                run:
                  persistedAllowedActionNames === undefined
                    ? undefined
                    : { allowedActionNames: persistedAllowedActionNames },
              },
              () =>
                runWithDelegationDepth(task.delegationDepth ?? 1, async () => {
                  const agentLoopOpts = {
                    engine: config.engine,
                    model: config.model,
                    maxOutputTokens: resolveMainChatMaxOutputTokens(
                      config.model,
                    ),
                    reasoningEffort: resolveAgentRequestReasoningEffort({
                      model: config.model,
                    }),
                    systemPrompt,
                    tools,
                    availableTools,
                    messages,
                    actions: messageAwareActions,
                    send: wrappedSend,
                    signal,
                    finalResponseGuard: createTaskMessageFinalGuard(
                      opts.taskId,
                    ),
                  };

                  let instrumented = false;
                  try {
                    const { getObservabilityConfig, instrumentAgentLoop } =
                      await import("../observability/traces.js");
                    const observabilityConfig = await getObservabilityConfig();
                    if (observabilityConfig.enabled) {
                      instrumented = true;
                      chunkUsage = await instrumentAgentLoop({
                        runAgentLoop,
                        loopOpts: agentLoopOpts,
                        runId,
                        threadId: task.threadId,
                        userId: ownerEmail || null,
                        config: observabilityConfig,
                        metadata: {
                          source: "agent_team",
                          agent_team_task_id: opts.taskId,
                          continuation_count: claimed.continuationCount,
                          ...(payload.parentThreadId
                            ? { parent_thread_id: payload.parentThreadId }
                            : {}),
                        },
                        delegation: {
                          protocol: "agent-team",
                          callerApp: "agent-teams",
                          taskId: opts.taskId,
                          ...(payload.parentRunId
                            ? { parentRunId: payload.parentRunId }
                            : {}),
                        },
                      });
                    }
                  } catch (error) {
                    if (instrumented) throw error;
                  }
                  if (!instrumented) {
                    chunkUsage = await runAgentLoop(agentLoopOpts);
                  }
                }),
            );
          },
          async (run) => {
            await progressWriteChain;
            if (leaseLost) return;

            if (chunkUsage && ownerEmail) {
              try {
                const u = chunkUsage;
                if (
                  u.inputTokens > 0 ||
                  u.outputTokens > 0 ||
                  u.cacheReadTokens > 0 ||
                  u.cacheWriteTokens > 0 ||
                  u.builderCreditsUsed != null
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
                    builderCreditsUsed: u.builderCreditsUsed,
                    engineName: u.engineName ?? config.engine.name,
                    model: u.model,
                    label,
                  });
                }
              } catch (error) {
                console.warn(
                  `[agent-teams] could not record usage for task ${task.taskId}:`,
                  describeDbError(error),
                );
              }
            }

            const reachedBoundary = (run.events ?? []).some(
              (e) => e.event.type === "auto_continue",
            );
            if (reachedBoundary) {
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
              const canContinue =
                claimed.continuationCount + 1 <= MAX_AGENT_TEAM_CONTINUATIONS &&
                !hitNoProgressLimit;
              if (canContinue) {
                const continuation = await withCurrentAgentTeamRunAttempt(
                  opts.taskId,
                  claimedAttempts,
                  async () => {
                    const count = await bumpAgentTeamContinuation(
                      opts.taskId,
                      claimedAttempts,
                      { requeue: false },
                    );
                    if (
                      count !== claimed.continuationCount + 1 ||
                      count > MAX_AGENT_TEAM_CONTINUATIONS
                    ) {
                      throw new Error(
                        "The agent task continuation changed before it could be saved.",
                      );
                    }
                    const fullText = await persistTaskThreadData(
                      task,
                      payload.description,
                      run,
                      runId,
                      turnId,
                    );
                    const transcriptRunIds = transcriptRunIdsForAttempt(
                      task,
                      runId,
                      claimed.continuationCount,
                    );
                    task.transcriptRunIds = transcriptRunIds;
                    task.currentStep = "Continuing sub-agent";
                    task.preview = (fullText || accumulatedText).slice(-800);
                    if (
                      !(await requeueAgentTeamRunContinuation(
                        opts.taskId,
                        claimedAttempts,
                        {
                          ...payload,
                          noProgressCount: consecutiveNoProgressChunks,
                          transcriptRunIds,
                        },
                      ))
                    ) {
                      throw new Error(
                        "The agent task continuation could not be requeued.",
                      );
                    }
                    return { fullText, transcriptRunIds };
                  },
                ).catch(async (error) => {
                  await stopAgentTeamRunAfterActionPersistenceError(
                    task,
                    claimedAttempts,
                    accumulatedText,
                    error,
                    ownerEmail,
                  );
                  return { current: false as const };
                });
                if (!continuation.current) {
                  markLeaseLost();
                  return;
                }
                task.transcriptRunIds = continuation.value.transcriptRunIds;
                task.currentStep = "Continuing sub-agent";
                task.preview = (
                  continuation.value.fullText || accumulatedText
                ).slice(-800);
                try {
                  await saveTask(task);
                } catch (error) {
                  console.warn(
                    `[agent-teams] continuation task projection failed for ${task.taskId}; queued state prevents action replay:`,
                    describeDbError(error),
                  );
                }
                if (ownerEmail) await updateTaskProgressRun(task, ownerEmail);
                continuationDispatch = {
                  noProgressCount: consecutiveNoProgressChunks,
                };
                return;
              }
              await finalizeAgentTeamRun(
                task,
                run,
                ownerEmail || null,
                accumulatedText,
                {
                  hitContinuationLimit: true,
                  claimedAttempts,
                  continuationCount: claimed.continuationCount,
                  payload,
                  runId,
                },
              );
              return;
            }

            await finalizeAgentTeamRun(
              task,
              run,
              ownerEmail || null,
              accumulatedText,
              {
                claimedAttempts,
                continuationCount: claimed.continuationCount,
                payload,
                runId,
              },
            );
          },
          {
            useHostedSoftTimeoutDefault: true,
            turnId,
            // No userId here: `ownerEmail` is the only identity known at
            // this scope and is PII (email), which the terminal event must
            // not carry.
            model: config.model,
            engineName: config.engine.name,
            attemptCount: claimedAttempts,
            persistEvent: async (write, { terminal }) => {
              const result = await withCurrentAgentTeamRunAttempt(
                opts.taskId,
                claimedAttempts,
                write,
                terminal
                  ? { statuses: ["queued", "running", "done", "failed"] }
                  : undefined,
              );
              if (!result.current) {
                markLeaseLost();
                throw new Error("The agent task run attempt was superseded.");
              }
            },
          },
        );
        void startedRun.finalized
          .catch((error) => {
            console.warn(
              `[agent-teams] run finalization failed for task ${task.taskId}:`,
              describeDbError(error),
            );
          })
          .then(resolve);
      });
      if (continuationDispatch) {
        try {
          await dispatchAgentTeamRun({
            event: opts.event,
            taskId: opts.taskId,
            body: {
              mode: "continue",
              noProgressCount: continuationDispatch.noProgressCount,
            },
          });
        } catch (err) {
          console.warn(
            `[agent-teams] continuation dispatch failed for task ${task.taskId}; the queued run remains retryable:`,
            describeDbError(err),
          );
        }
      }

      return { ok: true };
    },
  );
  return await Promise.resolve(run).finally(async () => {
    clearInterval(heartbeat);
    await heartbeatInFlight;
    if (activeTaskRunIds.get(opts.taskId) === runId) {
      activeTaskRunIds.delete(opts.taskId);
    }
  });
}

export async function getTask(
  taskId: string,
  scope?: AgentTeamOwnerScope,
): Promise<AgentTask | undefined> {
  const task = await loadTask(taskId);
  if (!task || !taskMatchesOwnerScope(task, resolveOwnerScope(scope))) {
    return undefined;
  }
  return await reconcileTaskForRead(task);
}

export async function getTaskByThread(
  threadId: string,
  scope?: AgentTeamOwnerScope,
): Promise<AgentTask | undefined> {
  const task = await loadTaskByThread(threadId);
  if (!task || !taskMatchesOwnerScope(task, resolveOwnerScope(scope))) {
    return undefined;
  }
  return await reconcileTaskForRead(task);
}

export async function listTasks(
  scope?: AgentTeamOwnerScope,
): Promise<AgentTask[]> {
  const ownerScope = resolveOwnerScope(scope);
  const entries = await listAppState(TASK_PREFIX);
  const tasks = entries
    .map((e) => e.value as unknown as AgentTask)
    .filter((task) => taskMatchesOwnerScope(task, ownerScope));
  const reconciled = await Promise.all(tasks.map(reconcileTaskForRead));
  return reconciled.sort(
    (a, b) =>
      (b.updatedAt ?? b.completedAt ?? b.createdAt) -
      (a.updatedAt ?? a.completedAt ?? a.createdAt),
  );
}

export async function listAgentTeamBackgroundRuns(
  scope?: AgentTeamOwnerScope,
): Promise<AgentTeamBackgroundRun[]> {
  return (await listTasks(scope)).map(toAgentTaskBackgroundRun);
}

export async function getAgentTeamBackgroundRun(
  runId: string,
  scope?: AgentTeamOwnerScope,
): Promise<AgentTeamBackgroundRun | null> {
  const task = await getTask(
    await resolveTaskIdFromBackgroundRunId(runId),
    scope,
  );
  return task ? toAgentTaskBackgroundRun(task) : null;
}

export async function listAgentTeamBackgroundTranscriptEvents(
  runId: string,
  scope?: AgentTeamOwnerScope,
): Promise<AgentTeamBackgroundTranscriptEvent[]> {
  const taskId = await resolveTaskIdFromBackgroundRunId(runId);
  const ownerScope = resolveOwnerScope(scope);
  const task = await getTask(taskId, ownerScope);
  if (!task) return [];
  const normalizedRunId = taskRunId(taskId);
  const runIds = await transcriptRunIdsForTask(taskId, task);
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
  const rawTaskId = runId.startsWith("run-task-")
    ? runId.slice("run-task-".length)
    : runId;
  const activeTaskId = [...activeTaskRunIds.entries()].find(
    ([, activeRunId]) => activeRunId === runId,
  )?.[0];
  const taskId =
    activeTaskId ??
    (getRun(runId)?.status === "running"
      ? taskIdFromBackgroundRunId(runId)
      : rawTaskId);
  return subscribeToRun(runningInMemoryTaskRunId(taskId), fromSeq);
}

async function transcriptRunIdsForTask(
  taskId: string,
  task?: AgentTask,
): Promise<string[]> {
  let ids: string[];
  if (
    Array.isArray(task?.transcriptRunIds) &&
    task.transcriptRunIds.every((id) => typeof id === "string")
  ) {
    ids = [...task.transcriptRunIds];
  } else {
    const baseRunId = taskRunId(taskId);
    const continuationCount =
      (await getAgentTeamRunDispatchState(taskId))?.continuationCount ?? 0;

    ids = [baseRunId];
    for (let i = 0; i <= continuationCount; i += 1) {
      ids.push(taskRunChunkId(taskId, i));
    }
  }

  if (task?.status === "running") {
    const dispatch = await getAgentTeamRunDispatchState(taskId);
    if (dispatch?.status === "queued" || dispatch?.status === "running") {
      ids.push(
        taskRunChunkId(taskId, dispatch.continuationCount, dispatch.attempts),
      );
    }
  }
  return [...new Set(ids)];
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

export async function sendToTask(
  taskId: string,
  message: string,
  scope?: AgentTeamOwnerScope,
): Promise<{
  ok: boolean;
  error?: string;
  messageId?: string;
  queuedCount?: number;
}> {
  const task = await loadTask(taskId);
  if (!task || !taskMatchesOwnerScope(task, resolveOwnerScope(scope))) {
    return { ok: false, error: "Task not found" };
  }
  if (task.status !== "running")
    return { ok: false, error: "Task is not running" };
  if (message.trim().length === 0)
    return { ok: false, error: "Message is required" };

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
  scope?: AgentTeamOwnerScope,
): Promise<SendToAgentTeamBackgroundRunResult> {
  return sendToTask(taskIdFromBackgroundRunId(runId), message, scope);
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
  scope?: AgentTeamOwnerScope,
): Promise<ControlAgentTeamBackgroundRunResult> {
  const taskId = await resolveTaskIdFromBackgroundRunId(runId);
  const task = await loadTask(taskId);
  if (!task || !taskMatchesOwnerScope(task, resolveOwnerScope(scope))) {
    return { ok: false, error: "Task not found" };
  }
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

function resolveOwnerScope(
  scope?: AgentTeamOwnerScope,
): AgentTeamOwnerScope | undefined {
  if (scope) return scope;
  const ownerEmail = getRequestUserEmail();
  if (ownerEmail === undefined) return undefined;
  return {
    ownerEmail,
    orgId:
      typeof getRequestOrgId === "function" ? getRequestOrgId() : undefined,
  };
}

function taskMatchesOwnerScope(
  task: AgentTask,
  scope: AgentTeamOwnerScope | undefined,
): boolean {
  if (!scope) return true;
  return (
    (task.ownerEmail ?? null) === scope.ownerEmail &&
    (scope.orgId === undefined || (task.orgId ?? null) === scope.orgId)
  );
}

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
