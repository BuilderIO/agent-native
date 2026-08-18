import { describe, expect, it } from "vitest";

import {
  normalizeTranscriptSegments,
  parseTranscriptSegments,
} from "./transcript-segments";

describe("transcript segment attribution", () => {
  it("preserves speaker metadata while parsing stored segments", () => {
    expect(
      parseTranscriptSegments(
        JSON.stringify([
          {
            startMs: 0,
            endMs: 1000,
            text: "Hello",
            source: "system",
            speaker: "Jason",
          },
        ]),
      ),
    ).toEqual([
      {
        startMs: 0,
        endMs: 1000,
        text: "Hello",
        source: "system",
        speaker: "Jason",
      },
    ]);
  });

  it("keeps source and speaker labels when long segments are rechunked", () => {
    expect(
      normalizeTranscriptSegments({
        segments: [
          {
            startMs: 0,
            endMs: 5000,
            text: "One two three four five six seven eight",
            source: "system",
            speaker: "Jason",
          },
        ],
      }),
    ).toEqual([
      {
        startMs: 0,
        endMs: 4375,
        text: "One two three four five six seven",
        source: "system",
        speaker: "Jason",
      },
      {
        startMs: 4375,
        endMs: 5000,
        text: "eight",
        source: "system",
        speaker: "Jason",
      },
    ]);
  });
});
