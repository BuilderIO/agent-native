import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./run-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./run-store.js")>();
  return {
    ...actual,
    getCurrentTurnRunEventsForThread: vi.fn(),
  };
});

import { getCurrentTurnRunEventsForThread } from "./run-store.js";
import { buildAssistantMessageFromRunJournal } from "./run-thread-projector.js";
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
