import { describe, expect, it } from "vitest";

import {
  applyFrame,
  kindForTool,
  labelForTool,
  parseAgentFrame,
  settleSteps,
  summarizeToolResult,
  type AgentStep,
} from "./agent-steps";

function fold(frames: unknown[]): AgentStep[] {
  let steps: AgentStep[] = [];
  for (const raw of frames) {
    const frame = parseAgentFrame(raw);
    if (frame) steps = applyFrame(steps, frame);
  }
  return steps;
}

describe("parseAgentFrame", () => {
  it("keeps the frames the sheet renders", () => {
    expect(
      parseAgentFrame({ type: "tool_start", tool: "get-meeting" }),
    ).toEqual({ type: "tool_start", tool: "get-meeting", id: undefined });
    expect(parseAgentFrame({ type: "activity", label: "Reading" })).toEqual({
      type: "activity",
      label: "Reading",
      tool: undefined,
    });
  });

  it("drops frames it cannot render instead of inventing empty ones", () => {
    // A frame that changed shape upstream has to fail here. An empty step row
    // claiming work happened is worse than no row.
    expect(parseAgentFrame({ type: "tool_start" })).toBeNull();
    expect(parseAgentFrame({ type: "activity", label: "   " })).toBeNull();
    expect(parseAgentFrame({ type: "agent_call" })).toBeNull();
    expect(parseAgentFrame(null)).toBeNull();
    expect(parseAgentFrame("done")).toBeNull();
  });
});

describe("applyFrame", () => {
  it("pairs a tool result with the call that started it", () => {
    const steps = fold([
      { type: "tool_start", tool: "search-meetings", id: "t1" },
      { type: "tool_done", tool: "search-meetings", id: "t1", result: [1, 2] },
    ]);
    expect(steps).toEqual([
      {
        key: "id:t1",
        label: "Searching past meetings",
        kind: "read",
        status: "done",
        detail: "2 results",
      },
    ]);
  });

  it("keeps concurrent calls of one tool on separate rows", () => {
    const steps = fold([
      { type: "tool_start", tool: "get-meeting", id: "a" },
      { type: "tool_start", tool: "get-meeting", id: "b" },
      { type: "tool_done", tool: "get-meeting", id: "a" },
    ]);
    expect(steps.map((s) => s.status)).toEqual(["done", "running"]);
  });

  it("shows a result that never announced its start", () => {
    const steps = fold([
      { type: "tool_done", tool: "create-meeting", result: { count: 1 } },
    ]);
    expect(steps).toEqual([
      {
        key: "tool:create-meeting",
        label: "Creating a meeting",
        kind: "write",
        status: "done",
        detail: "1 result",
      },
    ]);
  });

  it("marks a failed tool as failed and carries no result detail", () => {
    const steps = fold([
      { type: "tool_start", tool: "provider-api-request", id: "t9" },
      {
        type: "tool_done",
        tool: "provider-api-request",
        id: "t9",
        isError: true,
        result: "Calendar is not connected",
      },
    ]);
    expect(steps[0].status).toBe("error");
    expect(steps[0].detail).toBeUndefined();
  });

  it("renames the work in flight rather than stacking a duplicate row", () => {
    const steps = fold([
      { type: "tool_start", tool: "get-meeting", id: "t1" },
      { type: "activity", label: "Reading the transcript" },
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0].label).toBe("Reading the transcript");
  });

  it("stands a progress label alone when no tool is running", () => {
    const steps = fold([{ type: "activity", label: "Thinking it through" }]);
    expect(steps).toEqual([
      {
        key: "activity:0",
        label: "Thinking it through",
        kind: "think",
        status: "running",
      },
    ]);
  });

  it("returns the same array when a frame changes nothing", () => {
    const before = fold([{ type: "tool_start", tool: "get-meeting", id: "t" }]);
    const after = applyFrame(before, {
      type: "tool_start",
      tool: "get-meeting",
      id: "t",
    });
    expect(after).toBe(before);
  });

  it("surfaces an approval the agent is blocked on", () => {
    const steps = fold([
      { type: "approval_required", tool: "provider-api-request" },
    ]);
    expect(steps[0]).toEqual({
      key: "approval:0",
      label: "Waiting for approval: Calling a connected app",
      kind: "wait",
      status: "blocked",
    });
  });
});

describe("settleSteps", () => {
  it("stops a row spinning once the stream is over", () => {
    const running = fold([{ type: "tool_start", tool: "get-meeting" }]);
    expect(settleSteps(running)[0].status).toBe("done");
  });

  it("leaves a settled list alone", () => {
    const settled: AgentStep[] = [
      { key: "a", label: "Done", kind: "read", status: "done" },
      { key: "b", label: "Failed", kind: "write", status: "error" },
    ];
    expect(settleSteps(settled)).toBe(settled);
  });

  it("does not resurrect a blocked approval as completed work", () => {
    const blocked = fold([{ type: "approval_required" }]);
    expect(settleSteps(blocked)[0].status).toBe("blocked");
  });
});

describe("kindForTool", () => {
  it("reads by default and only claims a write when the verb says so", () => {
    // Claiming the agent changed something it only looked at is the worse
    // error, so an unrecognized tool is a read.
    expect(kindForTool("get-meeting")).toBe("read");
    expect(kindForTool("search-meetings")).toBe("read");
    expect(kindForTool("something-new")).toBe("read");
    expect(kindForTool("create-meeting")).toBe("write");
    expect(kindForTool("send-email")).toBe("write");
    expect(kindForTool("provider-api-request")).toBe("call");
    expect(kindForTool("")).toBe("think");
  });
});

describe("thinking frames", () => {
  it("collects reasoning onto one step and keeps only the tail", () => {
    const steps = fold([
      { type: "thinking", text: "First I should " },
      { type: "thinking", text: "read the meeting." },
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe("think");
    expect(steps[0].detail).toBe("First I should read the meeting.");

    const long = fold([{ type: "thinking", text: "x".repeat(400) }]);
    expect(long[0].detail?.startsWith("…")).toBe(true);
    expect(long[0].detail).toHaveLength(221);
  });

  it("keeps reasoning and tool work on separate chips", () => {
    const steps = fold([
      { type: "thinking", text: "Checking the calendar first." },
      { type: "tool_start", tool: "provider-api-request", id: "t1" },
    ]);
    expect(steps.map((s) => s.kind)).toEqual(["think", "call"]);
  });
});

describe("summarizeToolResult", () => {
  it("counts collections", () => {
    expect(summarizeToolResult([1])).toBe("1 result");
    expect(summarizeToolResult({ meetings: [1, 2, 3] })).toBe("3 results");
    expect(summarizeToolResult({ count: 0 })).toBe("0 results");
  });

  it("takes the first line of a string, bounded", () => {
    expect(summarizeToolResult("Booked\nWednesday")).toBe("Booked");
    expect(summarizeToolResult("x".repeat(200))).toHaveLength(81);
  });

  it("says nothing rather than printing a blob", () => {
    // A stringified payload under the row reads as detail while saying less
    // than the label above it.
    expect(summarizeToolResult({ meeting: { id: "m1" } })).toBeUndefined();
    expect(summarizeToolResult(null)).toBeUndefined();
    expect(summarizeToolResult("   ")).toBeUndefined();
  });
});

describe("labelForTool", () => {
  it("falls back to the action's own id", () => {
    expect(labelForTool("get-meeting")).toBe("Reading this meeting");
    expect(labelForTool("some-new-action")).toBe("Some new action");
    expect(labelForTool("")).toBe("Working");
  });
});
