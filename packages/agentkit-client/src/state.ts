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
} from "@agent-native/agentkit-protocol";
import { AgentProtocolValidationError } from "@agent-native/agentkit-protocol";

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
  /** @deprecated Prefer `activeRunIds`; retained for compatibility. */
  activeRunId?: RunId;
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
  return upsertMessage(messages, { ...message, parts, status: "streaming" });
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
): Pick<AgentThreadState, "activeRunId" | "activeRunIds"> {
  const activeRunIds = active
    ? Array.from(new Set([...thread.activeRunIds, runId]))
    : thread.activeRunIds.filter((id) => id !== runId);
  return {
    activeRunIds,
    activeRunId: active ? runId : activeRunIds.at(-1),
  };
}

export function reduceAgentEvent(
  thread: AgentThreadState,
  event: AgentEvent,
): AgentThreadState {
  if (event.threadId !== thread.id) return thread;
  const lastSequence = thread.runs[event.runId]?.lastSequence ?? 0;
  if (lastSequence >= event.sequence) {
    return thread;
  }
  const expectedSequence = lastSequence + 1;
  if (event.sequence !== expectedSequence) {
    throw new AgentProtocolValidationError(
      "event.sequence",
      `must be contiguous; expected ${expectedSequence} after ${lastSequence}, received ${event.sequence}`,
    );
  }

  let next = updateRun(thread, event.runId, {
    lastSequence: event.sequence,
  });
  next = { ...next, events: [...next.events, event] };
  switch (event.type) {
    case "run.started":
      return {
        ...updateRun(next, event.runId, {
          status: "running",
          startedAt: event.occurredAt,
        }),
        ...updateActiveRuns(next, event.runId, true),
      };
    case "run.status": {
      const active = !["completed", "failed", "cancelled"].includes(
        event.status,
      );
      return {
        ...updateRun(next, event.runId, { status: event.status }),
        ...updateActiveRuns(next, event.runId, active),
      };
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
        // Keep the participant projection for durable attribution while
        // making its live-roster state unambiguous for every consumer.
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
      return {
        ...updateRun(next, event.runId, {
          status: "completed",
          completedAt: event.occurredAt,
          usage: event.usage,
        }),
        ...updateActiveRuns(next, event.runId, false),
      };
    case "run.failed":
      return {
        ...updateRun(next, event.runId, {
          status: "failed",
          completedAt: event.occurredAt,
          error: event.error,
        }),
        ...updateActiveRuns(next, event.runId, false),
      };
    case "run.cancelled":
      return {
        ...updateRun(next, event.runId, {
          status: "cancelled",
          completedAt: event.occurredAt,
        }),
        ...updateActiveRuns(next, event.runId, false),
      };
    case "message.created":
      return {
        ...next,
        messages: upsertMessage(next.messages, event.message),
      };
    case "message.completed":
      return {
        ...next,
        messages: upsertMessage(next.messages, {
          ...event.message,
          status: event.message.status ?? "complete",
        }),
      };
    case "message.delta":
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
    case "tool.updated":
      return {
        ...next,
        tools: { ...next.tools, [event.toolCall.id]: event.toolCall },
      };
    case "tool.delta": {
      const current = next.tools[event.toolCallId];
      if (!current) return next;
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
        ...next,
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
      return { ...next, suggestions: event.suggestions };
    case "action.started":
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
