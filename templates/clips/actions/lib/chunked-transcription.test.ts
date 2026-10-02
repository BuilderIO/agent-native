import { describe, expect, it, vi } from "vitest";

import {
  ChunkTranscriptionError,
  joinChunkTranscripts,
  transcribeAudioChunks,
  type ProviderTranscriptResult,
} from "./chunked-transcription";

const minute = 60_000;

function chunksOf(count: number, durationMs = 8 * minute) {
  return Array.from({ length: count }, (_, index) => ({
    startMs: index * durationMs,
    durationMs,
  }));
}

function result(text: string, extra: Partial<ProviderTranscriptResult> = {}) {
  return { text, language: "en", segments: [], ...extra };
}

class TransientError extends Error {}

describe("transcribeAudioChunks", () => {
  it("returns results in chunk order while running at most `concurrency` at once", async () => {
    let active = 0;
    let peak = 0;
    const transcribe = vi.fn(async (_chunk: unknown, index: number) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5 * (5 - index)));
      active -= 1;
      return result(`part ${index}`);
    });

    const results = await transcribeAudioChunks({
      chunks: chunksOf(5),
      transcribe,
      isRetryable: () => false,
      concurrency: 2,
    });

    expect(results.map((r) => r.text)).toEqual([
      "part 0",
      "part 1",
      "part 2",
      "part 3",
      "part 4",
    ]);
    expect(peak).toBe(2);
    expect(transcribe).toHaveBeenCalledTimes(5);
  });

  it("retries a chunk once when its error is retryable", async () => {
    const transcribe = vi
      .fn()
      .mockRejectedValueOnce(new TransientError("timed out"))
      .mockResolvedValue(result("recovered"));

    const results = await transcribeAudioChunks({
      chunks: chunksOf(1),
      transcribe,
      isRetryable: (err) => err instanceof TransientError,
    });

    expect(results[0].text).toBe("recovered");
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable errors", async () => {
    const transcribe = vi
      .fn()
      .mockRejectedValue(new Error("credits exhausted"));

    await expect(
      transcribeAudioChunks({
        chunks: chunksOf(1),
        transcribe,
        isRetryable: () => false,
      }),
    ).rejects.toThrow("credits exhausted");
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("rethrows the provider error unchanged for single-part recordings", async () => {
    const providerError = new Error("413 Request Entity Too Large");

    await expect(
      transcribeAudioChunks({
        chunks: chunksOf(1),
        transcribe: vi.fn().mockRejectedValue(providerError),
        isRetryable: () => false,
      }),
    ).rejects.toBe(providerError);
  });

  it("fails the whole run with the failing part when any chunk still fails", async () => {
    const transcribe = vi.fn(async (_chunk: unknown, index: number) => {
      if (index === 1)
        throw new TransientError("Gemini returned malformed JSON");
      return result(`part ${index}`);
    });

    const error = await transcribeAudioChunks({
      chunks: chunksOf(4),
      transcribe,
      isRetryable: (err) => err instanceof TransientError,
      concurrency: 1,
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ChunkTranscriptionError);
    expect(error).toMatchObject({
      chunkIndex: 1,
      chunkCount: 4,
      message:
        "Transcribing part 2 of 4 failed: Gemini returned malformed JSON",
    });
    // Part 2 was attempted twice (retry), and no part after it was started.
    expect(transcribe.mock.calls.map(([, index]) => index)).toEqual([0, 1, 1]);
  });
});

describe("joinChunkTranscripts", () => {
  it("keeps a single-part transcript as the provider returned it", () => {
    const joined = joinChunkTranscripts(chunksOf(1, 90_000), [
      result("Hello there. General Kenobi.", {
        segments: [
          {
            startMs: 0,
            endMs: 1200,
            text: " Hello there. ",
            speakerLabel: "A",
          },
          {
            startMs: 1300,
            endMs: 2500,
            text: "General Kenobi.",
            speakerLabel: "B",
          },
        ],
      }),
    ]);

    expect(joined).toEqual({
      fullText: "Hello there. General Kenobi.",
      language: "en",
      segments: [
        { startMs: 0, endMs: 1200, text: "Hello there.", speaker: "A" },
        { startMs: 1300, endMs: 2500, text: "General Kenobi.", speaker: "B" },
      ],
    });
  });

  it("offsets each part onto the recording timeline", () => {
    const joined = joinChunkTranscripts(chunksOf(2), [
      result("First part.", {
        segments: [{ startMs: 1000, endMs: 2000, text: "First part." }],
      }),
      result("Second part.", {
        segments: [{ startMs: 500, endMs: 1500, text: "Second part." }],
      }),
    ]);

    expect(joined.segments).toEqual([
      { startMs: 1000, endMs: 2000, text: "First part." },
      {
        startMs: 8 * minute + 500,
        endMs: 8 * minute + 1500,
        text: "Second part.",
      },
    ]);
    expect(joined.fullText).toBe("First part.\n\nSecond part.");
  });

  it("clamps drifting timestamps to their own part", () => {
    const chunks = [
      { startMs: 0, durationMs: 8 * minute },
      { startMs: 8 * minute, durationMs: 2 * minute },
    ];
    const joined = joinChunkTranscripts(chunks, [
      result("a", {
        segments: [{ startMs: 7 * minute, endMs: 11 * minute, text: "a" }],
      }),
      result("b", {
        segments: [
          { startMs: -500, endMs: 1000, text: "b" },
          { startMs: 5 * minute, endMs: 6 * minute, text: "c" },
        ],
      }),
    ]);

    expect(joined.segments).toEqual([
      { startMs: 7 * minute, endMs: 8 * minute, text: "a" },
      { startMs: 8 * minute, endMs: 8 * minute + 1000, text: "b" },
      { startMs: 10 * minute, endMs: 10 * minute, text: "c" },
    ]);
    for (const segment of joined.segments) {
      expect(segment.endMs).toBeLessThanOrEqual(10 * minute);
    }
  });

  it("orders segments that the provider returned out of order", () => {
    const joined = joinChunkTranscripts(chunksOf(1), [
      result("two one", {
        segments: [
          { startMs: 3000, endMs: 4000, text: "two" },
          { startMs: 1000, endMs: 2000, text: "one" },
        ],
      }),
    ]);

    expect(joined.segments.map((segment) => segment.text)).toEqual([
      "one",
      "two",
    ]);
  });

  it("qualifies speaker labels per part instead of merging them", () => {
    const joined = joinChunkTranscripts(chunksOf(2), [
      result("x", {
        segments: [
          { startMs: 0, endMs: 1, text: "x", speakerLabel: "Speaker 1" },
        ],
      }),
      result("y", {
        segments: [
          { startMs: 0, endMs: 1, text: "y", speakerLabel: "Speaker 1" },
        ],
      }),
    ]);

    expect(joined.segments.map((segment) => segment.speaker)).toEqual([
      "Speaker 1 (part 1)",
      "Speaker 1 (part 2)",
    ]);
  });

  it("treats a silent part as empty and takes the language from the first spoken part", () => {
    const joined = joinChunkTranscripts(chunksOf(3), [
      result("No speech detected.", { language: "en" }),
      result("Hola a todos.", {
        language: "es",
        segments: [{ startMs: 0, endMs: 1000, text: "Hola a todos." }],
      }),
      result("", { language: "en" }),
    ]);

    expect(joined.fullText).toBe("Hola a todos.");
    expect(joined.language).toBe("es");
    expect(joined.segments).toHaveLength(1);
  });

  it("reports no speech when every part is silent", () => {
    const joined = joinChunkTranscripts(chunksOf(2), [result(""), result("")]);

    expect(joined).toEqual({ fullText: "", language: null, segments: [] });
  });
});
