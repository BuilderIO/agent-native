export const RUN_BUDGET_EXHAUSTED_ERROR_CODE = "run_budget_exhausted";
export const RUN_BUDGET_EXHAUSTED_MESSAGE =
  "I ran out of time before finishing this step. " +
  "I stopped rather than keep retrying silently. " +
  "Check any completed tool cards above before retrying, ideally as one smaller follow-up.";

export const AGENT_RUN_NO_OUTPUT_ERROR_CODE = "agent_run_no_output";
export const AGENT_RUN_NO_OUTPUT_MESSAGE =
  "The agent run ended without producing a response.";

export function incompleteAgentRunFailure(input: {
  dispatchedModelCalls: number;
  hasVisibleText: boolean;
  hasSuccessfulToolOutput: boolean;
}): { code: string; message: string } {
  const hasNoOutput =
    input.dispatchedModelCalls === 0 &&
    !input.hasVisibleText &&
    !input.hasSuccessfulToolOutput;
  return hasNoOutput
    ? {
        code: AGENT_RUN_NO_OUTPUT_ERROR_CODE,
        message: AGENT_RUN_NO_OUTPUT_MESSAGE,
      }
    : {
        code: RUN_BUDGET_EXHAUSTED_ERROR_CODE,
        message: RUN_BUDGET_EXHAUSTED_MESSAGE,
      };
}
