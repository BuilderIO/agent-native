import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./run-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./run-store.js")>();
  return {
    ...actual,
    getCurrentTurnRunEventsForThread: vi.fn(),
  };
});

import {
  CHECKPOINT_TERMINAL_EVENT_SEQ,
  getCurrentTurnRunEventsForThread,
} from "./run-store.js";
import {
  buildAssistantMessageFromRunJournal,
  buildAssistantTurnFromRunJournal,
} from "./run-thread-projector.js";
import type { RunEvent } from "./types.js";

describe("buildAssistantMessageFromRunJournal", () => {
  beforeEach(() => {
    vi.mocked(getCurrentTurnRunEventsForThread).mockReset();
  });

  it("projects persisted content and supplements a terminal event not yet journaled", async () => {
    vi.mocked(getCurrentTurnRunEventsForThread).mockResolvedValue([
      {
        runId: "run-journal",
        seq: 0,
        event: { type: "text", text: "Persisted answer." },
      },
    ]);

    const message = await buildAssistantMessageFromRunJournal({
      threadId: "thread-journal",
      turnId: "turn-journal",
      runId: "run-journal",
      runEvents: [
        { seq: 0, event: { type: "text", text: "Buffered answer." } },
        { seq: 1, event: { type: "done" } },
      ],
    });

    expect(getCurrentTurnRunEventsForThread).toHaveBeenCalledWith(
      "thread-journal",
      "turn-journal",
    );
    expect(message?.content).toEqual([
      { type: "text", text: "Persisted answer." },
    ]);
    expect(message?.status).toEqual({ type: "complete", reason: "stop" });
  });

  it("projects unprojected events from earlier runs in the same turn", async () => {
    vi.mocked(getCurrentTurnRunEventsForThread).mockResolvedValue([
      {
        runId: "run-reaped",
        seq: 0,
        event: {
          type: "tool_start",
          tool: "send-email",
          id: "email-1",
          input: { to: "ana@example.com" },
        },
      },
      {
        runId: "run-reaped",
        seq: 1,
        event: {
          type: "tool_done",
          tool: "send-email",
          id: "email-1",
          input: { to: "ana@example.com" },
          result: "sent",
          completedSideEffect: true,
        },
      },
      {
        runId: "run-successor",
        seq: 0,
        event: { type: "text", text: "Recovery finished." },
      },
      {
        runId: "run-successor",
        seq: 1,
        event: {
          type: "tool_start",
          tool: "lookup-contact",
          id: "contact-1",
          input: { email: "ana@example.com" },
        },
      },
      {
        runId: "run-successor",
        seq: 2,
        event: {
          type: "tool_done",
          tool: "lookup-contact",
          id: "contact-1",
          input: { email: "ana@example.com" },
          result: { name: "Ana" },
        },
      },
    ]);

    const message = await buildAssistantMessageFromRunJournal({
      threadId: "thread-journal",
      turnId: "turn-journal",
      runId: "run-successor",
      runEvents: [
        { seq: 0, event: { type: "text", text: "Buffered recovery." } },
        {
          seq: 1,
          event: {
            type: "tool_start",
            tool: "lookup-contact",
            id: "contact-1",
            input: { email: "ana@example.com" },
          },
        },
        {
          seq: 2,
          event: {
            type: "tool_done",
            tool: "lookup-contact",
            id: "contact-1",
            input: { email: "ana@example.com" },
            result: { name: "Ana" },
          },
        },
        { seq: 3, event: { type: "done" } },
      ],
    });

    expect(message?.content).toEqual([
      expect.objectContaining({
        type: "tool-call",
        toolName: "send-email",
        args: { to: "ana@example.com" },
        result: "sent",
        completedSideEffect: true,
      }),
      { type: "text", text: "Recovery finished." },
      expect.objectContaining({
        type: "tool-call",
        toolName: "lookup-contact",
        args: { email: "ana@example.com" },
        result: { name: "Ana" },
      }),
    ]);
    expect(message?.metadata).toMatchObject({
      runId: "run-successor",
      custom: { foldedRunIds: ["run-reaped", "run-successor"] },
    });
  });

  it("preserves earlier run checkpoint boundaries while projecting a successor", async () => {
    vi.mocked(getCurrentTurnRunEventsForThread).mockResolvedValue([
      {
        runId: "run-interrupted",
        seq: 0,
        event: {
          type: "tool_start",
          tool: "send-email",
          id: "email-1",
          input: { to: "ana@example.com" },
        },
      },
      {
        runId: "run-interrupted",
        seq: CHECKPOINT_TERMINAL_EVENT_SEQ,
        event: { type: "auto_continue", reason: "run_timeout" },
      },
      {
        runId: "run-successor",
        seq: 0,
        event: { type: "text", text: "The ticket is open." },
      },
    ]);

    const message = await buildAssistantMessageFromRunJournal({
      threadId: "thread-journal",
      turnId: "turn-journal",
      runId: "run-successor",
      runEvents: [
        { seq: 0, event: { type: "text", text: "Buffered ticket result." } },
        { seq: 1, event: { type: "done" } },
      ],
      options: { suppressInternalContinuation: true },
    });

    expect(message?.content).toEqual([
      expect.objectContaining({
        type: "tool-call",
        toolCallId: "email-1",
        toolName: "send-email",
      }),
      { type: "text", text: "The ticket is open." },
    ]);
    expect(message?.content[0]).not.toHaveProperty("result");
    expect(message?.content[0]).not.toHaveProperty("outcome");
  });

  it("fails loudly when a published nonterminal event is absent from the journal", async () => {
    vi.mocked(getCurrentTurnRunEventsForThread).mockResolvedValue([]);
    const runEvents: RunEvent[] = [
      { seq: 4, event: { type: "text", text: "Not durable yet." } },
    ];

    await expect(
      buildAssistantMessageFromRunJournal({
        threadId: "thread-journal",
        turnId: "turn-journal",
        runId: "run-journal",
        runEvents,
      }),
    ).rejects.toMatchObject({
      name: "RunTranscriptJournalGapError",
      runId: "run-journal",
      missingSequences: [4],
    });
  });
});

describe("buildAssistantTurnFromRunJournal with messages sent into the turn", () => {
  const delivered = (runId: string, seq: number) => ({
    runId,
    seq,
    event: {
      type: "user_message" as const,
      message: {
        id: "queued-1",
        text: "Use the blue theme",
        createdAt: "2026-10-24T10:00:05.000Z",
      },
      continuationMessageId: `server-${runId}:after:queued-1`,
    },
  });

  beforeEach(() => {
    vi.mocked(getCurrentTurnRunEventsForThread).mockReset();
  });

  it("returns this run's reply before the message and the segments after it", async () => {
    vi.mocked(getCurrentTurnRunEventsForThread).mockResolvedValue([
      { runId: "run-1", seq: 0, event: { type: "text", text: "Checking." } },
      delivered("run-1", 1),
      { runId: "run-1", seq: 2, event: { type: "text", text: "Blue it is." } },
    ]);

    const turn = await buildAssistantTurnFromRunJournal({
      threadId: "thread-1",
      turnId: "turn-1",
      runId: "run-1",
      runEvents: [{ seq: 3, event: { type: "done" } }],
    });

    expect(turn.assistant?.content).toEqual([
      { type: "text", text: "Checking." },
    ]);
    expect(
      turn.steered.map(({ user, assistant }) => [user.id, assistant?.id]),
    ).toEqual([["queued-1", "server-run-1:after:queued-1"]]);
    expect(turn.parentId).toBeUndefined();
  });

  it("continues an earlier run's reply below the message it delivered", async () => {
    vi.mocked(getCurrentTurnRunEventsForThread).mockResolvedValue([
      { runId: "run-1", seq: 0, event: { type: "text", text: "Checking." } },
      delivered("run-1", 1),
      { runId: "run-1", seq: 2, event: { type: "text", text: "Blue " } },
      { runId: "run-2", seq: 0, event: { type: "text", text: "it is." } },
    ]);

    const turn = await buildAssistantTurnFromRunJournal({
      threadId: "thread-1",
      turnId: "turn-1",
      runId: "run-2",
      runEvents: [{ seq: 1, event: { type: "done" } }],
    });

    expect(turn.parentId).toBe("queued-1");
    expect(turn.steered).toEqual([]);
    expect(turn.assistant?.id).toBe("server-run-1:after:queued-1");
    expect(JSON.stringify(turn.assistant?.content)).not.toContain("Checking.");
    expect(
      turn.assistant?.content
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join(""),
    ).toContain("it is.");
  });
});
