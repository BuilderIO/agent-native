import {
  resolveAgentChatRunningThreadId,
  type AgentChatRunningEventDetail,
} from "@agent-native/core/client/agent-chat";

export type TabRunStatus = "idle" | "running" | "reply-ready";

export type AgentRunSignal =
  | { type: "started"; threadId: string }
  | { type: "ended"; threadId: string; outcome: "finished" | "stopped" };

/** Run ends that leave no new reply for the user to read. */
const STOPPED_REASONS = new Set([
  "run.cancelled",
  "submission_queued",
  "start_failed",
]);

export function parseAgentRunSignal(detail: unknown): AgentRunSignal | null {
  if (!detail || typeof detail !== "object") return null;
  const value = detail as Partial<AgentChatRunningEventDetail>;
  if (typeof value.isRunning !== "boolean") return null;
  const threadId = resolveAgentChatRunningThreadId(value);
  if (!threadId) return null;
  if (value.isRunning) return { type: "started", threadId };
  return {
    type: "ended",
    threadId,
    outcome:
      typeof value.reason === "string" && STOPPED_REASONS.has(value.reason)
        ? "stopped"
        : "finished",
  };
}

export interface TabRunState {
  /** Threads this tab saw start and has not yet seen end. */
  observed: ReadonlySet<string>;
  /** A run finished while the tab was hidden and the tab has not been shown since. */
  replyReady: boolean;
}

export const INITIAL_TAB_RUN_STATE: TabRunState = {
  observed: new Set(),
  replyReady: false,
};

export interface TabRunTransition {
  state: TabRunState;
  /** The thread whose run just finished with a reply, once per run. */
  finishedThreadId: string | null;
}

export function applyAgentRunSignal(
  state: TabRunState,
  signal: AgentRunSignal,
  context: { hidden: boolean },
): TabRunTransition {
  if (signal.type === "started") {
    if (state.observed.has(signal.threadId)) {
      return { state, finishedThreadId: null };
    }
    const observed = new Set(state.observed).add(signal.threadId);
    return { state: { ...state, observed }, finishedThreadId: null };
  }
  // A run end this tab never saw start (a duplicate end, or an idle report on
  // mount) is not a reply that just arrived.
  if (!state.observed.has(signal.threadId)) {
    return { state, finishedThreadId: null };
  }
  const observed = new Set(state.observed);
  observed.delete(signal.threadId);
  const finished = signal.outcome === "finished";
  return {
    state: {
      observed,
      replyReady: state.replyReady || (finished && context.hidden),
    },
    finishedThreadId: finished ? signal.threadId : null,
  };
}

export function markTabVisible(state: TabRunState): TabRunState {
  return state.replyReady ? { ...state, replyReady: false } : state;
}

export function tabRunStatus(
  state: Pick<TabRunState, "replyReady">,
  runningCount: number,
): TabRunStatus {
  if (state.replyReady) return "reply-ready";
  return runningCount > 0 ? "running" : "idle";
}
