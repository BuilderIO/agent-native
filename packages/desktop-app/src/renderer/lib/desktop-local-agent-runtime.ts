import type {
  AgentChatRuntime,
  AgentChatRuntimeCancelResult,
  AgentChatRuntimeEvent,
  AgentChatRuntimeSession,
  AgentChatRuntimeTurn,
  AgentChatRuntimeTurnInput,
} from "@agent-native/core/client/agent-chat";
import type { CodeAgentTranscriptEvent } from "@shared/ipc-channels";

export const DESKTOP_LOCAL_AGENT_OPTIONS = [
  {
    id: "default",
    label: "Default",
    description: "Agent Native hosted chat",
    configured: true,
  },
  {
    id: "codex",
    label: "Codex",
    description: "Run locally with Codex CLI",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    description: "Run locally with Claude Code",
  },
  {
    id: "pi",
    label: "Pi",
    description: "Run locally with Pi",
  },
  {
    id: "opencode",
    label: "OpenCode",
    description: "Run locally with OpenCode",
  },
] as const;

export type DesktopLocalAgentId = Exclude<
  (typeof DESKTOP_LOCAL_AGENT_OPTIONS)[number]["id"],
  "default"
>;

export const DESKTOP_LOCAL_AGENT_ENGINE_BY_ID: Record<
  DesktopLocalAgentId,
  string
> = {
  codex: "codex-cli",
  "claude-code": "claude-cli",
  pi: "pi-cli",
  opencode: "opencode-cli",
};

type RuntimeEvent = AgentChatRuntimeEvent;
type TranscriptBatch = {
  status: "ok" | "unavailable";
  runId?: string;
  events: CodeAgentTranscriptEvent[];
  error?: string;
};

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ value: undefined as T, done: true });
    }
  }

  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift();
    if (value !== undefined) {
      return Promise.resolve({ value, done: false });
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined as T, done: true });
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this;
  }
}

interface ActiveTurn {
  queue: AsyncEventQueue<RuntimeEvent>;
  sessionId: string;
  runId: string;
  goalId: string;
  messageId: string;
  assistantText: string;
  messageStarted: boolean;
  sawAssistantDelta: boolean;
  unsubscribe: (() => void) | null;
  removeAbortListener: (() => void) | null;
  finished: boolean;
}

interface SessionState {
  id: string;
  threadId?: string;
  runId?: string;
  goalId?: string;
  active?: ActiveTurn;
  knownEventIds: Set<string>;
}

function makeId(prefix: string): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  return `${prefix}-${randomUUID ? randomUUID() : Math.random().toString(36).slice(2)}`;
}

function isTerminalStatus(
  value: unknown,
): value is "completed" | "errored" | "paused" | "needs-approval" {
  return (
    value === "completed" ||
    value === "errored" ||
    value === "paused" ||
    value === "needs-approval"
  );
}

function runtimeMessageEvent(
  active: ActiveTurn,
  type: "message-start" | "message-done",
): RuntimeEvent {
  return type === "message-start"
    ? {
        type,
        sessionId: active.sessionId,
        turnId: active.messageId,
        message: {
          id: active.messageId,
          role: "assistant",
          content: [],
        },
      }
    : {
        type,
        sessionId: active.sessionId,
        turnId: active.messageId,
        message: {
          id: active.messageId,
          role: "assistant",
          content: [{ type: "text", text: active.assistantText }],
        },
      };
}

function pushAssistantText(active: ActiveTurn, text: string): void {
  if (!text.trim()) return;
  if (!active.messageStarted) {
    active.messageStarted = true;
    active.queue.push(runtimeMessageEvent(active, "message-start"));
  }
  active.assistantText += text;
  active.queue.push({
    type: "message-delta",
    sessionId: active.sessionId,
    turnId: active.messageId,
    messageId: active.messageId,
    delta: { type: "text", text },
  });
}

function finishTurn(
  active: ActiveTurn,
  reason: "complete" | "cancelled" | "error" | "interrupted",
): void {
  if (active.finished) return;
  active.finished = true;
  if (active.messageStarted) {
    active.queue.push(runtimeMessageEvent(active, "message-done"));
  }
  active.queue.push({
    type: "done",
    sessionId: active.sessionId,
    turnId: active.messageId,
    reason,
  });
  active.unsubscribe?.();
  active.unsubscribe = null;
  active.removeAbortListener?.();
  active.removeAbortListener = null;
  active.queue.close();
}

function handleTranscriptEvent(
  state: SessionState,
  active: ActiveTurn,
  event: CodeAgentTranscriptEvent,
): void {
  if (state.knownEventIds.has(event.id)) return;
  state.knownEventIds.add(event.id);

  const metadata = event.metadata ?? {};
  if (event.type === "system" && metadata.type === "assistant_delta") {
    active.sawAssistantDelta = true;
    pushAssistantText(active, event.text);
    return;
  }

  if (
    event.type === "system" &&
    metadata.role === "assistant" &&
    !active.sawAssistantDelta
  ) {
    pushAssistantText(active, event.text);
    return;
  }

  if (event.type !== "status") return;
  const status = metadata.status;
  if (!isTerminalStatus(status)) return;

  if (status === "errored" || status === "needs-approval") {
    active.queue.push({
      type: "error",
      sessionId: active.sessionId,
      turnId: active.messageId,
      error: event.text || "The local agent could not complete the request.",
      recoverable: status === "needs-approval",
    });
  }
  finishTurn(
    active,
    status === "completed"
      ? "complete"
      : status === "errored"
        ? "error"
        : "interrupted",
  );
}

function subscribeToTranscript(
  state: SessionState,
  active: ActiveTurn,
): () => void {
  return window.electronAPI.codeAgents.subscribeTranscript(
    { goalId: active.goalId, runId: active.runId },
    (batch: TranscriptBatch) => {
      if (batch.status !== "ok") {
        active.queue.push({
          type: "error",
          sessionId: active.sessionId,
          turnId: active.messageId,
          error: batch.error ?? "The local agent transcript is unavailable.",
        });
        finishTurn(active, "error");
        return;
      }
      for (const event of batch.events) {
        handleTranscriptEvent(state, active, event);
        if (active.finished) break;
      }
    },
  );
}

function localRuntimeUnavailable(message: string): never {
  throw new Error(message);
}

function createSessionView(
  state: SessionState,
  runtime: AgentChatRuntime,
): AgentChatRuntimeSession {
  const cancelActiveTurn = async (
    reason = "cancelled",
  ): Promise<AgentChatRuntimeCancelResult> => {
    const active = state.active;
    if (!active) return { status: "not-found" };
    const result = await window.electronAPI.codeAgents.controlRun(
      active.goalId,
      active.runId,
      "stop",
    );
    if (!result.ok) {
      return {
        status: "already-finished",
        message: result.error ?? result.message,
      };
    }
    finishTurn(active, reason === "abort" ? "cancelled" : "interrupted");
    state.active = undefined;
    return { status: "cancelled", message: result.message };
  };

  const startTurn = async (
    input: AgentChatRuntimeTurnInput,
  ): Promise<AgentChatRuntimeTurn> => {
    const prompt = input.prompt?.trim();
    if (!prompt) localRuntimeUnavailable("A local agent needs a prompt.");

    if (state.active && !state.active.finished) {
      await cancelActiveTurn("superseded");
    }

    let runId = state.runId;
    let goalId = state.goalId;
    if (runId && goalId) {
      const transcript = await window.electronAPI.codeAgents.readTranscript({
        goalId,
        runId,
      });
      for (const event of transcript.events) state.knownEventIds.add(event.id);
      const followUp = await window.electronAPI.codeAgents.appendFollowUp({
        goalId,
        runId,
        prompt,
        followUpMode: "immediate",
        model: input.model,
        effort: input.reasoningEffort,
        metadata: {
          source: "desktop-chat",
          runtimeId: runtime.id,
          threadId: state.threadId,
        },
      });
      if (!followUp.ok) {
        localRuntimeUnavailable(
          followUp.error ??
            followUp.message ??
            "Could not continue the local agent.",
        );
      }
    } else {
      const created = await window.electronAPI.codeAgents.createRun({
        prompt,
        engine:
          DESKTOP_LOCAL_AGENT_ENGINE_BY_ID[
            runtime.id.replace("desktop-local-", "") as DesktopLocalAgentId
          ],
        model: input.model,
        effort: input.reasoningEffort,
        permissionMode: "full-auto",
        metadata: {
          source: "desktop-chat",
          runtimeId: runtime.id,
          threadId: state.threadId,
        },
      });
      if (!created.ok || !created.run) {
        localRuntimeUnavailable(
          created.error ??
            created.message ??
            "Could not start the local agent.",
        );
      }
      runId = created.run.id;
      goalId = created.run.goalId;
      state.runId = runId;
      state.goalId = goalId;
    }

    if (!runId || !goalId) {
      localRuntimeUnavailable("The local agent did not return a run id.");
    }

    const queue = new AsyncEventQueue<RuntimeEvent>();
    const active: ActiveTurn = {
      queue,
      sessionId: state.id,
      runId,
      goalId,
      messageId: makeId("desktop-agent-message"),
      assistantText: "",
      messageStarted: false,
      sawAssistantDelta: false,
      unsubscribe: null,
      removeAbortListener: null,
      finished: false,
    };
    state.active = active;
    active.unsubscribe = subscribeToTranscript(state, active);
    if (input.abortSignal) {
      const onAbort = () => {
        void cancelActiveTurn("abort");
      };
      input.abortSignal.addEventListener("abort", onAbort, { once: true });
      active.removeAbortListener = () =>
        input.abortSignal?.removeEventListener("abort", onAbort);
    }
    return {
      id: active.messageId,
      sessionId: state.id,
      runId,
      events: queue,
      cancel: (cancelInput) => cancelActiveTurn(cancelInput?.reason),
    };
  };

  return {
    id: state.id,
    runtimeId: runtime.id,
    threadId: state.threadId,
    startTurn,
    sendMessage: startTurn,
    cancelTurn: (input) => cancelActiveTurn(input?.reason),
    dispose: async () => {
      if (state.active && !state.active.finished) {
        await cancelActiveTurn("dispose");
      }
      state.active?.unsubscribe?.();
      state.active = undefined;
    },
  };
}

export function createDesktopLocalAgentRuntime(
  agentId: DesktopLocalAgentId,
): AgentChatRuntime {
  const runtimeId = `desktop-local-${agentId}`;
  const sessions = new Map<string, SessionState>();
  const option = DESKTOP_LOCAL_AGENT_OPTIONS.find(
    (candidate) => candidate.id === agentId,
  );
  const runtime: AgentChatRuntime = {
    id: runtimeId,
    kind: "code-agent",
    label: option?.label ?? agentId,
    description: option?.description,
    capabilities: {
      messages: { streaming: true, history: true },
      sessions: { create: true, persistent: true },
      cancellation: { abortSignal: true, explicitCancel: true },
      models: { selectable: true, reasoningEffort: true },
      artifacts: { files: true, links: true, progress: true },
    },
    createSession(input = {}) {
      const id = input.id ?? input.threadId ?? makeId("desktop-agent-session");
      const state = sessions.get(id) ?? {
        id,
        threadId: input.threadId,
        knownEventIds: new Set<string>(),
      };
      sessions.set(id, state);
      return createSessionView(state, runtime);
    },
  };
  return runtime;
}
