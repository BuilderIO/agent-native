import { describe, expect, it } from "vitest";

import { toAgentTranscriptSegments } from "../../shared/agent-context.js";
import { buildAgentEditedTimeline } from "./agent-edited-timeline.js";

const edits = JSON.stringify({
  version: 1,
  trims: [{ id: "c1", startMs: 10_000, endMs: 40_000, excluded: true }],
  blurs: [],
});

describe("buildAgentEditedTimeline", () => {
  it("reports the played duration, not the original recording's", () => {
    const timeline = buildAgentEditedTimeline(edits, 60_000);
    expect(timeline.durationMs).toBe(30_000);
  });

  it("maps edited times back to the original recording", () => {
    const timeline = buildAgentEditedTimeline(edits, 60_000);
    expect(timeline.toSourceMs(5_000)).toBe(5_000);
    expect(timeline.toSourceMs(10_000)).toBe(40_000);
    expect(timeline.toSourceMs(15_000)).toBe(45_000);
    expect(timeline.cutBoundariesMs).toEqual([10_000]);
  });

  it("drops cut speech and shifts later speech", () => {
    const timeline = buildAgentEditedTimeline(edits, 60_000);
    const segments = toAgentTranscriptSegments([
      { startMs: 1_000, endMs: 2_000, text: "kept before" },
      { startMs: 20_000, endMs: 25_000, text: "cut" },
      { startMs: 45_000, endMs: 50_000, text: "kept after" },
    ]);
    const mapped = timeline.mapSegments(segments);
    expect(mapped.map((s) => s.text)).toEqual(["kept before", "kept after"]);
    expect(mapped[1].startMs).toBe(15_000);
  });

  it("drops cut chapters and shifts later ones", () => {
    const timeline = buildAgentEditedTimeline(edits, 60_000);
    expect(
      timeline.mapChapters([
        { startMs: 0, title: "a" },
        { startMs: 20_000, title: "b" },
        { startMs: 50_000, title: "c" },
      ]),
    ).toEqual([
      { startMs: 0, title: "a" },
      { startMs: 20_000, title: "c" },
    ]);
  });

  it("is the identity without cuts", () => {
    const timeline = buildAgentEditedTimeline("{}", 60_000);
    expect(timeline.durationMs).toBe(60_000);
    expect(timeline.toSourceMs(12_345)).toBe(12_345);
  });
});
