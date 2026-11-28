import { describe, expect, it, vi } from "vitest";

vi.mock("../db/index.js", () => ({ getDb: vi.fn(), schema: {} }));
vi.mock("@agent-native/core/application-state", () => ({
  appStateGet: vi.fn(),
  appStatePut: vi.fn(),
}));

import {
  attributeOwnerSpeech,
  classifySpan,
  isDraftTranscriptProvider,
  StereoLevelMeter,
  type StereoChannelLevels,
} from "./meeting-audio-channels";

const SILENT = -90;
const VOICE = -25;
const BLEED = -42;

/**
 * Builds levels from stretches of [ms, left dB, right dB], 100 ms windows.
 */
function levels(
  ...spans: Array<[number, number, number]>
): StereoChannelLevels {
  const left: number[] = [];
  const right: number[] = [];
  for (const [ms, l, r] of spans) {
    for (let i = 0; i < ms / 100; i += 1) {
      left.push(l);
      right.push(r);
    }
  }
  return { windowMs: 100, left, right };
}

describe("classifySpan", () => {
  // 0-2 s the owner talks, 2-4 s the call talks (bleeding into the mic),
  // 4-5 s silence, 5-6 s both at once.
  const meeting = levels(
    [2000, VOICE, SILENT],
    [2000, BLEED, VOICE],
    [1000, SILENT, SILENT],
    [1000, VOICE, VOICE],
  );

  it("reads the microphone channel as the owner", () => {
    expect(classifySpan(meeting, 0, 2000)).toBe("owner");
  });

  it("reads the call audio as someone else, even when it leaks into the mic", () => {
    expect(classifySpan(meeting, 2000, 4000)).toBe("other");
  });

  it("does not guess over silence or crosstalk", () => {
    expect(classifySpan(meeting, 4000, 5000)).toBe("unknown");
    expect(classifySpan(meeting, 1500, 2500)).toBe("unknown");
    expect(classifySpan(meeting, 5000, 6000)).toBe("other");
  });

  it("copes with a line past the end of the levels", () => {
    expect(classifySpan(meeting, 9000, 9500)).toBe("unknown");
    expect(classifySpan({ windowMs: 100, left: [], right: [] }, 0, 1000)).toBe(
      "unknown",
    );
  });
});

describe("attributeOwnerSpeech", () => {
  const meeting = levels(
    [2000, VOICE, SILENT],
    [2000, BLEED, VOICE],
    [2000, VOICE, SILENT],
    [2000, SILENT, VOICE],
  );

  it("names the owner's voice and marks where each line came from", () => {
    const segments = [
      { startMs: 0, endMs: 2000, text: "hi all", speaker: "A" },
      { startMs: 2000, endMs: 4000, text: "hello", speaker: "B" },
      { startMs: 4000, endMs: 6000, text: "so the plan", speaker: "A" },
      { startMs: 6000, endMs: 8000, text: "sounds good", speaker: "Murat" },
    ];

    expect(attributeOwnerSpeech(segments, meeting, "Nevil")).toEqual([
      {
        startMs: 0,
        endMs: 2000,
        text: "hi all",
        speaker: "Nevil",
        source: "mic",
      },
      {
        startMs: 2000,
        endMs: 4000,
        text: "hello",
        speaker: "B",
        source: "system",
      },
      {
        startMs: 4000,
        endMs: 6000,
        text: "so the plan",
        speaker: "Nevil",
        source: "mic",
      },
      {
        startMs: 6000,
        endMs: 8000,
        text: "sounds good",
        speaker: "Murat",
        source: "system",
      },
    ]);
  });

  it("names every line of the owner's voice, including unclear ones", () => {
    const crosstalk = levels([4000, VOICE, SILENT], [1000, VOICE, VOICE]);
    const segments = [
      { startMs: 0, endMs: 4000, text: "long point", speaker: "A" },
      { startMs: 4000, endMs: 5000, text: "over you", speaker: "A" },
    ];

    expect(
      attributeOwnerSpeech(segments, crosstalk, "Nevil").map((s) => s.speaker),
    ).toEqual(["Nevil", "Nevil"]);
  });

  it("takes the owner out of a voice the model merged with someone else", () => {
    const segments = [
      { startMs: 0, endMs: 2000, text: "hi all", speaker: "A" },
      { startMs: 2000, endMs: 4000, text: "hello", speaker: "A" },
      { startMs: 6000, endMs: 8000, text: "sounds good", speaker: "A" },
    ];

    expect(
      attributeOwnerSpeech(segments, meeting, "Nevil").map((s) => s.speaker),
    ).toEqual(["Nevil", "A", "A"]);
  });

  it("handles lines without a speaker label", () => {
    const segments = [
      { startMs: 0, endMs: 2000, text: "hi" },
      { startMs: 2000, endMs: 4000, text: "hello" },
    ];

    expect(attributeOwnerSpeech(segments, meeting, "Nevil")).toEqual([
      { startMs: 0, endMs: 2000, text: "hi", speaker: "Nevil", source: "mic" },
      { startMs: 2000, endMs: 4000, text: "hello", source: "system" },
    ]);
  });
});

describe("StereoLevelMeter", () => {
  function stereoPcm(frames: number, left: number, right: number): Buffer {
    const buffer = Buffer.alloc(frames * 4);
    for (let i = 0; i < frames; i += 1) {
      buffer.writeInt16LE(i % 2 ? left : -left, i * 4);
      buffer.writeInt16LE(i % 2 ? right : -right, i * 4 + 2);
    }
    return buffer;
  }

  it("measures each channel per window across uneven pieces", () => {
    const meter = new StereoLevelMeter(8_000, 100);
    const pcm = Buffer.concat([
      stereoPcm(800, 16384, 0),
      stereoPcm(800, 0, 3277),
    ]);
    // Odd-sized pieces split frames across pushes.
    for (let offset = 0; offset < pcm.length; offset += 1003) {
      meter.push(pcm.subarray(offset, offset + 1003));
    }
    const result = meter.finish();

    expect(result.windowMs).toBe(100);
    expect(result.left).toHaveLength(2);
    expect(result.left[0]).toBeCloseTo(-6, 0);
    expect(result.right[0]).toBe(-120);
    expect(result.left[1]).toBe(-120);
    expect(result.right[1]).toBeCloseTo(-20, 0);
  });
});

describe("isDraftTranscriptProvider", () => {
  it("treats the live transcript and old rows as drafts", () => {
    expect(isDraftTranscriptProvider("native")).toBe(true);
    expect(isDraftTranscriptProvider(null)).toBe(true);
    expect(isDraftTranscriptProvider(" ")).toBe(true);
    expect(isDraftTranscriptProvider("elevenlabs")).toBe(false);
    expect(isDraftTranscriptProvider("gpt-4o-transcribe-diarize")).toBe(false);
  });
});
