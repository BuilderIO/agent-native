import type {
  AgentActivity,
  AgentActionInvocation,
  AgentActionResult,
  AgentAnnotation,
  AgentApprovalRequest,
  AgentConnectionRequest,
  AgentArtifactReference,
  AgentCapabilities,
  AgentCapabilitiesDiscovery,
  AgentError,
  AgentEvent,
  AgentInteraction,
  AgentMessage,
  AgentParticipant,
  AgentQueuedMessage,
  AgentRunStatus,
  AgentSuggestion,
  AgentTask,
  AgentTaskGroup,
  AgentThread,
  AgentToolCall,
  AgentUsage,
  AgentUploadProgress,
  AgentWidget,
  RunId,
  ThreadId,
} from "../protocol/index.js";
import {
  AgentProtocolValidationError,
  agentEventSequenceEnd,
} from "../protocol/index.js";

export type AgentConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "error";

export interface AgentRunState {
  id: RunId;
  status: AgentRunStatus;
  lastSequence: number;
  activeMessageId?: string;
  /**
   * A streaming reply from an earlier run that this run is expected to
   * continue. Kept apart from `activeMessageId` until the run writes to it, so
   * a run that never does is not recorded as the reply's author.
   */
  inheritedMessageId?: string;
  startedAt?: string;
  completedAt?: string;
  usage?: AgentUsage;
  error?: AgentError;
}

export interface AgentThreadState {
  id: ThreadId;
  thread?: AgentThread;
  messages: AgentMessage[];
  queuedMessages: AgentQueuedMessage[];
  runs: Record<RunId, AgentRunState>;
  activeRunIds: RunId[];
  events: AgentEvent[];
  agents: Record<string, AgentParticipant>;
  agentInteractions: AgentInteraction[];
  activities: Record<string, AgentActivity>;
  tasks: Record<string, AgentTask>;
  taskGroups: Record<string, AgentTaskGroup>;
  tools: Record<string, AgentToolCall>;
  approvals: Record<string, AgentApprovalRequest>;
  approvalRunIds: Record<string, RunId>;
  connectionRequests: Record<string, AgentConnectionRequest>;
  connectionRequestRunIds: Record<string, RunId>;
  artifacts: AgentArtifactReference[];
  widgets: Record<string, AgentWidget>;
  widgetMessageIds: Record<string, string>;
  annotations: Record<string, AgentAnnotation>;
  annotationMessageIds: Record<string, string>;
  suggestions: AgentSuggestion[];
  /** A submitted user turn has not acquired its run identity yet. */
  suggestionsPendingTurn?: boolean;
  suggestionsUserMessageId?: string;
  actions: Record<
    string,
    {
      invocation?: AgentActionInvocation;
      result?: AgentActionResult;
    }
  >;
  uploads: Record<string, AgentUploadProgress>;
}

export interface AgentKitSnapshot {
  connection: AgentConnectionStatus;
  capabilities: AgentCapabilities;
  capabilityDiscovery?: AgentCapabilitiesDiscovery;
  capabilitiesStatus: "unknown" | "loading" | "ready" | "error";
  threads: Record<ThreadId, AgentThreadState>;
  error?: AgentError;
  revision: number;
}

export function createAgentThreadState(threadId: ThreadId): AgentThreadState {
  return {
    id: threadId,
    messages: [],
    queuedMessages: [],
    runs: {},
    activeRunIds: [],
    events: [],
    agents: {},
    agentInteractions: [],
    activities: {},
    tasks: {},
    taskGroups: {},
    tools: {},
    approvals: {},
    approvalRunIds: {},
    connectionRequests: {},
    connectionRequestRunIds: {},
    artifacts: [],
    widgets: {},
    widgetMessageIds: {},
    annotations: {},
    annotationMessageIds: {},
    suggestions: [],
    actions: {},
    uploads: {},
  };
}

export function hasActiveAgentRuns(
  thread: Pick<AgentThreadState, "activeRunIds"> &
    Partial<Pick<AgentThreadState, "runs" | "events" | "approvalRunIds">>,
): boolean {
  const resolvedApprovalIds = new Set<string>();
  const requestIdsByRun = new Map<RunId, Set<string>>();
  for (const event of thread.events ?? []) {
    if (event.type === "approval.requested") {
      const requestIds = requestIdsByRun.get(event.runId) ?? new Set<string>();
      requestIds.add(event.request.id);
      requestIdsByRun.set(event.runId, requestIds);
    } else if (event.type === "approval.resolved") {
      resolvedApprovalIds.add(event.approvalId);
    }
  }

  return thread.activeRunIds.some((runId) => {
    const status = thread.runs?.[runId]?.status;
    if (
      status === "completed" ||
      status === "failed" ||
      status === "cancelled"
    ) {
      return false;
    }
    if (status !== "awaiting_approval") return true;
    const requestIds = requestIdsByRun.get(runId) ?? new Set<string>();
    for (const [approvalId, approvalRunId] of Object.entries(
      thread.approvalRunIds ?? {},
    )) {
      if (approvalRunId === runId) requestIds.add(approvalId);
    }
    return (
      requestIds.size === 0 ||
      [...requestIds].some((approvalId) => !resolvedApprovalIds.has(approvalId))
    );
  });
}

export function selectLatestAgentRun(
  thread: AgentThreadState,
): AgentRunState | undefined {
  return Object.values(thread.runs).reduce<AgentRunState | undefined>(
    (latest, run) => {
      if (!latest) return run;
      const latestTime = latest.startedAt ?? latest.completedAt;
      const runTime = run.startedAt ?? run.completedAt;
      return latestTime && runTime && runTime < latestTime ? latest : run;
    },
    undefined,
  );
}

/** Only model-authored follow-ups belonging to the latest successful turn. */
export function selectAgentSuggestions(
  thread: AgentThreadState,
): AgentSuggestion[] {
  const run = selectLatestAgentRun(thread);
  if (
    !run ||
    run.status !== "completed" ||
    thread.suggestionsPendingTurn ||
    hasActiveAgentRuns(thread) ||
    Object.keys(thread.approvals).length > 0
  )
    return [];
  const latestUser = thread.messages.findLast(
    (message) => message.role === "user",
  );
  if (
    latestUser?.status === "error" ||
    thread.suggestionsUserMessageId !== latestUser?.id
  )
    return [];
  return thread.suggestions.filter((suggestion) => suggestion.runId === run.id);
}

export function isCurrentAgentSuggestion(
  thread: AgentThreadState,
  suggestion: AgentSuggestion,
): boolean {
  return selectAgentSuggestions(thread).some(
    (item) =>
      item.id === suggestion.id &&
      item.runId === suggestion.runId &&
      item.prompt === suggestion.prompt &&
      item.label === suggestion.label,
  );
}

export function selectActiveAgentRoster(
  agents: AgentThreadState["agents"],
): AgentParticipant[] {
  return Object.values(agents).filter(
    (participant) => participant.status !== "closed",
  );
}

function upsertMessage(
  messages: AgentMessage[],
  message: AgentMessage,
): AgentMessage[] {
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return [...messages, message];
  const next = [...messages];
  next[index] = message;
  return next;
}

function appendMessageText(
  messages: AgentMessage[],
  messageId: string,
  text: string,
  type: "text" | "reasoning",
  format?: Extract<AgentMessage["parts"][number], { type: "text" }>["format"],
): AgentMessage[] {
  const index = messages.findIndex((message) => message.id === messageId);
  const existing = index < 0 ? undefined : messages[index];
  const message: AgentMessage = existing ?? {
    id: messageId,
    role: "assistant",
    parts: [],
    status: "streaming",
  };
  if (existing?.status === "complete") return messages;
  const parts = [...message.parts];
  const last = parts.at(-1);
  if (last?.type === type) {
    parts[parts.length - 1] = {
      ...last,
      text: last.text + text,
      ...(type === "text" && format && last.type === "text" && !last.format
        ? { format }
        : {}),
    };
  } else {
    parts.push(
      type === "text"
        ? { type: "text", text, ...(format ? { format } : {}) }
        : { type: "reasoning", text, visibility: "summary" },
    );
  }
  return upsertMessage(messages, {
    ...message,
    parts,
    status: message.status === "complete" ? "complete" : "streaming",
  });
}

function updateRun(
  thread: AgentThreadState,
  runId: RunId,
  patch: Partial<AgentRunState>,
): AgentThreadState {
  const current = thread.runs[runId] ?? {
    id: runId,
    status: "queued",
    lastSequence: 0,
  };
  return {
    ...thread,
    runs: { ...thread.runs, [runId]: { ...current, ...patch } },
  };
}

function updateActiveRuns(
  thread: AgentThreadState,
  runId: RunId,
  active: boolean,
): Pick<AgentThreadState, "activeRunIds"> {
  return {
    activeRunIds: active
      ? Array.from(new Set([...thread.activeRunIds, runId]))
      : thread.activeRunIds.filter((id) => id !== runId),
  };
}

type AgentTerminalRunStatus = "completed" | "failed" | "cancelled";

function isTerminalRunStatus(
  status: AgentRunStatus,
): status is AgentTerminalRunStatus {
  return ["completed", "failed", "cancelled"].includes(status);
}

function isTerminalItemStatus(status: string | undefined): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

function wouldReopenTerminalItem(
  currentStatus: string | undefined,
  nextStatus: string | undefined,
): boolean {
  return (
    isTerminalItemStatus(currentStatus) && !isTerminalItemStatus(nextStatus)
  );
}

function isTerminalRunEvent(event: AgentEvent): boolean {
  return (
    event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.cancelled" ||
    (event.type === "run.status" && isTerminalRunStatus(event.status))
  );
}

function isExpectedTerminalFollowup(
  status: AgentTerminalRunStatus,
  event: AgentEvent,
): boolean {
  return (
    (status === "completed" && event.type === "run.completed") ||
    (status === "failed" && event.type === "run.failed") ||
    (status === "cancelled" && event.type === "run.cancelled")
  );
}

/** Drops requests still waiting on the user whose run `retire` selects. */
function retireConnectionRequests(
  thread: AgentThreadState,
  retire: (runId: RunId) => boolean,
): AgentThreadState {
  const retired = Object.entries(thread.connectionRequests).filter(
    ([id, request]) => {
      const runId = thread.connectionRequestRunIds[id];
      return (
        runId !== undefined &&
        (request.status === "requested" || request.status === "connecting") &&
        retire(runId)
      );
    },
  );
  if (retired.length === 0) return thread;
  const connectionRequests = { ...thread.connectionRequests };
  const connectionRequestRunIds = { ...thread.connectionRequestRunIds };
  for (const [id] of retired) {
    delete connectionRequests[id];
    delete connectionRequestRunIds[id];
  }
  return { ...thread, connectionRequests, connectionRequestRunIds };
}

function holdsMessage(run: AgentRunState, messageId: string): boolean {
  return (
    !isTerminalRunStatus(run.status) &&
    (run.activeMessageId === messageId || run.inheritedMessageId === messageId)
  );
}

type TimestampOrder =
  | { kind: "known"; value: number }
  | { kind: "absent" }
  | { kind: "unreadable" };

function timestampOrder(value: string | undefined): TimestampOrder {
  if (value === undefined) return { kind: "absent" };
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? { kind: "known", value: timestamp }
    : { kind: "unreadable" };
}

function knownTimestampValues(orders: TimestampOrder[]): number[] | undefined {
  const values: number[] = [];
  for (const order of orders) {
    if (order.kind !== "known") return undefined;
    values.push(order.value);
  }
  return values;
}

function terminalWriterStatus(writers: AgentRunState[]): "complete" | "error" {
  const startedAtOrders = knownTimestampValues(
    writers.map((run) => timestampOrder(run.startedAt)),
  );
  let latestWriters = writers;
  if (startedAtOrders) {
    const latestStartedAt = Math.max(...startedAtOrders);
    latestWriters = latestWriters.filter(
      (_run, index) => startedAtOrders[index] === latestStartedAt,
    );
  }
  const completedAtOrders = knownTimestampValues(
    latestWriters.map((run) => timestampOrder(run.completedAt)),
  );
  if (completedAtOrders) {
    const latestCompletedAt = Math.max(...completedAtOrders);
    latestWriters = latestWriters.filter(
      (_run, index) => completedAtOrders[index] === latestCompletedAt,
    );
  }
  // A completed writer leaves usable reply content when timestamps cannot order a tie.
  return latestWriters.some((run) => run.status === "completed")
    ? "complete"
    : "error";
}

function claimFoldedAssistant(
  thread: AgentThreadState,
  runId: RunId,
): AgentThreadState {
  const current = thread.runs[runId];
  if (
    !current ||
    isTerminalRunStatus(current.status) ||
    current.activeMessageId ||
    current.inheritedMessageId
  ) {
    return thread;
  }
  const currentOrder = timestampOrder(current.startedAt);
  if (currentOrder.kind !== "known") return thread;
  let inherited: { messageId: string; order: number; runId: RunId } | undefined;
  for (const run of Object.values(thread.runs)) {
    if (run.id === runId) continue;
    const held = run.activeMessageId ?? run.inheritedMessageId;
    if (!held) continue;
    const order = timestampOrder(run.startedAt);
    if (order.kind !== "known" || order.value > currentOrder.value) continue;
    const message = thread.messages.find((item) => item.id === held);
    if (message?.role === "assistant" && message.status === "streaming") {
      if (
        !inherited ||
        order.value > inherited.order ||
        (order.value === inherited.order && run.id < inherited.runId)
      ) {
        inherited = { messageId: held, order: order.value, runId: run.id };
      }
    }
  }
  return inherited
    ? updateRun(thread, runId, { inheritedMessageId: inherited.messageId })
    : thread;
}

export function reconcileFoldedAssistantClaims(
  thread: AgentThreadState,
): AgentThreadState {
  const activeRuns = Object.values(thread.runs)
    .filter((run) => !isTerminalRunStatus(run.status))
    .sort((left, right) => {
      const leftOrder = timestampOrder(left.startedAt);
      const rightOrder = timestampOrder(right.startedAt);
      if (leftOrder.kind === "known" && rightOrder.kind === "known") {
        if (leftOrder.value !== rightOrder.value) {
          return leftOrder.value < rightOrder.value ? -1 : 1;
        }
      } else if (leftOrder.kind === "known") {
        return 1;
      } else if (rightOrder.kind === "known") {
        return -1;
      }
      return left.id.localeCompare(right.id);
    });
  return activeRuns.reduce(
    (current, run) => claimFoldedAssistant(current, run.id),
    thread,
  );
}

/**
 * Settles a shared reply from its latest-started terminal writer once no run
 * can extend it.
 */
function releaseSharedMessage(
  thread: AgentThreadState,
  messageId: string,
): AgentThreadState {
  const runs = Object.values(thread.runs);
  if (runs.some((run) => holdsMessage(run, messageId))) return thread;
  const writers = runs.filter(
    (run) =>
      isTerminalRunStatus(run.status) && run.activeMessageId === messageId,
  );
  if (!writers.length) return thread;
  const status = terminalWriterStatus(writers);
  return {
    ...thread,
    messages: thread.messages.map((message) =>
      message.id === messageId && message.status === "streaming"
        ? { ...message, status }
        : message,
    ),
  };
}

function assignActiveMessage(
  thread: AgentThreadState,
  runId: RunId,
  messageId: string,
): AgentThreadState {
  const { inheritedMessageId, ...run } = thread.runs[runId] ?? {
    id: runId,
    status: "queued" as const,
    lastSequence: 0,
  };
  const previous = run.activeMessageId ?? inheritedMessageId;
  let next: AgentThreadState = {
    ...thread,
    runs: { ...thread.runs, [runId]: { ...run, activeMessageId: messageId } },
  };
  // A continuation can write after its predecessor completes the message,
  // even before that predecessor's run finishes.
  const message = next.messages.find((item) => item.id === messageId);
  if (
    message?.role === "assistant" &&
    message.status === "complete" &&
    Object.values(thread.runs).some(
      (other) =>
        other.id !== runId &&
        (holdsMessage(other, messageId) ||
          (isTerminalRunStatus(other.status) &&
            other.activeMessageId === messageId)),
    )
  ) {
    next = {
      ...next,
      messages: upsertMessage(next.messages, {
        ...message,
        status: "streaming",
      }),
    };
  }
  if (!previous || previous === messageId) return next;
  return releaseSharedMessage(next, previous);
}

export function settleRunProjection(
  thread: AgentThreadState,
  runId: RunId,
  status: AgentTerminalRunStatus,
  completedAt: string,
  activeMessageId?: string,
  // The run's own outcome when `status` is only how its unconfirmed items are
  // settled.
  runStatus: AgentTerminalRunStatus = status,
): AgentThreadState {
  const settled = settleRunItems(
    thread,
    runId,
    status,
    completedAt,
    activeMessageId,
  );
  // A completed run that yielded to a request legitimately waits for the user;
  // a failed or cancelled one can no longer use the answer.
  return runStatus === "completed"
    ? settled
    : retireConnectionRequests(settled, (id) => id === runId);
}

/**
 * Event order retires a request when a newer run starts; a loaded snapshot has
 * no order left to replay, so its runs' start times stand in for it.
 */
export function retireSupersededConnectionRequests(
  thread: AgentThreadState,
): AgentThreadState {
  // An unreadable start time is NaN: it never ranks as latest and is never
  // older than the latest, so its requests stay.
  const startedAt = (runId: RunId) =>
    Date.parse(thread.runs[runId]?.startedAt ?? "");
  const latestStartedAt = Math.max(
    ...Object.keys(thread.runs)
      .map(startedAt)
      .filter((time) => !Number.isNaN(time)),
  );
  return retireConnectionRequests(
    thread,
    (runId) => startedAt(runId) < latestStartedAt,
  );
}

function settleRunItems(
  thread: AgentThreadState,
  runId: RunId,
  status: AgentTerminalRunStatus,
  completedAt: string,
  activeMessageId?: string,
): AgentThreadState {
  const messageIds = new Set<string>();
  const recordedMessageId = thread.runs[runId]?.activeMessageId;
  if (recordedMessageId) messageIds.add(recordedMessageId);
  if (activeMessageId) messageIds.add(activeMessageId);
  const toolIds = new Set<string>();
  const activityIds = new Set<string>();
  const taskIds = new Set<string>();
  const taskGroupIds = new Set<string>();
  const actionIds = new Set<string>();
  for (const event of thread.events) {
    if (event.runId !== runId) continue;
    switch (event.type) {
      case "message.created":
      case "message.completed":
        messageIds.add(event.message.id);
        break;
      case "message.delta":
      case "reasoning.delta":
        messageIds.add(event.messageId);
        break;
      case "tool.started":
      case "tool.updated":
        toolIds.add(event.toolCall.id);
        break;
      case "tool.delta":
        toolIds.add(event.toolCallId);
        break;
      case "activity.started":
      case "activity.updated":
      case "activity.completed":
        activityIds.add(event.activity.id);
        break;
      case "task.created":
      case "task.updated":
      case "task.completed":
        taskIds.add(event.task.id);
        break;
      case "task-group.created":
      case "task-group.updated":
      case "task-group.completed":
        taskGroupIds.add(event.taskGroup.id);
        break;
      case "action.started":
        actionIds.add(event.invocation.id);
        break;
      case "action.completed":
      case "action.failed":
        actionIds.add(event.result.invocationId);
        break;
      default:
        break;
    }
  }
  let runs = thread.runs;
  const settlingRunOrder = timestampOrder(thread.runs[runId]?.startedAt);
  for (const run of Object.values(thread.runs)) {
    if (run.id === runId) continue;
    if (isTerminalRunStatus(run.status)) continue;
    if (run.activeMessageId || run.inheritedMessageId) {
      continue;
    }
    const foldedMessageId =
      thread.runs[runId]?.activeMessageId ?? activeMessageId;
    const runOrder = timestampOrder(run.startedAt);
    if (run.status === "queued" && runOrder.kind !== "known") continue;
    if (
      (settlingRunOrder.kind === "known" &&
        runOrder.kind === "known" &&
        runOrder.value < settlingRunOrder.value) ||
      !foldedMessageId ||
      !messageIds.has(foldedMessageId)
    ) {
      continue;
    }
    const folded = thread.messages.find(
      (message) => message.id === foldedMessageId,
    );
    if (folded?.role !== "assistant" || folded.status !== "streaming") continue;
    runs = {
      ...runs,
      [run.id]: { ...run, inheritedMessageId: foldedMessageId },
    };
  }
  const settleStatus = <
    T extends { status: "running" | AgentTerminalRunStatus },
  >(
    item: T,
  ): T => (item.status === "running" ? { ...item, status } : item);
  const settleTaskStatus = <T extends { status: AgentTask["status"] }>(
    item: T,
  ): T =>
    ["pending", "running", "awaiting_input"].includes(item.status)
      ? { ...item, status }
      : item;
  const terminalActionStatus =
    status === "completed"
      ? "completed"
      : status === "cancelled"
        ? "cancelled"
        : "failed";
  const terminalActionError =
    terminalActionStatus === "failed"
      ? {
          code: "run_terminated",
          message: "The run ended before the action reported a result.",
        }
      : undefined;
  const terminalWriterCounts = new Map<string, number>();
  for (const run of Object.values(runs)) {
    if (!isTerminalRunStatus(run.status) || !run.activeMessageId) continue;
    terminalWriterCounts.set(
      run.activeMessageId,
      (terminalWriterCounts.get(run.activeMessageId) ?? 0) + 1,
    );
  }
  const heldMessageIds = new Set(
    Object.values(runs)
      .filter((run) => !isTerminalRunStatus(run.status))
      .flatMap((run) => [run.activeMessageId, run.inheritedMessageId])
      .filter((messageId): messageId is string => messageId !== undefined),
  );
  const settled: AgentThreadState = {
    ...thread,
    runs,
    messages: thread.messages.map((message) => {
      if (message.status !== "streaming" || !messageIds.has(message.id)) {
        return message;
      }
      if (
        heldMessageIds.has(message.id) ||
        (terminalWriterCounts.get(message.id) ?? 0) > 1
      ) {
        return message;
      }
      return {
        ...message,
        status: status === "completed" ? "complete" : "error",
      };
    }),
    tools: Object.fromEntries(
      Object.entries(thread.tools).map(([id, tool]) => [
        id,
        toolIds.has(id) || tool.runId === runId ? settleStatus(tool) : tool,
      ]),
    ),
    activities: Object.fromEntries(
      Object.entries(thread.activities).map(([id, activity]) => [
        id,
        activityIds.has(id) || activity.runId === runId
          ? {
              ...settleStatus(activity),
              completedAt: activity.completedAt ?? completedAt,
            }
          : activity,
      ]),
    ),
    tasks: Object.fromEntries(
      Object.entries(thread.tasks).map(([id, task]) => [
        id,
        taskIds.has(id) || task.runId === runId
          ? {
              ...settleTaskStatus(task),
              completedAt: task.completedAt ?? completedAt,
            }
          : task,
      ]),
    ),
    taskGroups: Object.fromEntries(
      Object.entries(thread.taskGroups).map(([id, taskGroup]) => [
        id,
        (taskGroupIds.has(id) || taskGroup.runId === runId) &&
        taskGroup.status !== undefined &&
        ["pending", "running", "awaiting_input"].includes(taskGroup.status)
          ? {
              ...taskGroup,
              status,
              completedAt: taskGroup.completedAt ?? completedAt,
            }
          : taskGroup,
      ]),
    ),
    actions: Object.fromEntries(
      Object.entries(thread.actions).map(([id, action]) => {
        if (!actionIds.has(id) && action.invocation?.runId !== runId) {
          return [id, action];
        }
        if (action.result || !action.invocation) return [id, action];
        return [
          id,
          {
            ...action,
            result: {
              invocationId: action.invocation.id,
              status: terminalActionStatus,
              ...(terminalActionError ? { error: terminalActionError } : {}),
            },
          },
        ];
      }),
    ),
  };
  const sharedMessageIds = new Set(messageIds);
  const inheritedMessageId = settled.runs[runId]?.inheritedMessageId;
  if (inheritedMessageId) sharedMessageIds.add(inheritedMessageId);
  let reconciled = settled;
  for (const messageId of sharedMessageIds) {
    reconciled = releaseSharedMessage(reconciled, messageId);
  }
  return reconciled;
}

export type AgentEventAdmission =
  | { status: "foreign" }
  | { status: "accepted"; sequence: number }
  | { status: "duplicate"; lastSequence: number }
  | { status: "gap"; expectedSequence: number; receivedSequence: number };

export function classifyAgentEvent(
  thread: AgentThreadState,
  event: AgentEvent,
): AgentEventAdmission {
  if (event.threadId !== thread.id) return { status: "foreign" };
  const lastSequence = thread.runs[event.runId]?.lastSequence ?? 0;
  const sequenceEnd = agentEventSequenceEnd(event);
  if (lastSequence >= sequenceEnd) {
    return { status: "duplicate", lastSequence };
  }
  const expectedSequence = lastSequence + 1;
  if (event.sequence !== expectedSequence) {
    return {
      status: "gap",
      expectedSequence,
      receivedSequence: event.sequence,
    };
  }
  return { status: "accepted", sequence: sequenceEnd };
}

export function reduceAgentEvent(
  thread: AgentThreadState,
  event: AgentEvent,
): AgentThreadState {
  const currentRun = thread.runs[event.runId];
  const hasTerminalEvent = thread.events.some(
    (candidate) =>
      candidate.runId === event.runId && isTerminalRunEvent(candidate),
  );
  if (
    currentRun &&
    isTerminalRunStatus(currentRun.status) &&
    !isExpectedTerminalFollowup(currentRun.status, event) &&
    (currentRun.status !== "failed" || hasTerminalEvent)
  ) {
    return thread;
  }
  const admission = classifyAgentEvent(thread, event);
  if (admission.status === "foreign" || admission.status === "duplicate") {
    return thread;
  }
  if (admission.status === "gap") {
    throw new AgentProtocolValidationError(
      "event.sequence",
      `must be contiguous; expected ${admission.expectedSequence} after ${admission.expectedSequence - 1}, received ${admission.receivedSequence}`,
    );
  }

  let next = updateRun(thread, event.runId, {
    lastSequence: admission.sequence,
  });
  next = { ...next, events: [...next.events, event] };
  switch (event.type) {
    case "run.started":
      return claimFoldedAssistant(
        retireConnectionRequests(
          {
            ...updateRun(next, event.runId, {
              status: "running",
              startedAt: event.occurredAt,
            }),
            ...updateActiveRuns(next, event.runId, true),
            suggestions: [],
            suggestionsPendingTurn: false,
          },
          (id) => id !== event.runId,
        ),
        event.runId,
      );
    case "run.status": {
      const terminal = isTerminalRunStatus(event.status);
      const updated = {
        ...updateRun(next, event.runId, {
          status: event.status,
          ...(terminal ? { completedAt: event.occurredAt } : {}),
        }),
        ...updateActiveRuns(next, event.runId, !terminal),
      };
      return terminal
        ? settleRunProjection(
            updated,
            event.runId,
            event.status as AgentTerminalRunStatus,
            event.occurredAt,
          )
        : updated;
    }
    case "agent.registered":
    case "agent.updated":
      return {
        ...next,
        agents: { ...next.agents, [event.agent.id]: event.agent },
      };
    case "agent.unregistered":
      return {
        ...next,
        agents: {
          ...next.agents,
          [event.agent.id]: {
            ...event.agent,
            status: "closed",
            completedAt: event.agent.completedAt ?? event.occurredAt,
          },
        },
      };
    case "agent.interaction":
      if (
        next.agentInteractions.some(
          (interaction) => interaction.id === event.interaction.id,
        )
      ) {
        return next;
      }
      return {
        ...next,
        agentInteractions: [...next.agentInteractions, event.interaction],
      };
    case "run.completed":
      return settleRunProjection(
        {
          ...updateRun(next, event.runId, {
            status: "completed",
            completedAt: event.occurredAt,
            usage: event.usage,
          }),
          ...updateActiveRuns(next, event.runId, false),
        },
        event.runId,
        "completed",
        event.occurredAt,
      );
    case "run.failed":
      return settleRunProjection(
        {
          ...updateRun(next, event.runId, {
            status: "failed",
            completedAt: event.occurredAt,
            error: event.error,
          }),
          ...updateActiveRuns(next, event.runId, false),
        },
        event.runId,
        "failed",
        event.occurredAt,
      );
    case "run.cancelled":
      return settleRunProjection(
        {
          ...updateRun(next, event.runId, {
            status: "cancelled",
            completedAt: event.occurredAt,
          }),
          ...updateActiveRuns(next, event.runId, false),
        },
        event.runId,
        "cancelled",
        event.occurredAt,
      );
    case "message.created": {
      if (event.message.role === "assistant") {
        next = assignActiveMessage(next, event.runId, event.message.id);
      }
      const current = next.messages.find(
        (message) => message.id === event.message.id,
      );
      if (current?.status === "complete") return next;
      if (current?.status === "streaming" && current.parts.length > 0) {
        return {
          ...next,
          messages: upsertMessage(next.messages, {
            ...event.message,
            ...current,
            status: "streaming",
          }),
        };
      }
      return {
        ...next,
        messages: upsertMessage(next.messages, event.message),
      };
    }
    case "message.completed": {
      if (event.message.role === "assistant") {
        next = assignActiveMessage(next, event.runId, event.message.id);
      }
      const current = next.messages.find(
        (message) => message.id === event.message.id,
      );
      if (current?.status === "complete") return next;
      // The predecessor finishing its part does not finish a reply a
      // continuation is still writing.
      const status = Object.values(next.runs).some(
        (run) => run.id !== event.runId && holdsMessage(run, event.message.id),
      )
        ? "streaming"
        : (event.message.status ?? "complete");
      if (
        current?.status === "streaming" &&
        current.parts.length > 0 &&
        event.message.parts.length === 0
      ) {
        return {
          ...next,
          messages: upsertMessage(next.messages, {
            ...current,
            ...event.message,
            parts: current.parts,
            status,
          }),
        };
      }
      return {
        ...next,
        messages: upsertMessage(next.messages, { ...event.message, status }),
      };
    }
    case "message.delta":
      next = assignActiveMessage(next, event.runId, event.messageId);
      return {
        ...next,
        messages: appendMessageText(
          next.messages,
          event.messageId,
          event.text,
          "text",
          event.format,
        ),
      };
    case "reasoning.delta":
      next = assignActiveMessage(next, event.runId, event.messageId);
      return {
        ...next,
        messages: appendMessageText(
          next.messages,
          event.messageId,
          event.text,
          "reasoning",
        ),
      };
    case "tool.started":
    case "tool.updated": {
      if (
        wouldReopenTerminalItem(
          next.tools[event.toolCall.id]?.status,
          event.toolCall.status,
        )
      ) {
        return next;
      }
      const currentToolCall = next.tools[event.toolCall.id];
      const toolCall =
        event.type === "tool.updated"
          ? {
              ...event.toolCall,
              ...(event.toolCall.messageId === undefined &&
              currentToolCall?.messageId !== undefined
                ? { messageId: currentToolCall.messageId }
                : {}),
              ...(event.toolCall.input === undefined &&
              currentToolCall?.input !== undefined
                ? { input: currentToolCall.input }
                : {}),
              ...(event.toolCall.output === undefined &&
              currentToolCall?.output !== undefined
                ? { output: currentToolCall.output }
                : {}),
            }
          : event.toolCall;
      return {
        ...next,
        tools: { ...next.tools, [event.toolCall.id]: toolCall },
      };
    }
    case "tool.delta": {
      const current =
        next.tools[event.toolCallId] ??
        ({
          id: event.toolCallId,
          name:
            typeof event.metadata?.toolName === "string"
              ? event.metadata.toolName
              : event.toolCallId,
          status: "running",
          runId: event.runId,
        } satisfies AgentToolCall);
      if (isTerminalItemStatus(current.status)) return next;
      const input =
        event.inputTextDelta === undefined
          ? current.input
          : `${typeof current.input === "string" ? current.input : ""}${event.inputTextDelta}`;
      const output =
        event.outputTextDelta === undefined
          ? current.output
          : `${typeof current.output === "string" ? current.output : ""}${event.outputTextDelta}`;
      return {
        ...next,
        tools: {
          ...next.tools,
          [event.toolCallId]: { ...current, input, output },
        },
      };
    }
    case "activity.started":
    case "activity.updated":
    case "activity.completed":
      if (
        wouldReopenTerminalItem(
          next.activities[event.activity.id]?.status,
          event.activity.status,
        )
      ) {
        return next;
      }
      return {
        ...next,
        activities: {
          ...next.activities,
          [event.activity.id]: event.activity,
        },
      };
    case "task.created":
    case "task.updated":
    case "task.completed":
      if (
        wouldReopenTerminalItem(
          next.tasks[event.task.id]?.status,
          event.task.status,
        )
      ) {
        return next;
      }
      return {
        ...next,
        tasks: {
          ...next.tasks,
          [event.task.id]: event.task,
        },
      };
    case "task-group.created":
    case "task-group.updated":
    case "task-group.completed":
      if (
        wouldReopenTerminalItem(
          next.taskGroups[event.taskGroup.id]?.status,
          event.taskGroup.status,
        )
      ) {
        return next;
      }
      return {
        ...next,
        taskGroups: {
          ...next.taskGroups,
          [event.taskGroup.id]: event.taskGroup,
        },
      };
    case "task-group.removed": {
      const taskGroups = { ...next.taskGroups };
      delete taskGroups[event.taskGroupId];
      return { ...next, taskGroups };
    }
    case "approval.requested":
      return {
        ...updateRun(next, event.runId, { status: "awaiting_approval" }),
        ...updateActiveRuns(next, event.runId, true),
        approvals: { ...next.approvals, [event.request.id]: event.request },
        approvalRunIds: {
          ...next.approvalRunIds,
          [event.request.id]: event.runId,
        },
      };
    case "approval.resolved": {
      const approvals = { ...next.approvals };
      const approvalRunIds = { ...next.approvalRunIds };
      delete approvals[event.approvalId];
      delete approvalRunIds[event.approvalId];
      return { ...next, approvals, approvalRunIds };
    }
    case "connection.requested":
    case "connection.updated":
      return {
        ...next,
        connectionRequests: {
          ...next.connectionRequests,
          [event.request.id]: event.request,
        },
        connectionRequestRunIds: {
          ...next.connectionRequestRunIds,
          [event.request.id]: event.runId,
        },
      };
    case "artifact.created":
      return {
        ...next,
        artifacts: [
          ...next.artifacts.filter((item) => item.id !== event.artifact.id),
          event.artifact,
        ],
      };
    case "widget.created":
    case "widget.updated":
      return {
        ...next,
        widgets: { ...next.widgets, [event.widget.id]: event.widget },
        widgetMessageIds: {
          ...next.widgetMessageIds,
          ...(event.messageId ? { [event.widget.id]: event.messageId } : {}),
        },
      };
    case "widget.removed": {
      const widgets = { ...next.widgets };
      const widgetMessageIds = { ...next.widgetMessageIds };
      delete widgets[event.widgetId];
      delete widgetMessageIds[event.widgetId];
      return { ...next, widgets, widgetMessageIds };
    }
    case "annotation.created":
    case "annotation.updated":
      return {
        ...next,
        annotations: {
          ...next.annotations,
          [event.annotation.id]: event.annotation,
        },
        annotationMessageIds: {
          ...next.annotationMessageIds,
          ...(event.messageId
            ? { [event.annotation.id]: event.messageId }
            : {}),
        },
      };
    case "annotation.removed": {
      const annotations = { ...next.annotations };
      const annotationMessageIds = { ...next.annotationMessageIds };
      delete annotations[event.annotationId];
      delete annotationMessageIds[event.annotationId];
      return { ...next, annotations, annotationMessageIds };
    }
    case "suggestions.updated":
      if (
        next.suggestionsPendingTurn ||
        selectLatestAgentRun(next)?.id !== event.runId
      )
        return next;
      return {
        ...next,
        suggestionsUserMessageId: next.messages.findLast(
          (message) => message.role === "user",
        )?.id,
        suggestions: event.suggestions.map((suggestion) => ({
          ...suggestion,
          runId: event.runId,
        })),
      };
    case "action.started":
      if (next.actions[event.invocation.id]?.result) return next;
      return {
        ...next,
        actions: {
          ...next.actions,
          [event.invocation.id]: { invocation: event.invocation },
        },
      };
    case "action.completed":
    case "action.failed":
      return {
        ...next,
        actions: {
          ...next.actions,
          [event.result.invocationId]: {
            ...next.actions[event.result.invocationId],
            result: event.result,
          },
        },
      };
    case "upload.progress":
      return {
        ...next,
        uploads: {
          ...next.uploads,
          [event.progress.uploadId]: event.progress,
        },
      };
    case "thread.updated":
      return { ...next, thread: event.thread };
    case "queue.updated":
      return { ...next, queuedMessages: event.messages };
    default:
      return next;
  }
}
