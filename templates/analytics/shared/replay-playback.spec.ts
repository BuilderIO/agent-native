import { describe, expect, it } from "vitest";

import {
  buildReplayViewportTimeline,
  replayOffsetFromRecordingStart,
  replayRouteAtOffset,
  replayViewportDimensionsAtTime,
  resolveReplayOffsetFromRecordingStart,
} from "./replay-playback";

describe("recording-relative replay offsets", () => {
  it("maps the journey timestamp to rrweb time for route and viewport state", () => {
    const events = [
      {
        type: 4,
        timestamp: 900,
        data: {
          href: "https://app.example.test/start",
          width: 1280,
          height: 720,
        },
      },
      { type: 2, timestamp: 950, data: { node: { type: 0, childNodes: [] } } },
      {
        type: 4,
        timestamp: 1_400,
        data: {
          href: "https://app.example.test/onboarding",
          width: 1280,
          height: 720,
        },
      },
      {
        type: 3,
        timestamp: 1_450,
        data: { source: 4, width: 800, height: 900 },
      },
    ];
    const playheadOffsetMs = replayOffsetFromRecordingStart(events, 800, 650);

    expect(playheadOffsetMs).toBe(550);
    expect(replayRouteAtOffset(events, playheadOffsetMs!)).toBe("/onboarding");
    expect(
      replayViewportDimensionsAtTime(
        buildReplayViewportTimeline(events),
        playheadOffsetMs!,
      ),
    ).toEqual({ width: 800, height: 900 });
  });

  it("reports a target that falls before the first replay event", () => {
    expect(
      replayOffsetFromRecordingStart([{ timestamp: 1_100 }], 1_000, 50),
    ).toBeNull();
    expect(
      resolveReplayOffsetFromRecordingStart([{ timestamp: 1_100 }], 1_000, 50),
    ).toEqual({
      requestedOffsetMs: 50,
      availableOffsetMs: 100,
      playheadOffsetMs: 0,
      exact: false,
      range: "before",
    });
  });

  it("reports the nearest final replay frame when the target is after playback", () => {
    expect(
      resolveReplayOffsetFromRecordingStart(
        [{ timestamp: 900 }, { timestamp: 1_100 }],
        800,
        500,
      ),
    ).toEqual({
      requestedOffsetMs: 500,
      availableOffsetMs: 300,
      playheadOffsetMs: 200,
      exact: false,
      range: "after",
    });
    expect(
      replayOffsetFromRecordingStart(
        [{ timestamp: 900 }, { timestamp: 1_100 }],
        800,
        500,
      ),
    ).toBeNull();
  });

  it("keeps an exact first-event target at player time zero", () => {
    expect(replayOffsetFromRecordingStart([{ timestamp: 900 }], 800, 100)).toBe(
      0,
    );
  });
});
