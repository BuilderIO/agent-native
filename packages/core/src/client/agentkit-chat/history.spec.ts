import type { AgentEvent, AgentMessage } from "@agent-native/agentkit/protocol";
import { describe, expect, it } from "vitest";

import {
  findAgentKitHistoryBeginningVersion,
  findAgentKitHistoryVersion,
  getAgentKitHistoryMessages,
  runAgentKitHistoryBeforeStart,
} from "./history.js";

describe("AgentKit chat history", () => {
  it("matches a completed side-effecting turn and finds its beginning version", () => {
    const threadId = "thread-1";
    const runId = "run-1";
    const message: AgentMessage = {
      id: "message-1",
      role: "assistant",
      parts: [{ type: "text", text: "Updated the slide." }],
      createdAt: "2026-09-25T12:00:02.000Z",
      status: "complete",
      metadata: {
        turnId: "turn-1",
        chatScope: { type: "deck", id: "deck-1" },
      },
    };
    const toolEvent: AgentEvent = {
      id: "event-tool",
      threadId,
      runId,
      sequence: 1,
      occurredAt: "2026-09-25T12:00:01.000Z",
      type: "tool.updated",
      toolCall: {
        id: "tool-1",
        name: "update-slide",
        status: "completed",
        runId,
        metadata: { completedSideEffect: true },
      },
    };
    const completedEvent: AgentEvent = {
      id: "event-completed",
      threadId,
      runId,
      sequence: 3,
      occurredAt: "2026-09-25T12:00:03.000Z",
      type: "run.completed",
    };
    const messageEvent: AgentEvent = {
      id: "event-message",
      threadId,
      runId,
      sequence: 2,
      occurredAt: "2026-09-25T12:00:02.000Z",
      type: "message.completed",
      message,
    };
    const historyMessages = getAgentKitHistoryMessages(threadId, {
      messages: [message],
      events: [toolEvent, messageEvent, completedEvent],
      runs: { [runId]: { status: "completed" } },
      tools: {},
    });
    const messageVersion = {
      id: "version-after-turn",
      createdAt: "2026-09-25T12:00:04.000Z",
      chatContext: { threadId, runId, turnId: "turn-1", phase: "end" as const },
    };
    const beginningVersion = {
      id: "version-at-start",
      createdAt: "2026-09-25T11:59:00.000Z",
      chatContext: { threadId, phase: "start" as const },
    };

    expect(historyMessages).toHaveLength(1);
    expect(historyMessages[0]?.hasCompletedSideEffect).toBe(true);
    expect(
      findAgentKitHistoryVersion([messageVersion], historyMessages[0]!, {
        scope: { type: "deck", id: "deck-1" },
      }),
    ).toBe(messageVersion);
    expect(
      findAgentKitHistoryBeginningVersion([beginningVersion], threadId),
    ).toBe(beginningVersion);
  });

  it("awaits host save flushing before allowing a composer submit", async () => {
    const calls: string[] = [];

    const allowed = await runAgentKitHistoryBeforeStart(async () => {
      await Promise.resolve();
      calls.push("flushed");
    });

    expect(calls).toEqual(["flushed"]);
    expect(allowed).toBe(true);
  });

  it("matches stored data-part effects after failed runs without run snapshots", () => {
    const threadId = "thread-2";
    const runId = "run-failed-after-edit";
    const message: AgentMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "text", text: "The change was applied before the run failed." },
        { type: "data", data: { completedSideEffect: true } },
      ],
      createdAt: "2026-09-25T12:00:02.000Z",
      status: "error",
      metadata: { runId },
    };
    const historyMessages = getAgentKitHistoryMessages(threadId, {
      messages: [message],
      events: [
        {
          id: "run-failed",
          threadId,
          runId,
          sequence: 1,
          occurredAt: "2026-09-25T12:00:03.000Z",
          type: "run.failed",
          error: { code: "runtime_error", message: "Stopped after the edit." },
        },
      ],
      runs: {},
      tools: {},
    });

    expect(historyMessages).toHaveLength(1);
    expect(historyMessages[0]?.hasCompletedSideEffect).toBe(true);
  });
});
