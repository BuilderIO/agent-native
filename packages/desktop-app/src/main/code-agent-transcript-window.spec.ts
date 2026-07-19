import { describe, expect, it } from "vitest";

import {
  boundedCodeAgentTranscriptSnapshot,
  CODE_AGENT_TRANSCRIPT_SNAPSHOT_EVENT_LIMIT,
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
});
