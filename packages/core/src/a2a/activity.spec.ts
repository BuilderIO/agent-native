import { describe, expect, it } from "vitest";

import {
  applyA2AAgentActivityEvent,
  buildA2AAgentActivityPart,
  buildA2AAgentActivitySnapshot,
  createA2AAgentActivityState,
  parseA2AAgentActivityPart,
} from "./activity.js";

describe("Agent Native A2A activity", () => {
  it("keeps tool input and tool results off the A2A payload", () => {
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
        input: { to: "alice@example.test", secret: "abc123" },
      },
      1_200,
    );
    state = applyA2AAgentActivityEvent(
      state,
      {
        type: "tool_done",
        tool: "send-email",
        id: "call-1",
        result: "sent to alice@example.test with secret abc123",
      },
      1_300,
    );

    const serialized = JSON.stringify(buildA2AAgentActivitySnapshot(state));
    expect(serialized).toContain("send-email");
    expect(serialized).toContain("completed");
    expect(serialized).not.toContain("alice@example.test");
    expect(serialized).not.toContain("abc123");
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
