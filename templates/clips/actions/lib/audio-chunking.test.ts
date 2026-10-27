import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  TRANSCRIPTION_CHUNK_SECONDS,
  extractAudioOnlyWithFfmpeg,
} from "./audio-only-transcription";

const ffmpegPath: string = createRequire(import.meta.url)("ffmpeg-static");

function makeTone(path: string, seconds: number) {
  const made = spawnSync(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:sample_rate=16000:duration=${seconds}`,
    path,
  ]);
  expect(made.status).toBe(0);
}

describe("transcription audio chunking", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "clips-chunking-test-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns a short recording as a single chunk", async () => {
    const input = join(dir, "short.wav");
    makeTone(input, 2);

    const { chunks } = await extractAudioOnlyWithFfmpeg({
      source: { kind: "file", path: input },
      timeoutMs: 30_000,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].startMs).toBe(0);
    expect(chunks[0].durationMs).toBeGreaterThan(1900);
    expect(chunks[0].durationMs).toBeLessThan(2200);
  });

  it("splits long audio into contiguous chunks covering the whole recording", async () => {
    const input = join(dir, "long.wav");
    const totalSeconds = 2 * TRANSCRIPTION_CHUNK_SECONDS + 60;
    makeTone(input, totalSeconds);

    const { chunks } = await extractAudioOnlyWithFfmpeg({
      source: { kind: "file", path: input },
      timeoutMs: 60_000,
    });

    expect(chunks).toHaveLength(3);
    const chunkMs = TRANSCRIPTION_CHUNK_SECONDS * 1000;
    chunks.forEach((chunk, index) => {
      expect(Math.abs(chunk.startMs - index * chunkMs)).toBeLessThan(200);
      expect(chunk.audioBytes.byteLength).toBeGreaterThan(0);
      if (index > 0) {
        const previous = chunks[index - 1];
        expect(chunk.startMs).toBe(previous.startMs + previous.durationMs);
      }
    });
    const last = chunks[chunks.length - 1];
    expect(
      Math.abs(last.startMs + last.durationMs - totalSeconds * 1000),
    ).toBeLessThan(200);
  }, 60_000);
});
