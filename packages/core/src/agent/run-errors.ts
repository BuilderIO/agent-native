import { EngineError } from "./engine/types.js";
import type { AgentLoopUsage } from "./production-agent.js";

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

export const AGENT_RUN_NO_OUTPUT_ERROR_CODE = "agent_run_no_output";
export const AGENT_RUN_NO_OUTPUT_MESSAGE =
  "The agent run ended without producing a response.";

export function incompleteAgentRunFailure(input: {
  dispatchedModelCalls: number;
  hasVisibleText: boolean;
  hasSuccessfulToolOutput: boolean;
  reason?: "continuation_limit" | "stream_ended";
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
