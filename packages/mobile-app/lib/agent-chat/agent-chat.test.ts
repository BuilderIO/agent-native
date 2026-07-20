import { describe, expect, it } from "vitest";

import {
  activeMentionQuery,
  mentionToReference,
  replaceMention,
} from "./mention-query";
import { extractThreadId, navigateCommandDedupKey } from "./navigate-command";
import { applyWireEvent, cancelTurnState, initialTurnState } from "./reducer";
import { reattachDroppedRun } from "./run-reattach";
import { JsonEventStreamParser } from "./stream";
import { groupThreadsByApp } from "./thread-grouping";
import type { ChatThreadSummary, ChatTurnState, WireEvent } from "./types";
import { isTerminalWireEvent } from "./types";

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

  it("matches tool_done by toolCallId and flags isError results", () => {
    const state = run([
      { type: "tool_start", id: "t1", tool: "run-query" },
      {
        type: "tool_done",
        toolCallId: "t1",
        tool: "run-query",
        result: "permission denied",
        isError: true,
      },
    ]);
    expect(state.messages[0]!.parts[0]).toMatchObject({
      status: "failed",
      error: "permission denied",
      resultText: "permission denied",
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

  it("targets approval_required by toolCallId", () => {
    const state = run([
      { type: "tool_start", id: "t1", tool: "send-email" },
      { type: "approval_required", toolCallId: "t1", approvalKey: "k1" },
    ]);
    expect(state.messages[0]!.parts).toHaveLength(1);
    expect(state.messages[0]!.parts[0]).toMatchObject({
      status: "awaiting-approval",
      approvalKey: "k1",
    });
  });

  it("creates a standalone approval card when no tool_start preceded it", () => {
    const state = run([
      {
        type: "approval_required",
        toolCallId: "t9",
        tool: "delete-database",
        approvalKey: "k9",
        input: { id: 1 },
      },
    ]);
    expect(state.messages[0]!.parts[0]).toMatchObject({
      type: "tool-call",
      toolCallId: "t9",
      toolName: "delete-database",
      status: "awaiting-approval",
      approvalKey: "k9",
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

describe("extractThreadId", () => {
  it("prefers an explicit threadId", () => {
    expect(extractThreadId({ threadId: "t-1", path: "/chat/t-2" })).toBe("t-1");
  });

  it("reads threadId from a query string", () => {
    expect(extractThreadId({ path: "/chat?threadId=thread-123" })).toBe(
      "thread-123",
    );
    expect(
      extractThreadId({ path: "/dispatch/chat?threadId=a%2Fb&tab=x" }),
    ).toBe("a/b");
  });

  it("reads thread ids from chat paths of any app", () => {
    expect(extractThreadId({ path: "/chat/thread-123" })).toBe("thread-123");
    expect(extractThreadId({ path: "/dispatch/chat/thread-123" })).toBe(
      "thread-123",
    );
    expect(extractThreadId({ path: "/slides/chat/t-9?x=1#top" })).toBe("t-9");
  });

  it("returns null for non-chat commands", () => {
    expect(extractThreadId({ path: "/settings" })).toBeNull();
    expect(extractThreadId({ view: "inbox" })).toBeNull();
    expect(extractThreadId({})).toBeNull();
  });
});

describe("isTerminalWireEvent", () => {
  it("marks server-completion events as terminal", () => {
    for (const type of [
      "done",
      "error",
      "missing_api_key",
      "loop_limit",
      "auto_continue",
    ]) {
      expect(isTerminalWireEvent({ type })).toBe(true);
    }
    for (const type of ["text", "thinking", "tool_start", "tool_done"]) {
      expect(isTerminalWireEvent({ type })).toBe(false);
    }
  });
});

describe("reattachDroppedRun", () => {
  async function* events(...items: WireEvent[]): AsyncGenerator<WireEvent> {
    for (const item of items) yield item;
  }

  it("resumes from lastSeq+1 and stops at the terminal event", async () => {
    const applied: WireEvent[] = [];
    const resumeCalls: number[] = [];
    const result = await reattachDroppedRun({
      runId: "r1",
      lastSeq: 4,
      signal: new AbortController().signal,
      apply: (event) => applied.push(event),
      resume: async (_runId, after) => {
        resumeCalls.push(after);
        return {
          events: events(
            { type: "text", text: "tail", seq: 5 },
            { type: "done", seq: 6 },
          ),
        };
      },
      delayMs: 0,
    });
    expect(resumeCalls).toEqual([5]);
    expect(applied.map((e) => e.type)).toEqual(["text", "done"]);
    expect(result).toEqual({ sawTerminal: true, lastSeq: 6 });
  });

  it("retries dropped resume streams and advances the cursor", async () => {
    const resumeCalls: number[] = [];
    let attempt = 0;
    const result = await reattachDroppedRun({
      runId: "r1",
      lastSeq: -1,
      signal: new AbortController().signal,
      apply: () => {},
      resume: async (_runId, after) => {
        resumeCalls.push(after);
        attempt++;
        if (attempt === 1) {
          return { events: events({ type: "text", text: "a", seq: 0 }) };
        }
        return { events: events({ type: "done", seq: 1 }) };
      },
      delayMs: 0,
    });
    expect(resumeCalls).toEqual([0, 1]);
    expect(result.sawTerminal).toBe(true);
  });

  it("gives up after the attempt budget without a terminal event", async () => {
    let calls = 0;
    const result = await reattachDroppedRun({
      runId: "r1",
      lastSeq: -1,
      signal: new AbortController().signal,
      apply: () => {},
      resume: async () => {
        calls++;
        throw new Error("unreachable server");
      },
      attempts: 3,
      delayMs: 0,
    });
    expect(calls).toBe(3);
    expect(result.sawTerminal).toBe(false);
  });

  it("stops immediately when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const result = await reattachDroppedRun({
      runId: "r1",
      lastSeq: -1,
      signal: controller.signal,
      apply: () => {},
      resume: async () => {
        calls++;
        return { events: events({ type: "done", seq: 0 }) };
      },
      delayMs: 0,
    });
    expect(calls).toBe(0);
    expect(result.sawTerminal).toBe(false);
  });
});

describe("groupThreadsByApp", () => {
  const thread = (
    id: string,
    appId: string,
    updatedAt: number,
  ): ChatThreadSummary => ({
    id,
    title: `${appId} ${id}`,
    updatedAt,
    appId,
    appName: appId[0]!.toUpperCase() + appId.slice(1),
    appIcon: "MessageSquare",
    baseUrl: `https://${appId}.agent-native.com`,
  });

  it("groups threads under one header per app, preserving order", () => {
    // Newest-first across apps (as listAllThreads returns).
    const rows = groupThreadsByApp([
      thread("t1", "dispatch", 300),
      thread("t2", "content", 200),
      thread("t3", "dispatch", 100),
    ]);
    expect(
      rows.map((r) => (r.type === "header" ? `#${r.appName}` : r.key)),
    ).toEqual([
      "#Dispatch",
      "https://dispatch.agent-native.com:t1",
      "https://dispatch.agent-native.com:t3",
      "#Content",
      "https://content.agent-native.com:t2",
    ]);
  });

  it("keeps thread ids that repeat across apps distinct by origin", () => {
    const rows = groupThreadsByApp([
      thread("shared", "content", 200),
      thread("shared", "slides", 100),
    ]);
    const threadRows = rows.filter((r) => r.type === "thread");
    expect(threadRows.map((r) => r.key)).toEqual([
      "https://content.agent-native.com:shared",
      "https://slides.agent-native.com:shared",
    ]);
  });

  it("falls back to a Chat label when app metadata is absent", () => {
    const rows = groupThreadsByApp([{ id: "t1", title: "x", updatedAt: 1 }]);
    expect(rows[0]).toMatchObject({ type: "header", appName: "Chat" });
  });
});

describe("activeMentionQuery", () => {
  it("detects a mention being typed at the cursor", () => {
    const text = "summarize @age";
    expect(activeMentionQuery(text, text.length)).toEqual({
      query: "age",
      start: 10,
      end: 14,
    });
  });

  it("matches a bare @ with an empty query", () => {
    expect(activeMentionQuery("hey @", 5)).toEqual({
      query: "",
      start: 4,
      end: 5,
    });
  });

  it("ignores an @ that is mid-word (e.g. an email) or after whitespace", () => {
    expect(activeMentionQuery("mail me@x.com", 13)).toBeNull();
    expect(activeMentionQuery("done @file now", 14)).toBeNull();
  });

  it("only considers the fragment before the cursor", () => {
    const text = "a @one @two";
    // Cursor sits after "on" inside the first mention.
    expect(activeMentionQuery(text, 5)).toEqual({
      query: "on",
      start: 2,
      end: 5,
    });
  });
});

describe("replaceMention", () => {
  it("swaps the @query fragment for the inserted label and moves the cursor", () => {
    const text = "summarize @age here";
    const mention = activeMentionQuery("summarize @age", 14)!;
    const result = replaceMention(text, mention, "@AGENTS.md ");
    expect(result.text).toBe("summarize @AGENTS.md  here");
    expect(result.cursor).toBe("summarize @AGENTS.md ".length);
  });
});

describe("mentionToReference", () => {
  it("maps refType to the turn reference type", () => {
    expect(
      mentionToReference({
        id: "1",
        label: "AGENTS.md",
        source: "codebase",
        refType: "file",
        refPath: "AGENTS.md",
      }).type,
    ).toBe("file");
    expect(
      mentionToReference({
        id: "2",
        label: "Deck",
        source: "resource",
        refType: "deck",
        refId: "d1",
      }),
    ).toMatchObject({ type: "mention", name: "Deck", refId: "d1", path: "" });
  });
});

describe("navigateCommandDedupKey", () => {
  it("uses _writeId when present", () => {
    expect(navigateCommandDedupKey({ path: "/x", _writeId: "w1" })).toBe("w1");
  });

  it("falls back to JSON content", () => {
    expect(navigateCommandDedupKey({ path: "/x" })).toBe(
      JSON.stringify({ path: "/x" }),
    );
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
