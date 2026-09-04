import { describe, expect, it } from "vitest";

import {
  boundedCodeAgentTranscriptSnapshot,
  boundedCodeAgentTranscriptEvents,
  boundedCodeAgentTranscriptWindow,
  CODE_AGENT_TRANSCRIPT_SNAPSHOT_BYTE_LIMIT,
  CODE_AGENT_TRANSCRIPT_SNAPSHOT_EVENT_LIMIT,
  serializedCodeAgentTranscriptEventsBytes,
} from "./code-agent-transcript-window.js";

describe("boundedCodeAgentTranscriptSnapshot", () => {
  it("returns a bounded tail without changing event payloads", () => {
    const events = Array.from({ length: 240 }, (_, index) => ({
      id: `event-${index}`,
      text: `Readable text ${index}`,
      metadata: index === 239 ? { unexpected: { provider: "future" } } : {},
    }));

    const snapshot = boundedCodeAgentTranscriptSnapshot(events);

    expect(snapshot).toHaveLength(CODE_AGENT_TRANSCRIPT_SNAPSHOT_EVENT_LIMIT);
    expect(snapshot[0]?.id).toBe("event-40");
    expect(snapshot.at(-1)).toEqual(events.at(-1));
  });

  it("does not retain a caller-owned array", () => {
    const events = ["one", "two"];
    const snapshot = boundedCodeAgentTranscriptSnapshot(events);

    snapshot.push("three");

    expect(events).toEqual(["one", "two"]);
  });

  it("uses UTF-8 serialized bytes to return a contiguous bounded tail", () => {
    const events = [
      { id: "old", text: "older event" },
      { id: "multibyte", text: "🙂".repeat(16) },
      { id: "latest", text: "latest event" },
    ];
    const byteLimit =
      serializedCodeAgentTranscriptEventsBytes([events[2]]) + 1_024;

    const snapshot = boundedCodeAgentTranscriptWindow(events, {
      byteLimit,
    });

    expect(snapshot.events).toEqual([events[2]]);
    expect(snapshot.truncation).toEqual({
      reason: "byte-limit",
      omittedEventCount: 2,
      retainedEventCount: 1,
      eventLimit: CODE_AGENT_TRANSCRIPT_SNAPSHOT_EVENT_LIMIT,
      byteLimit,
    });
    expect(
      serializedCodeAgentTranscriptEventsBytes(snapshot.events),
    ).toBeLessThan(byteLimit);
  });

  it("drops a single oversized tail event instead of creating an unbounded payload", () => {
    const byteLimit = 2_048;
    const events = [
      { id: "old", text: "small" },
      { id: "oversized", text: "x".repeat(byteLimit * 4) },
    ];

    const snapshot = boundedCodeAgentTranscriptWindow(events, { byteLimit });

    expect(snapshot.events).toEqual([]);
    expect(snapshot.truncation).toEqual({
      reason: "byte-limit",
      omittedEventCount: 2,
      retainedEventCount: 0,
      eventLimit: CODE_AGENT_TRANSCRIPT_SNAPSHOT_EVENT_LIMIT,
      byteLimit,
    });
  });

  it("returns a bounded explicit marker before the retained transcript tail", () => {
    const events = Array.from({ length: 201 }, (_, index) => ({
      id: `event-${index}`,
      runId: "run-1",
      type: "system" as const,
      text: `event ${index}`,
      createdAt: `2026-07-19T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
    }));

    const snapshot = boundedCodeAgentTranscriptEvents(events, "run-1");

    expect(snapshot).toHaveLength(CODE_AGENT_TRANSCRIPT_SNAPSHOT_EVENT_LIMIT);
    expect(snapshot[0]).toMatchObject({
      id: "transcript-truncated-run-1-event-200",
      type: "status",
      metadata: {
        source: "desktop-transcript-window",
        transcriptTruncation: {
          reason: "event-limit",
          omittedEventCount: 2,
        },
      },
    });
    expect(snapshot[1]?.id).toBe("event-2");
    expect(snapshot.at(-1)?.id).toBe("event-200");
  });

  it("replaces one huge event with marker metadata below the renderer byte cap", () => {
    const snapshot = boundedCodeAgentTranscriptEvents(
      [
        {
          id: "huge",
          runId: "run-1",
          type: "system",
          text: "🙂".repeat(CODE_AGENT_TRANSCRIPT_SNAPSHOT_BYTE_LIMIT),
          createdAt: "2026-07-19T00:00:00.000Z",
        },
      ],
      "run-1",
    );

    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({
      type: "status",
      metadata: {
        transcriptTruncation: {
          reason: "byte-limit",
          omittedEventCount: 1,
        },
      },
    });
    expect(serializedCodeAgentTranscriptEventsBytes(snapshot)).toBeLessThan(
      CODE_AGENT_TRANSCRIPT_SNAPSHOT_BYTE_LIMIT,
    );
  });
});
