// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import {
  subscribeChatFirstOpenApp,
  subscribeChatFirstOpenAppStart,
  type ChatFirstOpenAppDetail,
} from "./chat-first-state.js";
import { processEvent } from "./sse-event-processor.js";

describe("SSE open_app optimistic commit on tool_start and streaming args", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  it("emits optimistic openAppStart immediately on tool_start before tool_done arrives", () => {
    const optimistic: ChatFirstOpenAppDetail[] = [];
    const committed: ChatFirstOpenAppDetail[] = [];
    cleanups.push(
      subscribeChatFirstOpenAppStart((detail) => optimistic.push(detail)),
    );
    cleanups.push(
      subscribeChatFirstOpenApp((detail) => committed.push(detail)),
    );

    const content: Parameters<typeof processEvent>[1] = [];
    const counter = { value: 0 };
    const state = {
      completedToolsAfterLastAssistantText: new Set<string>(),
      streamProgressDispatched: false,
    };

    processEvent(
      {
        type: "tool_start",
        id: "call_1",
        tool: "open_app",
        input: { app: "decks-2", path: "/docs/deck-7" },
      },
      content,
      counter,
      "tab-1",
      state,
      { turnId: "turn-1" },
    );

    expect(optimistic).toEqual([
      {
        app: "decks-2",
        path: "/docs/deck-7",
        optimistic: true,
        turnId: "turn-1",
      },
    ]);
    expect(committed).toHaveLength(0);

    processEvent(
      {
        type: "tool_done",
        id: "call_1",
        tool: "open_app",
        result: JSON.stringify({ app: "decks-2", path: "/docs/deck-7" }),
      },
      content,
      counter,
      "tab-1",
      state,
      { turnId: "turn-1" },
    );

    expect(optimistic).toHaveLength(1);
    expect(committed).toEqual([
      {
        app: "decks-2",
        path: "/docs/deck-7",
        turnId: "turn-1",
      },
    ]);
  });

  it("commits on streaming tool_input_delta once valid JSON arrives and deduplicates tool_start", () => {
    const optimistic: ChatFirstOpenAppDetail[] = [];
    const committed: ChatFirstOpenAppDetail[] = [];
    cleanups.push(
      subscribeChatFirstOpenAppStart((detail) => optimistic.push(detail)),
    );
    cleanups.push(
      subscribeChatFirstOpenApp((detail) => committed.push(detail)),
    );

    const content: Parameters<typeof processEvent>[1] = [];
    const counter = { value: 0 };
    const state = {
      completedToolsAfterLastAssistantText: new Set<string>(),
      streamProgressDispatched: false,
    };

    processEvent(
      { type: "tool_input_start", id: "call_2", tool: "open_app" },
      content,
      counter,
      "tab-1",
      state,
      { turnId: "turn-2" },
    );
    processEvent(
      {
        type: "tool_input_delta",
        id: "call_2",
        tool: "open_app",
        text: '{"app":"mail-2",',
      },
      content,
      counter,
      "tab-1",
      state,
      { turnId: "turn-2" },
    );
    expect(optimistic).toHaveLength(0);

    processEvent(
      {
        type: "tool_input_delta",
        id: "call_2",
        tool: "open_app",
        text: '"path":"/thread/t-1","focus":true}',
      },
      content,
      counter,
      "tab-1",
      state,
      { turnId: "turn-2" },
    );
    expect(optimistic).toEqual([
      {
        app: "mail-2",
        path: "/thread/t-1",
        focus: true,
        optimistic: true,
        turnId: "turn-2",
      },
    ]);

    processEvent(
      {
        type: "tool_start",
        id: "call_2",
        tool: "open_app",
        input: { app: "mail-2", path: "/thread/t-1", focus: true },
      },
      content,
      counter,
      "tab-1",
      state,
      { turnId: "turn-2" },
    );
    expect(optimistic).toHaveLength(1);

    processEvent(
      {
        type: "tool_done",
        id: "call_2",
        tool: "open_app",
        result: JSON.stringify({
          app: "mail-2",
          path: "/thread/t-1",
          url: "https://workspace.example.test/mail-2/thread/t-1",
          focus: true,
        }),
      },
      content,
      counter,
      "tab-1",
      state,
      { turnId: "turn-2" },
    );
    expect(committed).toEqual([
      {
        app: "mail-2",
        path: "/thread/t-1",
        url: "https://workspace.example.test/mail-2/thread/t-1",
        focus: true,
        turnId: "turn-2",
      },
    ]);
  });

  it("dispatches agent-native:turn-start on user_message", () => {
    const turnStarts: Array<Record<string, unknown>> = [];
    const onTurnStart = (event: Event) => {
      turnStarts.push((event as CustomEvent<Record<string, unknown>>).detail);
    };
    window.addEventListener("agent-native:turn-start", onTurnStart);
    cleanups.push(() =>
      window.removeEventListener("agent-native:turn-start", onTurnStart),
    );

    processEvent(
      { type: "user_message" },
      [],
      { value: 0 },
      "tab-1",
      {
        completedToolsAfterLastAssistantText: new Set<string>(),
        streamProgressDispatched: false,
      },
      { runId: "run-9", turnId: "turn-9" },
    );

    expect(turnStarts).toEqual([
      { tabId: "tab-1", runId: "run-9", turnId: "turn-9" },
    ]);
  });
});
