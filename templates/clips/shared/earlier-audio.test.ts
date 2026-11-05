import { describe, expect, it } from "vitest";

import {
  earlierAudioMinutes,
  speakerLabeledText,
  withoutEarlierAudio,
} from "./earlier-audio";

describe("earlierAudioMinutes", () => {
  it("is zero without earlier audio", () => {
    expect(earlierAudioMinutes([])).toBe(0);
    expect(earlierAudioMinutes([{ startMs: 0, endMs: 600_000 }])).toBe(0);
  });

  it("measures only the recovered span, not the audio after it", () => {
    expect(
      earlierAudioMinutes([
        { startMs: 120_000, endMs: 180_000, recovered: true },
        { startMs: 300_000, endMs: 420_000, recovered: true },
        { startMs: 420_000, endMs: 3_600_000 },
      ]),
    ).toBe(5);
  });

  it("never reports a few seconds of audio as zero minutes", () => {
    expect(
      earlierAudioMinutes([{ startMs: 0, endMs: 4_000, recovered: true }]),
    ).toBe(1);
  });
});

describe("withoutEarlierAudio", () => {
  it("keeps every other segment as written", () => {
    const live = { startMs: 5, endMs: 6, text: "live", extra: "kept" };
    expect(
      withoutEarlierAudio([
        { startMs: 0, endMs: 1, text: "earlier", recovered: true },
        live,
      ]),
    ).toEqual([live]);
  });
});

describe("speakerLabeledText", () => {
  it("writes the same speaker turns live capture saves", () => {
    expect(
      speakerLabeledText([
        { text: "hi", source: "mic" },
        { text: "there", source: "mic" },
        { text: "hello", source: "system" },
        { text: "   ", source: "system" },
        { text: "bye" },
      ]),
    ).toBe("Me: hi there\n\nThem: hello\n\nMe: bye");
  });

  it("is empty when nothing remains", () => {
    expect(speakerLabeledText([])).toBe("");
  });
});
