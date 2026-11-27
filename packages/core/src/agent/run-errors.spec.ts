import { describe, expect, it } from "vitest";

import {
  AGENT_RUN_NO_OUTPUT_ERROR_CODE,
  AGENT_RUN_NO_OUTPUT_MESSAGE,
  PRIVATE_HISTORY_PROVENANCE_UNAVAILABLE_ERROR_CODE,
  PRIVATE_HISTORY_PROVENANCE_UNAVAILABLE_MESSAGE,
  PRIVATE_HISTORY_UNRECOVERABLE_ERROR_CODE,
  PRIVATE_HISTORY_UNRECOVERABLE_MESSAGE,
  PRIVATE_SAFE_ERROR_MESSAGES,
  PRIVATE_WRITE_TOOL_OUTCOME_UNKNOWN_MESSAGE,
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
  stoppedRunSummary,
  TOOL_CALL_JOURNAL_UNREADABLE_ERROR_CODE,
  TOOL_CALL_JOURNAL_UNREADABLE_MESSAGE,
  WRITE_TOOL_OUTCOME_UNKNOWN_ERROR_CODE,
  incompleteAgentRunFailure,
  resolvePrivateSafeError,
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

describe("resolvePrivateSafeError", () => {
  it.each([
    {
      expectedCode: "private_history_unrecoverable",
      codeConst: PRIVATE_HISTORY_UNRECOVERABLE_ERROR_CODE,
      messageConst: PRIVATE_HISTORY_UNRECOVERABLE_MESSAGE,
      expectedPhrase: "private steps could not be safely resumed",
    },
    {
      expectedCode: "tool_call_journal_unreadable",
      codeConst: TOOL_CALL_JOURNAL_UNREADABLE_ERROR_CODE,
      messageConst: TOOL_CALL_JOURNAL_UNREADABLE_MESSAGE,
      expectedPhrase: "could not read this turn's run ledger",
    },
    {
      expectedCode: "private_history_provenance_unavailable",
      codeConst: PRIVATE_HISTORY_PROVENANCE_UNAVAILABLE_ERROR_CODE,
      messageConst: PRIVATE_HISTORY_PROVENANCE_UNAVAILABLE_MESSAGE,
      expectedPhrase: "Private turn provenance is unavailable",
    },
    {
      expectedCode: "write_tool_outcome_unknown",
      codeConst: WRITE_TOOL_OUTCOME_UNKNOWN_ERROR_CODE,
      messageConst: PRIVATE_WRITE_TOOL_OUTCOME_UNKNOWN_MESSAGE,
      expectedPhrase: "earlier attempt may have already saved changes",
    },
  ])(
    "resolves allowlisted private safe error $expectedCode",
    ({ expectedCode, codeConst, messageConst, expectedPhrase }) => {
      expect(codeConst).toBe(expectedCode);
      expect(messageConst).toContain(expectedPhrase);
      expect(PRIVATE_SAFE_ERROR_MESSAGES[codeConst]).toBe(messageConst);
      expect(resolvePrivateSafeError(codeConst)).toEqual({
        errorCode: expectedCode,
        message: messageConst,
      });
    },
  );

  it("returns null for non-string or unallowlisted error codes", () => {
    expect(resolvePrivateSafeError(undefined)).toBeNull();
    expect(resolvePrivateSafeError(null)).toBeNull();
    expect(resolvePrivateSafeError(42)).toBeNull();
    expect(resolvePrivateSafeError("")).toBeNull();
    expect(resolvePrivateSafeError("internal_secret_error")).toBeNull();
  });
});

describe("stoppedRunSummary", () => {
  const notDone =
    'Not done: every step of your request after these, including any remaining actions and the final summary. Reply "continue" and I will pick up from the completed steps.';

  it("names completed and failed tools once each, then what was not done", () => {
    expect(
      stoppedRunSummary({
        completedTools: ["list-sent", "read-thread", "list-sent"],
        failedTools: ["save-draft", "save-draft"],
        reason: "The connection dropped.",
      }),
    ).toBe(
      [
        "I stopped before finishing. The connection dropped.",
        "Completed: list-sent, read-thread.",
        "Failed: save-draft.",
        notDone,
      ].join("\n\n"),
    );
  });

  it("omits the completed and failed lines when there are none", () => {
    expect(
      stoppedRunSummary({
        completedTools: [],
        failedTools: [],
        reason: "Why.",
      }),
    ).toBe(["I stopped before finishing. Why.", notDone].join("\n\n"));
  });

  it("omits only the empty list", () => {
    expect(
      stoppedRunSummary({
        completedTools: ["a"],
        failedTools: [],
        reason: "Why.",
      }),
    ).not.toContain("Failed:");
    expect(
      stoppedRunSummary({
        completedTools: [],
        failedTools: ["b"],
        reason: "Why.",
      }),
    ).not.toContain("Completed:");
  });
});
