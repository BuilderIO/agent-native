import { describe, expect, it } from "vitest";

import { dropMicEchoFinals } from "./transcript-echo";
import type { FinalTranscriptEvent } from "./transcription-engine";

function wordsFor(
  text: string,
  startMs: number,
  wordMs = 300,
): { startMs: number; endMs: number; text: string }[] {
  return text.split(/\s+/).map((word, i) => ({
    startMs: startMs + i * wordMs,
    endMs: startMs + (i + 1) * wordMs,
    text: word,
  }));
}

function final(
  source: "mic" | "system",
  text: string,
  startMs: number,
): FinalTranscriptEvent {
  const words = wordsFor(text, startMs);
  return { text, source, segments: [], words };
}

describe("dropMicEchoFinals", () => {
  it("drops a mic utterance that re-hears the system audio a few seconds later", () => {
    const finals = [
      final(
        "system",
        "You can't really tell the pixels are different, nobody can really say what happened",
        100_000,
      ),
      // Speaker bleed: same content picked up by the mic ~2.5s later.
      final(
        "mic",
        "You can't really tell the pixels are different nobody can really say what happened",
        102_500,
      ),
    ];
    const kept = dropMicEchoFinals(finals);
    expect(kept.map((f) => f.source)).toEqual(["system"]);
  });

  it("keeps words the user actually speaks over the video", () => {
    const finals = [
      final("system", "head over to the models page and try it", 50_000),
      final(
        "mic",
        "okay pausing here because this part is the important bit for us",
        51_000,
      ),
    ];
    const kept = dropMicEchoFinals(finals);
    expect(kept).toHaveLength(2);
  });

  it("keeps mic echo candidates that are far outside the time window", () => {
    const finals = [
      final("system", "these exact words appear early on", 10_000),
      // Same words spoken by the USER much later (e.g. quoting the video).
      final("mic", "these exact words appear early on", 60_000),
    ];
    const kept = dropMicEchoFinals(finals);
    expect(kept).toHaveLength(2);
  });

  it("keeps short interjections unless they match perfectly", () => {
    const finals = [
      final("system", "now the model loads and we wait for it", 30_000),
      final("mic", "wow okay incredible", 31_000),
    ];
    const kept = dropMicEchoFinals(finals);
    expect(kept).toHaveLength(2);
  });

  it("is a no-op for mic-only recordings", () => {
    const finals = [
      final("mic", "just me narrating my screen like always", 1_000),
      final("mic", "nothing else is playing", 5_000),
    ];
    expect(dropMicEchoFinals(finals)).toHaveLength(2);
  });
});
