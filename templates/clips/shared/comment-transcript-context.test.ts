import { describe, expect, it } from "vitest";

import { transcriptContextAt } from "./comment-transcript-context";

const segments = [
  { startMs: 0, endMs: 3_000, text: "Welcome back." },
  { startMs: 3_000, endMs: 7_000, text: " Today we fix the importer. " },
  { startMs: 7_000, endMs: 11_000, text: "" },
  { startMs: 11_000, endMs: 15_000, text: "First, the parser." },
  { startMs: 30_000, endMs: 34_000, text: "Wrapping up." },
];

describe("transcriptContextAt", () => {
  it("joins the cues spoken around the moment, skipping empty ones", () => {
    expect(transcriptContextAt(segments, 10_000)).toEqual({
      startMs: 3_000,
      endMs: 15_000,
      text: "Today we fix the importer. First, the parser.",
    });
  });

  it("reaches further back than forward", () => {
    // The cue ending 5 s before the moment counts; one starting 5 s after doesn't.
    expect(transcriptContextAt(segments, 39_000)?.text).toBe("Wrapping up.");
    expect(transcriptContextAt(segments, 25_000)).toBeNull();
    expect(transcriptContextAt(segments, 26_000)?.text).toBe("Wrapping up.");
  });

  it("returns null when nothing was said near the moment", () => {
    expect(transcriptContextAt(segments, 22_000)).toBeNull();
    expect(transcriptContextAt([], 1_000)).toBeNull();
  });
});
