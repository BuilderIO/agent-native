import { loadPriorTurnToolCallJournal } from "./engine/tool-call-journal-seed.js";
import { EngineError } from "./engine/types.js";
import type {
  AgentLoopContinuationReason,
  AgentLoopUsage,
} from "./production-agent.js";
import type { AgentChatEvent } from "./types.js";

export const RUN_BUDGET_EXHAUSTED_ERROR_CODE = "run_budget_exhausted";
export const RUN_BUDGET_EXHAUSTED_MESSAGE =
  "I ran out of time before finishing this step. " +
  "I stopped rather than keep retrying silently. " +
  "Check any completed tool cards above before retrying, ideally as one smaller follow-up.";
export const RUN_CONTINUATION_LIMIT_EXHAUSTED_MESSAGE =
  "This run reached its continuation limit before it could finish. " +
  "I stopped rather than keep retrying silently. " +
  "Check any completed tool cards above before retrying, ideally as one smaller follow-up.";
export const RUN_STREAM_ENDED_ERROR_CODE = "agent_run_stream_ended";
export const RUN_STREAM_ENDED_MESSAGE =
  "The model stream ended before the agent finished the response.";
export const RUN_TIMEOUT_MESSAGE =
  "The run reached its time limit before the agent finished.";
export const RUN_LOOP_LIMIT_MESSAGE =
  "The agent reached its internal step limit before finishing.";
export const RUN_NO_PROGRESS_MESSAGE =
  "The agent stopped making progress before finishing.";
export const RUN_GATEWAY_TIMEOUT_MESSAGE =
  "The AI gateway timed out before the agent finished.";
export const RUN_NETWORK_INTERRUPTED_MESSAGE =
  "The connection to the AI provider was interrupted before the agent finished.";
export const RUN_RATE_LIMITED_MESSAGE =
  "The AI provider is rate limiting requests right now. Wait a minute and try again.";

export const AGENT_RUN_NO_OUTPUT_ERROR_CODE = "agent_run_no_output";
export const AGENT_RUN_NO_OUTPUT_MESSAGE =
  "The agent run ended without producing a response.";

interface IncompleteAgentRunFailure {
  code: string;
  message: string;
  statusCode?: number;
  providerRetryable?: boolean;
}

export async function canRetryRunWithoutReplayingWork(input: {
  events: readonly AgentChatEvent[];
  threadId?: string;
  turnId?: string;
  recoverCompletedExecutionSteps?: boolean;
}): Promise<boolean> {
  const hasOutputOrToolActivity = (events: readonly AgentChatEvent[]) =>
    events.some((event) =>
      event.type === "text" || event.type === "thinking"
        ? event.text.length > 0
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
  if (hasOutputOrToolActivity(input.events)) return false;
  const journal = await loadPriorTurnToolCallJournal(
    input.threadId,
    input.turnId,
    {
      recoverCompletedExecutionSteps: input.recoverCompletedExecutionSteps,
    },
  );
  return journal.status === "read" && !hasOutputOrToolActivity(journal.events);
}

export function incompleteAgentRunFailure(input: {
  dispatchedModelCalls: number;
  hasVisibleText: boolean;
  hasSuccessfulToolOutput: boolean;
  lastResumableError?: unknown;
  safeToRetry?: boolean;
  reason?:
    | "continuation_limit"
    | Exclude<AgentLoopContinuationReason, "max_tokens">;
}): IncompleteAgentRunFailure {
  const error = input.lastResumableError;
  if (
    input.safeToRetry === true &&
    !input.hasVisibleText &&
    !input.hasSuccessfulToolOutput &&
    error instanceof EngineError &&
    error.errorCode &&
    error.statusCode !== undefined &&
    error.statusCode >= 500 &&
    error.statusCode <= 599 &&
    error.providerRetryable !== false
  ) {
    return {
      code: error.errorCode,
      message: error.message,
      statusCode: error.statusCode,
      providerRetryable: true,
    };
  }
  const hasNoOutput =
    input.dispatchedModelCalls === 0 &&
    !input.hasVisibleText &&
    !input.hasSuccessfulToolOutput;
  if (hasNoOutput) {
    return {
      code: AGENT_RUN_NO_OUTPUT_ERROR_CODE,
      message: AGENT_RUN_NO_OUTPUT_MESSAGE,
    };
  }
  if (input.reason === "stream_ended") {
    return {
      code: RUN_STREAM_ENDED_ERROR_CODE,
      message: RUN_STREAM_ENDED_MESSAGE,
    };
  }
  if (input.reason === "run_timeout") {
    return { code: "run_timeout", message: RUN_TIMEOUT_MESSAGE };
  }
  if (input.reason === "loop_limit") {
    return { code: "loop_limit", message: RUN_LOOP_LIMIT_MESSAGE };
  }
  if (input.reason === "no_progress") {
    return { code: "no_progress", message: RUN_NO_PROGRESS_MESSAGE };
  }
  if (input.reason === "gateway_timeout") {
    return { code: "gateway_timeout", message: RUN_GATEWAY_TIMEOUT_MESSAGE };
  }
  if (input.reason === "network_interrupted") {
    return {
      code: "network_interrupted",
      message: RUN_NETWORK_INTERRUPTED_MESSAGE,
    };
  }
  if (input.reason === "rate_limited") {
    return { code: "rate_limited", message: RUN_RATE_LIMITED_MESSAGE };
  }
  return {
    code: RUN_BUDGET_EXHAUSTED_ERROR_CODE,
    message:
      input.reason === "continuation_limit"
        ? RUN_CONTINUATION_LIMIT_EXHAUSTED_MESSAGE
        : RUN_BUDGET_EXHAUSTED_MESSAGE,
  };
}

export class IncompleteAgentRunError extends EngineError {
  readonly usage: AgentLoopUsage;

  constructor(failure: IncompleteAgentRunFailure, usage: AgentLoopUsage) {
    super(failure.message, {
      errorCode: failure.code,
      ...(failure.statusCode !== undefined
        ? { statusCode: failure.statusCode }
        : {}),
      providerRetryable: failure.providerRetryable ?? false,
    });
    this.usage = { ...usage };
  }
}
