import { describe, expect, it } from "vitest";

import { applyWireEvent, cancelTurnState, initialTurnState } from "./reducer";
import { JsonEventStreamParser } from "./stream";
import type { ChatTurnState, WireEvent } from "./types";

function run(events: WireEvent[], assistantId = "a1"): ChatTurnState {
  const start: ChatTurnState = { ...initialTurnState(), isStreaming: true };
  return events.reduce(
    (state, event) => applyWireEvent(state, event, assistantId),
    start,
  );
}

describe("JsonEventStreamParser", () => {
  it("parses bare JSON lines split across chunks", () => {
    const parser = new JsonEventStreamParser();
    const first = parser.push('{"type":"text","te');
    const second = parser.push('xt":"hi"}\n{"type":"done"}\n');
    expect(first).toEqual([]);
    expect(second).toEqual([{ type: "text", text: "hi" }, { type: "done" }]);
  });

  it("parses SSE data: framing with blank-line flushes", () => {
    const parser = new JsonEventStreamParser();
    const events = parser.push(
      'data: {"type":"text","text":"a"}\n\ndata: {"type":"done"}\n\n',
    );
    expect(events).toEqual([{ type: "text", text: "a" }, { type: "done" }]);
  });

  it("drains trailing content without newline on end", () => {
    const parser = new JsonEventStreamParser();
    parser.push('{"type":"text","text":"x"}\n{"type":"done"}');
    expect(parser.end()).toEqual([{ type: "done" }]);
  });

  it("skips [DONE] sentinels and malformed lines", () => {
    const parser = new JsonEventStreamParser();
    const events = parser.push('[DONE]\nnot-json\n{"type":"done"}\n');
    expect(events).toEqual([{ type: "done" }]);
  });
});

describe("applyWireEvent", () => {
  it("accumulates text deltas into one part", () => {
    const state = run([
      { type: "text", text: "Hel" },
      { type: "text", text: "lo" },
    ]);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]!.parts).toEqual([{ type: "text", text: "Hello" }]);
  });

  it("keeps reasoning and text in separate parts", () => {
    const state = run([
      { type: "thinking", text: "hmm" },
      { type: "text", text: "answer" },
    ]);
    expect(state.messages[0]!.parts.map((p) => p.type)).toEqual([
      "reasoning",
      "text",
    ]);
  });

  it("groups deltas by partId", () => {
    const state = run([
      { type: "text", text: "a", partId: "p1" },
      { type: "text", text: "b", partId: "p2" },
      { type: "text", text: "c", partId: "p1" },
    ]);
    expect(state.messages[0]!.parts).toEqual([
      { type: "text", text: "ac", partId: "p1" },
      { type: "text", text: "b", partId: "p2" },
    ]);
  });

  it("tracks tool lifecycle from start to done", () => {
    const state = run([
      { type: "tool_start", id: "t1", tool: "navigate", input: { to: "/" } },
      { type: "tool_done", id: "t1", tool: "navigate", result: "ok" },
    ]);
    const part = state.messages[0]!.parts[0]!;
    expect(part).toMatchObject({
      type: "tool-call",
      toolCallId: "t1",
      toolName: "navigate",
      status: "completed",
      resultText: "ok",
    });
  });

  it("marks failed tools and clears activity", () => {
    const state = run([
      { type: "activity", label: "Running navigate" },
      { type: "tool_start", id: "t1", tool: "navigate" },
      { type: "tool_done", id: "t1", tool: "navigate", error: "boom" },
    ]);
    expect(state.messages[0]!.parts[0]).toMatchObject({
      status: "failed",
      error: "boom",
    });
  });

  it("flags approval_required on the pending tool call", () => {
    const state = run([
      { type: "tool_start", id: "t1", tool: "delete-all" },
      {
        type: "approval_required",
        id: "t1",
        tool: "delete-all",
        approvalKey: "k1",
      },
    ]);
    expect(state.messages[0]!.parts[0]).toMatchObject({
      status: "awaiting-approval",
      approvalKey: "k1",
    });
  });

  it("settles running tools and stops streaming on error", () => {
    const state = run([
      { type: "tool_start", id: "t1", tool: "navigate" },
      { type: "error", error: "credits exhausted", errorCode: "credits" },
    ]);
    expect(state.isStreaming).toBe(false);
    expect(state.error).toBe("credits exhausted");
    expect(state.errorCode).toBe("credits");
    expect(state.messages[0]!.parts[0]).toMatchObject({ status: "failed" });
  });

  it("maps missing_api_key to its errorCode", () => {
    const state = run([{ type: "missing_api_key", error: "no key" }]);
    expect(state.errorCode).toBe("missing_api_key");
  });

  it("finishes cleanly on done", () => {
    const state = run([{ type: "text", text: "hi" }, { type: "done" }]);
    expect(state.isStreaming).toBe(false);
    expect(state.error).toBeNull();
  });
});

describe("cancelTurnState", () => {
  it("keeps partial text, cancels running tools, no error", () => {
    const streaming = run([
      { type: "text", text: "partial answer" },
      { type: "tool_start", id: "t1", tool: "web_search" },
    ]);
    const state = cancelTurnState(streaming, "a1");
    expect(state.isStreaming).toBe(false);
    expect(state.activity).toBeNull();
    expect(state.error).toBeNull();
    expect(state.messages[0]!.parts[0]).toEqual({
      type: "text",
      text: "partial answer",
    });
    expect(state.messages[0]!.parts[1]).toMatchObject({
      type: "tool-call",
      status: "cancelled",
    });
  });

  it("does not invent an assistant message when nothing streamed", () => {
    const state = cancelTurnState(
      { ...initialTurnState(), isStreaming: true },
      "a1",
    );
    expect(state.messages).toHaveLength(0);
    expect(state.isStreaming).toBe(false);
  });
});
