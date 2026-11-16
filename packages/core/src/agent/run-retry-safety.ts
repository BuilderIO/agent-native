import { loadPriorTurnToolCallJournal } from "./engine/tool-call-journal-seed.js";
import type { AgentChatEvent } from "./types.js";

export async function canRetryRunWithoutReplayingWork(input: {
  events: readonly AgentChatEvent[];
  threadId?: string;
  turnId?: string;
  recoverCompletedExecutionSteps?: boolean;
}): Promise<"safe" | "prior_work" | "unreadable"> {
  const hasOutputOrToolActivity = (events: readonly AgentChatEvent[]) =>
    events.some((event) =>
      event.type === "text" || event.type === "thinking"
        ? event.text.length > 0 || event.omitFromPersistedHistory === true
        : event.type === "tool_start" ||
          event.type === "tool_done" ||
          event.type === "tool_input_start" ||
          event.type === "tool_input_delta" ||
          event.type === "rich_event" ||
          event.type === "suggestions" ||
          event.type === "approval_required" ||
          event.type === "connection_required" ||
          event.type === "agent_call" ||
          event.type === "agent_call_progress" ||
          event.type === "agent_call_text" ||
          event.type === "agent_call_activity" ||
          event.type === "agent_task" ||
          event.type === "agent_task_update" ||
          event.type === "agent_task_complete",
    );
  const journal = await loadPriorTurnToolCallJournal(
    input.threadId,
    input.turnId,
    {
      ...(input.recoverCompletedExecutionSteps !== undefined
        ? {
            recoverCompletedExecutionSteps:
              input.recoverCompletedExecutionSteps,
          }
        : {}),
    },
  );
  if (journal.status === "unreadable") return "unreadable";
  return hasOutputOrToolActivity(input.events) ||
    hasOutputOrToolActivity(journal.events)
    ? "prior_work"
    : "safe";
}
