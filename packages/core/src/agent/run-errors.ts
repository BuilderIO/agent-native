import { EngineError } from "./engine/types.js";
import type {
  AgentLoopContinuationReason,
  AgentLoopUsage,
} from "./production-agent.js";

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

export const TOOL_CALL_JOURNAL_UNREADABLE_ERROR_CODE =
  "tool_call_journal_unreadable";
export const TOOL_CALL_JOURNAL_UNREADABLE_MESSAGE =
  "I stopped because I could not read this turn's run ledger, so I could not tell which steps had already finished. " +
  "Retrying would risk repeating a step that already completed. Please send the request again.";

export const PRIVATE_HISTORY_UNRECOVERABLE_ERROR_CODE =
  "private_history_unrecoverable";
export const PRIVATE_HISTORY_UNRECOVERABLE_MESSAGE =
  "I stopped because this turn's private steps could not be safely resumed, so I could not confirm whether an earlier step already finished. Check what was saved before sending the request again.";

export const PRIVATE_HISTORY_PROVENANCE_UNAVAILABLE_ERROR_CODE =
  "private_history_provenance_unavailable";
export const PRIVATE_HISTORY_PROVENANCE_UNAVAILABLE_MESSAGE =
  "Private turn provenance is unavailable. Please send the request again.";

export const WRITE_TOOL_OUTCOME_UNKNOWN_ERROR_CODE =
  "write_tool_outcome_unknown";
export const PRIVATE_WRITE_TOOL_OUTCOME_UNKNOWN_MESSAGE =
  "I stopped before running a write action again because an earlier attempt may have already saved changes and I could not confirm the result. Check what was saved before retrying.";

export const PRIVATE_SAFE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  [RUN_STREAM_ENDED_ERROR_CODE]: RUN_STREAM_ENDED_MESSAGE,
  [AGENT_RUN_NO_OUTPUT_ERROR_CODE]: AGENT_RUN_NO_OUTPUT_MESSAGE,
  run_timeout: RUN_TIMEOUT_MESSAGE,
  loop_limit: RUN_LOOP_LIMIT_MESSAGE,
  no_progress: RUN_NO_PROGRESS_MESSAGE,
  gateway_timeout: RUN_GATEWAY_TIMEOUT_MESSAGE,
  network_interrupted: RUN_NETWORK_INTERRUPTED_MESSAGE,
  rate_limited: RUN_RATE_LIMITED_MESSAGE,
  [PRIVATE_HISTORY_UNRECOVERABLE_ERROR_CODE]:
    PRIVATE_HISTORY_UNRECOVERABLE_MESSAGE,
  [TOOL_CALL_JOURNAL_UNREADABLE_ERROR_CODE]:
    TOOL_CALL_JOURNAL_UNREADABLE_MESSAGE,
  [PRIVATE_HISTORY_PROVENANCE_UNAVAILABLE_ERROR_CODE]:
    PRIVATE_HISTORY_PROVENANCE_UNAVAILABLE_MESSAGE,
  [WRITE_TOOL_OUTCOME_UNKNOWN_ERROR_CODE]:
    PRIVATE_WRITE_TOOL_OUTCOME_UNKNOWN_MESSAGE,
};

const PRIVATE_SAFE_ERROR_MESSAGE_MAP: ReadonlyMap<string, string> = new Map(
  Object.entries(PRIVATE_SAFE_ERROR_MESSAGES),
);

export function resolvePrivateSafeError(
  errorCode: unknown,
): { errorCode: string; message: string } | null {
  if (typeof errorCode !== "string") return null;
  const message = PRIVATE_SAFE_ERROR_MESSAGE_MAP.get(errorCode);
  return message === undefined ? null : { errorCode, message };
}

export function incompleteAgentRunFailure(input: {
  dispatchedModelCalls: number;
  hasVisibleText: boolean;
  hasSuccessfulToolOutput: boolean;
  reason?:
    | "continuation_limit"
    | Exclude<AgentLoopContinuationReason, "max_tokens">;
}): { code: string; message: string } {
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

  constructor(
    failure: { code: string; message: string },
    usage: AgentLoopUsage,
  ) {
    super(failure.message, {
      errorCode: failure.code,
      providerRetryable: false,
    });
    this.usage = { ...usage };
  }
}

/**
 * The closing message for a run that stops with work unfinished. Without it
 * the thread ends on a tool card and a generic banner, and the user cannot
 * tell which steps ran. Names tools only, never their input or output.
 */
export function stoppedRunSummary(input: {
  completedTools: readonly string[];
  failedTools: readonly string[];
  reason: string;
}): string {
  const names = (tools: readonly string[]) => [...new Set(tools)].join(", ");
  const lines = [`I stopped before finishing. ${input.reason}`];
  if (input.completedTools.length > 0) {
    lines.push(`Completed: ${names(input.completedTools)}.`);
  }
  if (input.failedTools.length > 0) {
    lines.push(`Failed: ${names(input.failedTools)}.`);
  }
  lines.push(
    'Not done: every step of your request after these, including any remaining actions and the final summary. Reply "continue" and I will pick up from the completed steps.',
  );
  return lines.join("\n\n");
}
