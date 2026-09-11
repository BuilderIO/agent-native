import { describe, expect, it } from "vitest";

import {
  applyFrame,
  askIncompleteForFrame,
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

  // Model chunks are not word-aligned, so a lone " " or "\n" arrives as its
  // own delta. Dropping those is what renders "the meeting" as "themeeting".
  it("keeps a whitespace-only text delta, which is a space in the answer", () => {
    expect(parseAgentFrame({ type: "text", text: " " })).toEqual({
      type: "text",
      text: " ",
    });
    expect(parseAgentFrame({ type: "text", text: "\n" })).toEqual({
      type: "text",
      text: "\n",
    });
    expect(parseAgentFrame({ type: "thinking", text: " " })).toEqual({
      type: "thinking",
      text: " ",
    });
    // Genuinely absent is still absent.
    expect(parseAgentFrame({ type: "text", text: "" })).toBeNull();
    expect(parseAgentFrame({ type: "text" })).toBeNull();
  });

  it("still treats a blank label or tool id as absent", () => {
    // Blank means "a space" in a delta and "nothing" in an identifier.
    expect(parseAgentFrame({ type: "tool_start", tool: "  " })).toBeNull();
    expect(parseAgentFrame({ type: "activity", label: " " })).toBeNull();
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

  // The grant is the whole point of the frame: without it nothing can ever
  // re-issue the turn with `approvedToolCalls`, so a row rendered from a
  // keyless frame is a permanent spinner with nothing behind it.
  it("keeps the grant an approval needs to be resumed", () => {
    expect(
      parseAgentFrame({
        type: "approval_required",
        tool: "provider-api-request",
        approvalKey: "approval:provider-api-request:7",
        toolCallId: "call_7",
        askId: "ask_1",
        input: { url: "https://example.test", note: 3 },
      }),
    ).toEqual({
      type: "approval_required",
      tool: "provider-api-request",
      approvalKey: "approval:provider-api-request:7",
      toolCallId: "call_7",
      askId: "ask_1",
      input: { url: "https://example.test" },
    });
  });

  it("refuses an approval frame with no tool or no grant", () => {
    expect(parseAgentFrame({ type: "approval_required" })).toBeNull();
    expect(
      parseAgentFrame({ type: "approval_required", tool: "update-meeting" }),
    ).toBeNull();
    expect(
      parseAgentFrame({ type: "approval_required", approvalKey: "k" }),
    ).toBeNull();
  });

  // These close the stream exactly like `done` does. Dropping them was what
  // let a run cut at a timeout be presented as a finished answer.
  it("reads the terminal frames that mean the run did not finish", () => {
    expect(
      parseAgentFrame({ type: "auto_continue", reason: "run_timeout" }),
    ).toEqual({ type: "auto_continue", reason: "run_timeout" });
    expect(parseAgentFrame({ type: "loop_limit", maxIterations: 40 })).toEqual({
      type: "loop_limit",
      maxIterations: 40,
    });
  });
});

describe("askIncompleteForFrame", () => {
  it("names a truncated run rather than letting it pass as an answer", () => {
    expect(
      askIncompleteForFrame({ type: "auto_continue", reason: "run_timeout" })
        ?.kind,
    ).toBe("auto_continue");
    expect(askIncompleteForFrame({ type: "loop_limit" })?.kind).toBe(
      "loop_limit",
    );
    expect(
      askIncompleteForFrame({
        type: "approval_required",
        tool: "update-meeting",
        approvalKey: "k",
      })?.kind,
    ).toBe("approval_required");
  });

  it("treats a clean finish as complete", () => {
    expect(askIncompleteForFrame({ type: "done" })).toBeNull();
    expect(
      askIncompleteForFrame({ type: "tool_start", tool: "get-meeting" }),
    ).toBeNull();
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
        kind: "search",
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
      {
        type: "approval_required",
        tool: "provider-api-request",
        approvalKey: "approval:provider-api-request:1",
      },
    ]);
    expect(steps[0]).toEqual({
      key: "approval:approval:provider-api-request:1",
      label: "Needs approval: Calling a connected app",
      kind: "wait",
      status: "blocked",
    });
  });

  // A failed resume re-emits the same approval with a fresh `askId`. Keying by
  // position stacked a second identical row, which read as two separate asks.
  it("updates one approval row instead of stacking a re-ask", () => {
    const steps = fold([
      {
        type: "approval_required",
        tool: "provider-api-request",
        approvalKey: "k1",
        askId: "a1",
      },
      {
        type: "approval_required",
        tool: "provider-api-request",
        approvalKey: "k1",
        askId: "a2",
      },
    ]);
    expect(steps).toHaveLength(1);
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
    const blocked = fold([
      { type: "approval_required", tool: "update-meeting", approvalKey: "k" },
    ]);
    expect(settleSteps(blocked)[0].status).toBe("blocked");
  });

  // "Searched" under an answer that was cut off mid-search is the same lie as
  // calling the fragment an answer.
  it("does not mark work done when the run was cut off", () => {
    const running = fold([{ type: "tool_start", tool: "search-meetings" }]);
    const cut = settleSteps(running, {
      kind: "auto_continue",
      message: "cut",
    });
    expect(cut[0].status).toBe("blocked");
    expect(settleSteps(running, null)[0].status).toBe("done");
  });
});

describe("kindForTool", () => {
  it("reads by default and only claims a write when the verb says so", () => {
    // Claiming the agent changed something it only looked at is the worse
    // error, so an unrecognized tool is a read.
    expect(kindForTool("get-meeting")).toBe("read");
    // A magnifier chip over the word "Reading" is the mismatch that reads as
    // a bug, so searching is its own bucket.
    expect(kindForTool("search-meetings")).toBe("search");
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
