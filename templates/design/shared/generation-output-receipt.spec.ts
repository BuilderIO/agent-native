import { describe, expect, it } from "vitest";

import {
  DESIGN_OUTPUT_ACTIONS,
  classifyDesignGenerationOutput,
  designOutputWriteReceipt,
} from "./generation-output-receipt.js";

function completedTurn(
  call?: Record<string, unknown>,
): Array<{ runId: string; seq: number; event: unknown }> {
  return [
    {
      runId: "run-1",
      seq: 0,
      event: { type: "model_stream", status: "start" },
    },
    ...(call ? [{ runId: "run-1", seq: 1, event: call }] : []),
    {
      runId: "run-1",
      seq: call ? 2 : 1,
      event: { type: "done" },
    },
  ];
}

const base = {
  designId: "design-1",
  runId: "run-1",
  runStatus: "completed",
  runIds: ["run-1"],
};

describe("Design generation output receipts", () => {
  it("confirms output from a receipt scoped to the requested design", () => {
    expect(
      classifyDesignGenerationOutput({
        ...base,
        events: completedTurn({
          type: "tool_done",
          tool: "generate-design",
          input: { designId: "design-1" },
          completedSideEffect: true,
          receipt: designOutputWriteReceipt("design-1", 1),
        }),
      }),
    ).toBe("has_output");
  });

  it("recognizes output receipts for every registered writer", () => {
    for (const tool of DESIGN_OUTPUT_ACTIONS) {
      expect(
        classifyDesignGenerationOutput({
          ...base,
          events: completedTurn({
            type: "tool_done",
            tool,
            input: { designId: "design-1" },
            completedSideEffect: true,
            receipt: designOutputWriteReceipt("design-1", 1),
          }),
        }),
        tool,
      ).toBe("has_output");
    }
  });

  it("reports a completed turn with no saved design output", () => {
    expect(
      classifyDesignGenerationOutput({ ...base, events: completedTurn() }),
    ).toBe("no_output");
    expect(
      classifyDesignGenerationOutput({
        ...base,
        events: completedTurn({
          type: "tool_done",
          tool: "generate-design",
          input: { designId: "design-1" },
          completedSideEffect: false,
        }),
      }),
    ).toBe("no_output");
    expect(
      classifyDesignGenerationOutput({
        ...base,
        events: completedTurn({
          type: "tool_done",
          tool: "generate-design",
          input: { designId: "design-1" },
          completedSideEffect: true,
          receipt: designOutputWriteReceipt("design-1", 0),
        }),
      }),
    ).toBe("no_output");
  });

  it("keeps missing, malformed, and unreadable output evidence unknown", () => {
    expect(
      classifyDesignGenerationOutput({
        ...base,
        events: completedTurn({
          type: "tool_done",
          tool: "generate-design",
          input: { designId: "design-1" },
          completedSideEffect: true,
        }),
      }),
    ).toBe("unknown");
    expect(
      classifyDesignGenerationOutput({
        ...base,
        events: completedTurn({
          type: "tool_done",
          tool: "update-file",
          input: "{malformed",
          completedSideEffect: false,
        }),
      }),
    ).toBe("unknown");
    expect(
      classifyDesignGenerationOutput({
        ...base,
        events: completedTurn({
          type: "tool_done",
          tool: "generate-design",
          input: { designId: "design-1" },
          completedSideEffect: true,
          receipt: {
            ...designOutputWriteReceipt("design-1", 0),
            changed: true,
          },
        }),
      }),
    ).toBe("unknown");
    expect(
      classifyDesignGenerationOutput({
        ...base,
        events: completedTurn({
          type: "tool_done",
          tool: "update-file",
          input: { designId: "design-1" },
          completedSideEffect: true,
        }),
      }),
    ).toBe("unknown");
    expect(
      classifyDesignGenerationOutput({
        ...base,
        events: [
          {
            runId: "run-1",
            seq: 0,
            event: { type: "model_stream", status: "start" },
          },
          {
            runId: "run-1",
            seq: 1,
            event: {
              type: "tool_start",
              tool: "edit-design",
              input: { designId: "design-1" },
              id: "edit-1",
            },
          },
          { runId: "run-1", seq: 2, event: { type: "done" } },
        ],
      }),
    ).toBe("unknown");
    expect(
      classifyDesignGenerationOutput({
        ...base,
        runStatus: "errored",
        events: completedTurn(),
      }),
    ).toBe("unknown");
  });

  it("does not count output saved for another design", () => {
    expect(
      classifyDesignGenerationOutput({
        ...base,
        events: completedTurn({
          type: "tool_done",
          tool: "generate-design",
          input: { designId: "design-2" },
          completedSideEffect: true,
          receipt: designOutputWriteReceipt("design-2", 1),
        }),
      }),
    ).toBe("no_output");
  });

  it("includes receipts from predecessor runs in the same turn", () => {
    expect(
      classifyDesignGenerationOutput({
        ...base,
        events: [
          {
            runId: "run-0",
            seq: 0,
            event: { type: "model_stream", status: "start" },
          },
          {
            runId: "run-0",
            seq: 1,
            event: {
              type: "tool_done",
              tool: "generate-design",
              input: { designId: "design-1" },
              completedSideEffect: true,
              receipt: designOutputWriteReceipt("design-1", 1),
            },
          },
          {
            runId: "run-0",
            seq: 1_000_000_000,
            event: { type: "auto_continue", reason: "run_timeout" },
          },
          {
            runId: "run-1",
            seq: 0,
            event: { type: "model_stream", status: "start" },
          },
          { runId: "run-1", seq: 1, event: { type: "done" } },
        ],
        runIds: ["run-0", "run-1"],
      }),
    ).toBe("has_output");
  });

  it("confirms output even when an unrelated design mutation preceded it", () => {
    expect(
      classifyDesignGenerationOutput({
        ...base,
        events: [
          {
            runId: "run-1",
            seq: 0,
            event: {
              type: "tool_done",
              tool: "update-design",
              input: { designId: "design-1" },
              completedSideEffect: true,
            },
          },
          {
            runId: "run-1",
            seq: 1,
            event: {
              type: "tool_done",
              tool: "generate-design",
              input: { designId: "design-1" },
              completedSideEffect: true,
              receipt: designOutputWriteReceipt("design-1", 1),
            },
          },
          { runId: "run-1", seq: 2, event: { type: "done" } },
        ],
      }),
    ).toBe("has_output");
  });

  it("keeps a missing predecessor run in the turn unknown", () => {
    expect(
      classifyDesignGenerationOutput({
        ...base,
        runIds: ["run-missing", "run-1"],
        events: completedTurn(),
      }),
    ).toBe("unknown");
  });

  it("rejects journal events from runs outside the selected turn", () => {
    expect(
      classifyDesignGenerationOutput({
        ...base,
        events: [
          ...completedTurn(),
          {
            runId: "run-unexpected",
            seq: 0,
            event: { type: "done" },
          },
        ],
      }),
    ).toBe("unknown");
  });

  it("does not match output tool starts without a call ID", () => {
    expect(
      classifyDesignGenerationOutput({
        ...base,
        events: [
          {
            runId: "run-1",
            seq: 0,
            event: { type: "model_stream", status: "start" },
          },
          {
            runId: "run-1",
            seq: 1,
            event: {
              type: "tool_start",
              tool: "generate-design",
              input: { designId: "design-1" },
            },
          },
          {
            runId: "run-1",
            seq: 2,
            event: {
              type: "tool_done",
              tool: "generate-design",
              id: "different-call",
              input: { designId: "design-1" },
              completedSideEffect: false,
            },
          },
          { runId: "run-1", seq: 3, event: { type: "done" } },
        ],
      }),
    ).toBe("unknown");
  });

  it("keeps a missing tool completion unknown even for an unlisted action", () => {
    expect(
      classifyDesignGenerationOutput({
        ...base,
        events: [
          {
            runId: "run-1",
            seq: 0,
            event: { type: "model_stream", status: "start" },
          },
          {
            runId: "run-1",
            seq: 1,
            event: {
              type: "tool_start",
              tool: "future-design-writer",
              input: { designId: "design-1" },
              id: "writer-1",
            },
          },
          { runId: "run-1", seq: 2, event: { type: "done" } },
        ],
      }),
    ).toBe("unknown");
  });
});
