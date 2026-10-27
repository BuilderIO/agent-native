import { describe, expect, it } from "vitest";

import {
  AGENT_RUN_NO_OUTPUT_ERROR_CODE,
  AGENT_RUN_NO_OUTPUT_MESSAGE,
  RUN_BUDGET_EXHAUSTED_ERROR_CODE,
  RUN_BUDGET_EXHAUSTED_MESSAGE,
  RUN_CONTINUATION_LIMIT_EXHAUSTED_MESSAGE,
  RUN_STREAM_ENDED_ERROR_CODE,
  RUN_STREAM_ENDED_MESSAGE,
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
});
