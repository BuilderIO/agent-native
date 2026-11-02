import { describe, expect, it } from "vitest";

import { diagnosticEventMediaTime } from "./diagnostic-media-time";

const media = {
  recordingStartedAt: new Date(100_000).toISOString(),
  pauses: [
    {
      from: new Date(110_000).toISOString(),
      to: new Date(120_000).toISOString(),
    },
  ],
  durationMs: 30_000,
};
const event = (timestampMs: number) => ({
  timestampMs,
  elapsedMs: timestampMs - 100_000,
  type: "action" as const,
});

describe("diagnostic activity media coordinates", () => {
  it("seeks an event after a pause using actual footage time", () => {
    expect(diagnosticEventMediaTime(event(130_000), media)).toBe(20_000);
    expect(diagnosticEventMediaTime(event(120_000), media)).toBe(10_000);
  });

  it("does not claim media for history, pauses, or times after the recording", () => {
    expect(diagnosticEventMediaTime(event(99_999), media)).toBeNull();
    expect(diagnosticEventMediaTime(event(110_000), media)).toBeNull();
    expect(diagnosticEventMediaTime(event(115_000), media)).toBeNull();
    expect(diagnosticEventMediaTime(event(150_000), media)).toBeNull();
    expect(
      diagnosticEventMediaTime({ ...event(130_000), duringPause: true }, media),
    ).toBeNull();
  });
});
