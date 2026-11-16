import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import { EngineError } from "./engine/types.js";
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
  canRetryRunWithoutReplayingWork,
  incompleteAgentRunFailure,
} from "./run-errors.js";

describe("retry safety for an incomplete run", () => {
  it.each([
    { events: [{ type: "text", text: "Visible" }, { type: "clear" }] },
    { events: [{ type: "thinking", text: "Partial" }] },
    { events: [{ type: "text", text: " " }] },
    { events: [{ type: "agent_call", agent: "worker", status: "start" }] },
    {
      events: [
        {
          type: "agent_task",
          taskId: "task",
          threadId: "thread",
          description: "work",
          status: "running",
        },
      ],
    },
    { events: [{ type: "tool_start", tool: "write", input: {} }] },
    {
      events: [
        {
          type: "tool_done",
          tool: "write",
          result: "unknown",
          isError: true,
          outcomeUnknown: true,
        },
      ],
    },
  ] as const)(
    "refuses to replay local output or tool work",
    async ({ events }) => {
      expect(await canRetryRunWithoutReplayingWork({ events })).toBe(false);
    },
  );

  it("fails closed when persisted turn work exists or cannot be read", async () => {
    const journal = await import("./engine/tool-call-journal-seed.js");
    const read = vi.spyOn(journal, "loadPriorTurnToolCallJournal");
    try {
      read.mockResolvedValueOnce({
        status: "read",
        events: [{ type: "tool_start", tool: "write", input: {} }],
        toolCallJournal: null,
        priorToolCalls: [],
        priorToolResults: [],
        priorToolCallSequence: [],
      });
      read.mockResolvedValueOnce({
        status: "unreadable",
        error: "unavailable",
      });
      await expect(
        canRetryRunWithoutReplayingWork({
          events: [],
          threadId: "thread-test",
          turnId: "turn-test",
        }),
      ).resolves.toBe(false);
      await expect(
        canRetryRunWithoutReplayingWork({
          events: [],
          threadId: "thread-test",
          turnId: "turn-test",
        }),
      ).resolves.toBe(false);
    } finally {
      read.mockRestore();
    }
  });
});

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

  it("does not replace a no-output failure with a non-retryable upstream error", () => {
    expect(
      incompleteAgentRunFailure({
        dispatchedModelCalls: 0,
        hasVisibleText: false,
        hasSuccessfulToolOutput: false,
        reason: "continuation_limit",
        safeToRetry: true,
        lastResumableError: new EngineError("rejected", {
          errorCode: "http_503",
          statusCode: 503,
          providerRetryable: false,
        }),
      }),
    ).toEqual({
      code: AGENT_RUN_NO_OUTPUT_ERROR_CODE,
      message: AGENT_RUN_NO_OUTPUT_MESSAGE,
    });
  });

  it("keeps continuation exhaustion terminal after partial work", () => {
    expect(
      incompleteAgentRunFailure({
        dispatchedModelCalls: 1,
        hasVisibleText: true,
        hasSuccessfulToolOutput: true,
        reason: "continuation_limit",
        safeToRetry: true,
        lastResumableError: new EngineError("unavailable", {
          errorCode: "http_503",
          statusCode: 503,
          providerRetryable: true,
        }),
      }),
    ).toEqual({
      code: RUN_BUDGET_EXHAUSTED_ERROR_CODE,
      message: RUN_CONTINUATION_LIMIT_EXHAUSTED_MESSAGE,
    });
  });

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
