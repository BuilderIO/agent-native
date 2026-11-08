import { describe, expect, it } from "vitest";

import {
  AGENT_RUN_NO_OUTPUT_ERROR_CODE,
  AGENT_RUN_NO_OUTPUT_MESSAGE,
  RUN_BUDGET_EXHAUSTED_ERROR_CODE,
  RUN_BUDGET_EXHAUSTED_MESSAGE,
  RUN_CONTINUATION_LIMIT_EXHAUSTED_MESSAGE,
  RUN_GATEWAY_TIMEOUT_MESSAGE,
  RUN_LOOP_LIMIT_MESSAGE,
  RUN_NETWORK_INTERRUPTED_MESSAGE,
  RUN_NO_PROGRESS_MESSAGE,
  RUN_RATE_LIMITED_MESSAGE,
  RUN_STREAM_ENDED_ERROR_CODE,
  RUN_STREAM_ENDED_MESSAGE,
  RUN_TIMEOUT_MESSAGE,
  incompleteAgentRunFailure,
} from "./run-errors.js";

describe("incompleteAgentRunFailure", () => {
  it("distinguishes a run that never produced output from an exhausted run", () => {
    expect(
      incompleteAgentRunFailure({
        dispatchedModelCalls: 0,
        hasVisibleText: false,
        hasSuccessfulToolOutput: false,
      }),
    ).toEqual({
      code: AGENT_RUN_NO_OUTPUT_ERROR_CODE,
      message: AGENT_RUN_NO_OUTPUT_MESSAGE,
    });
  });

  it.each([
    {
      dispatchedModelCalls: 1,
      hasVisibleText: false,
      hasSuccessfulToolOutput: false,
    },
    {
      dispatchedModelCalls: 0,
      hasVisibleText: false,
      hasSuccessfulToolOutput: true,
    },
    {
      dispatchedModelCalls: 0,
      hasVisibleText: true,
      hasSuccessfulToolOutput: false,
    },
  ])(
    "reports a typed incomplete-run failure for partial progress: %o",
    (input) => {
      expect(incompleteAgentRunFailure(input)).toEqual({
        code: RUN_BUDGET_EXHAUSTED_ERROR_CODE,
        message: RUN_BUDGET_EXHAUSTED_MESSAGE,
      });
    },
  );

  it("reports continuation-count exhaustion without claiming time ran out", () => {
    expect(
      incompleteAgentRunFailure({
        dispatchedModelCalls: 1,
        hasVisibleText: true,
        hasSuccessfulToolOutput: false,
        reason: "continuation_limit",
      }),
    ).toEqual({
      code: RUN_BUDGET_EXHAUSTED_ERROR_CODE,
      message: RUN_CONTINUATION_LIMIT_EXHAUSTED_MESSAGE,
    });
  });

  it("reports an ended stream without claiming time ran out", () => {
    expect(
      incompleteAgentRunFailure({
        dispatchedModelCalls: 1,
        hasVisibleText: false,
        hasSuccessfulToolOutput: false,
        reason: "stream_ended",
      }),
    ).toEqual({
      code: RUN_STREAM_ENDED_ERROR_CODE,
      message: RUN_STREAM_ENDED_MESSAGE,
    });
  });

  it.each([
    {
      reason: "run_timeout" as const,
      code: "run_timeout",
      message: RUN_TIMEOUT_MESSAGE,
    },
    {
      reason: "loop_limit" as const,
      code: "loop_limit",
      message: RUN_LOOP_LIMIT_MESSAGE,
    },
    {
      reason: "no_progress" as const,
      code: "no_progress",
      message: RUN_NO_PROGRESS_MESSAGE,
    },
    {
      reason: "gateway_timeout" as const,
      code: "gateway_timeout",
      message: RUN_GATEWAY_TIMEOUT_MESSAGE,
    },
    {
      reason: "network_interrupted" as const,
      code: "network_interrupted",
      message: RUN_NETWORK_INTERRUPTED_MESSAGE,
    },
    {
      reason: "rate_limited" as const,
      code: "rate_limited",
      message: RUN_RATE_LIMITED_MESSAGE,
    },
  ])(
    "preserves $reason as a typed run failure",
    ({ reason, code, message }) => {
      expect(
        incompleteAgentRunFailure({
          dispatchedModelCalls: 1,
          hasVisibleText: false,
          hasSuccessfulToolOutput: false,
          reason,
        }),
      ).toEqual({ code, message });
    },
  );
});
