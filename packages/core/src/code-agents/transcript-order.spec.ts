import { describe, expect, it } from "vitest";

import {
  compareCodeAgentTranscriptEvents,
  isCodeAgentRunActive,
  mergeCodeAgentTranscriptEvents,
} from "./transcript-order.js";

describe("code agent transcript order", () => {
  it("orders by seq before timestamp and id", () => {
    const events = [
      {
        id: "later",
        createdAt: "2026-05-17T12:00:00.000Z",
        metadata: { seq: 2 },
      },
      {
        id: "earlier",
        createdAt: "2026-05-17T12:05:00.000Z",
        metadata: { seq: 1 },
      },
    ];

    expect([...events].sort(compareCodeAgentTranscriptEvents)).toEqual([
      events[1],
      events[0],
    ]);
  });

  it("merges duplicate event ids with the newest copy", () => {
    const merged = mergeCodeAgentTranscriptEvents(
      [
        {
          id: "evt-1",
          createdAt: "2026-05-17T12:00:00.000Z",
          metadata: { seq: 1, text: "old" },
        },
      ],
      [
        {
          id: "evt-1",
          createdAt: "2026-05-17T12:00:00.000Z",
          metadata: { seq: 1, text: "new" },
        },
        {
          id: "evt-2",
          createdAt: "2026-05-17T12:01:00.000Z",
          metadata: { seq: 2 },
        },
      ],
    );

    expect(merged.map((event) => event.id)).toEqual(["evt-1", "evt-2"]);
    expect(merged[0]?.metadata?.text).toBe("new");
  });
});

describe("isCodeAgentRunActive", () => {
  it("treats running and queued phases as active", () => {
    expect(isCodeAgentRunActive({ status: "running" })).toBe(true);
    expect(isCodeAgentRunActive({ status: "queued" })).toBe(true);
  });

  it("treats terminal and approval states as inactive", () => {
    expect(isCodeAgentRunActive({ status: "completed" })).toBe(false);
    expect(isCodeAgentRunActive({ phase: "missing-credentials" })).toBe(false);
    expect(isCodeAgentRunActive({ needsApproval: true })).toBe(false);
    expect(
      isCodeAgentRunActive({
        status: "running",
        metadata: { runnerState: "stopped" },
      }),
    ).toBe(false);
  });
});
