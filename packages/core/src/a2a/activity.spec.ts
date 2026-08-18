import { describe, expect, it } from "vitest";

import {
  MAX_A2A_ACTIVITY_TOOL_INPUT_CHARS,
  MAX_A2A_ACTIVITY_TOOL_RESULT_CHARS,
  applyA2AAgentActivityEvent,
  buildA2AAgentActivityPart,
  buildA2AAgentActivitySnapshot,
  createA2AAgentActivityState,
  parseA2AAgentActivityPart,
} from "./activity.js";

function toolCallAfter(input: Record<string, unknown>, result = "ok") {
  let state = createA2AAgentActivityState(1_000);
  state = applyA2AAgentActivityEvent(
    state,
    { type: "tool_start", tool: "bash", id: "call-1", input },
    1_100,
  );
  state = applyA2AAgentActivityEvent(
    state,
    { type: "tool_done", tool: "bash", id: "call-1", result },
    1_200,
  );
  return buildA2AAgentActivitySnapshot(state).toolCalls[0];
}

describe("Agent Native A2A activity", () => {
  it("records redacted tool input and a bounded result summary", () => {
    let state = createA2AAgentActivityState(1_000);
    state = applyA2AAgentActivityEvent(
      state,
      {
        type: "thinking",
        text: "Check the account before responding.\n",
      },
      1_100,
    );
    expect(buildA2AAgentActivitySnapshot(state)).toMatchObject({
      activePhase: "reasoning",
      reasoning: ["Check the account before responding.\n"],
    });

    state = applyA2AAgentActivityEvent(
      state,
      {
        type: "tool_start",
        tool: "send-email",
        id: "call-1",
        input: { to: "alice@example.test", subject: "Weekly digest" },
      },
      1_200,
    );

    // A still-running call already carries its arguments — the point of the
    // capture is diagnosing a call that never completes.
    const running = buildA2AAgentActivitySnapshot(state).toolCalls[0];
    expect(running.status).toBe("running");
    expect(JSON.parse(running.input!)).toEqual({
      to: "alice@example.test",
      subject: "Weekly digest",
    });

    state = applyA2AAgentActivityEvent(
      state,
      {
        type: "tool_done",
        tool: "send-email",
        id: "call-1",
        result: "queued message 42",
      },
      1_300,
    );

    const settled = buildA2AAgentActivitySnapshot(state).toolCalls[0];
    expect(settled).toMatchObject({
      name: "send-email",
      status: "completed",
      result: "queued message 42",
    });
    expect(JSON.parse(settled.input!).subject).toBe("Weekly digest");
    expect(
      parseA2AAgentActivityPart(buildA2AAgentActivityPart(state)),
    ).not.toBeNull();
  });

  it("truncates an oversized tool input with an explicit marker", () => {
    const oneBigArg = toolCallAfter({ command: "echo hi; ".repeat(4_000) });
    expect(oneBigArg.input!.length).toBeLessThanOrEqual(
      MAX_A2A_ACTIVITY_TOOL_INPUT_CHARS,
    );
    // Still parseable, and the clipped value says so rather than looking short.
    expect(JSON.parse(oneBigArg.input!).command).toContain("more chars");

    const manyArgs = toolCallAfter(
      Object.fromEntries(
        Array.from({ length: 40 }, (_, i) => [`arg${i}`, "value ".repeat(20)]),
      ),
    );
    expect(manyArgs.input!.length).toBeLessThanOrEqual(
      MAX_A2A_ACTIVITY_TOOL_INPUT_CHARS,
    );
    expect(JSON.parse(manyArgs.input!)._auditTruncated).toBe(true);
  });

  it("bounds an oversized tool result with an explicit marker", () => {
    const call = toolCallAfter(
      { command: "ls" },
      "line of output\n".repeat(500),
    );
    expect(call.result!.length).toBeLessThanOrEqual(
      MAX_A2A_ACTIVITY_TOOL_RESULT_CHARS,
    );
    expect(call.result).toContain("more chars");
  });

  it("round-trips normalized newlines in captured tool results", () => {
    let state = createA2AAgentActivityState(1_000);
    state = applyA2AAgentActivityEvent(
      state,
      { type: "tool_start", tool: "bash", id: "call-1", input: {} },
      1_100,
    );
    state = applyA2AAgentActivityEvent(
      state,
      {
        type: "tool_done",
        tool: "bash",
        id: "call-1",
        result: "first line\nsecond line",
      },
      1_200,
    );
    const snapshot = buildA2AAgentActivitySnapshot(state);

    expect(snapshot.toolCalls[0].result).toBe("first line\nsecond line");
    expect(parseA2AAgentActivityPart(buildA2AAgentActivityPart(state))).toEqual(
      snapshot,
    );
  });

  it("redacts credential-looking tool arguments", () => {
    const call = toolCallAfter({
      url: "https://api.example.test/v1/send",
      apiKey: "sk-live-000000000000000000000000",
      headers: { authorization: "Bearer not-a-real-token-value" },
      note: "https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXX",
    });
    const input = JSON.parse(call.input!);
    expect(input.url).toBe("https://api.example.test/v1/send");
    expect(input.apiKey).toBe("[redacted]");
    expect(input.headers.authorization).toBe("[redacted]");
    expect(input.note).toBe("[redacted]");
    expect(call.input).not.toContain("sk-live-");
    expect(call.input).not.toContain("hooks.slack.com");
  });

  it("bounds progressive response text while preserving markdown formatting", () => {
    let state = createA2AAgentActivityState(1_000);
    state = applyA2AAgentActivityEvent(
      state,
      { type: "text", text: "<b>Hello</b>\n\t" + "x".repeat(600) },
      1_100,
    );

    const snapshot = buildA2AAgentActivitySnapshot(state);
    expect(snapshot.responseText).toMatch(/^<b>Hello<\/b>\n\t/);
    expect(snapshot.responseText!.length).toBeLessThanOrEqual(32_768);
  });

  it("keeps response text emitted before a tool call instead of clearing it", () => {
    let state = createA2AAgentActivityState(1_000);
    state = applyA2AAgentActivityEvent(
      state,
      { type: "text", text: "Checking the numbers first." },
      1_100,
    );
    state = applyA2AAgentActivityEvent(
      state,
      { type: "tool_start", tool: "search", id: "call-1", input: {} },
      1_200,
    );
    state = applyA2AAgentActivityEvent(
      state,
      { type: "tool_done", tool: "search", id: "call-1", result: "done" },
      1_300,
    );
    state = applyA2AAgentActivityEvent(
      state,
      { type: "text", text: "Revenue grew **12%**." },
      1_400,
    );

    const snapshot = buildA2AAgentActivitySnapshot(state);
    expect(snapshot.response).toEqual([
      "Checking the numbers first.",
      "Revenue grew **12%**.",
    ]);
    expect(snapshot.responseText).toBe("Revenue grew **12%**.");
    expect(parseA2AAgentActivityPart({ type: "data", data: snapshot })).toEqual(
      snapshot,
    );
  });

  it("round-trips only a strict activity data part", () => {
    let state = createA2AAgentActivityState(1_000);
    state = applyA2AAgentActivityEvent(
      state,
      { type: "tool_start", tool: "search", id: "call-1", input: {} },
      1_250,
    );
    const part = buildA2AAgentActivityPart(state);

    expect(parseA2AAgentActivityPart(part)).toEqual(
      buildA2AAgentActivitySnapshot(state),
    );
    expect(
      parseA2AAgentActivityPart({
        ...part,
        data: { ...part.data, responseText: "bad\u0000text" },
      }),
    ).toBeNull();
  });

  it("merges contiguous reasoning deltas and redacts obvious credentials", () => {
    let state = createA2AAgentActivityState(1_000);
    state = applyA2AAgentActivityEvent(
      state,
      { type: "thinking", text: "First line\n" },
      1_100,
    );
    state = applyA2AAgentActivityEvent(
      state,
      { type: "thinking", text: "Bearer abcdefghijkl" },
      1_200,
    );

    expect(buildA2AAgentActivitySnapshot(state).reasoning).toEqual([
      "First line\nBearer [REDACTED]",
    ]);
  });

  it("starts a new reasoning segment after each tool call", () => {
    let state = createA2AAgentActivityState(1_000);
    state = applyA2AAgentActivityEvent(
      state,
      { type: "thinking", text: "Find the relevant data." },
      1_100,
    );
    state = applyA2AAgentActivityEvent(
      state,
      { type: "tool_start", tool: "search", id: "call-1", input: {} },
      1_200,
    );
    state = applyA2AAgentActivityEvent(
      state,
      { type: "tool_done", tool: "search", id: "call-1", result: "done" },
      1_300,
    );
    state = applyA2AAgentActivityEvent(
      state,
      { type: "thinking", text: "Now synthesize " },
      1_400,
    );
    state = applyA2AAgentActivityEvent(
      state,
      { type: "thinking", text: "the result." },
      1_500,
    );

    expect(buildA2AAgentActivitySnapshot(state).reasoning).toEqual([
      "Find the relevant data.",
      "Now synthesize the result.",
    ]);
  });
});
