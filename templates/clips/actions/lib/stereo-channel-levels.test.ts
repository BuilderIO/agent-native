import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  extractAudioOnlyWithFfmpeg,
  type AudioOnlyTranscriptionMedia,
} from "./audio-only-transcription";
import {
  extractStereoChannelLevels,
  withStereoChannelLevels,
} from "./stereo-channel-levels";

/** Two seconds of stereo: a tone on the left, then a tone on the right. */
function stereoWav(): Buffer {
  const sampleRate = 16_000;
  const frames = sampleRate * 2;
  const dataBytes = frames * 4;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    const tone = Math.round(
      Math.sin((2 * Math.PI * 440 * frame) / sampleRate) * 12_000,
    );
    const firstHalf = frame < frames / 2;
    buffer.writeInt16LE(firstHalf ? tone : 0, 44 + frame * 4);
    buffer.writeInt16LE(firstHalf ? 0 : tone, 44 + frame * 4 + 2);
  }
  return buffer;
}

describe("stereo channel levels", () => {
  let dir: string;
  let path: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "clips-stereo-levels-"));
    path = join(dir, "meeting.wav");
    await writeFile(path, stereoWav());
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("measures the microphone and the call audio separately", async () => {
    const levels = await extractStereoChannelLevels(
      { kind: "file", path },
      30_000,
    );

    expect(levels.windowMs).toBe(100);
    expect(levels.left.length).toBeGreaterThanOrEqual(19);
    // First second: the left channel speaks, the right is silent.
    expect(levels.left[5]).toBeGreaterThan(-20);
    expect(levels.right[5]).toBeLessThan(-60);
    // Second second: the other way round.
    expect(levels.left[15]).toBeLessThan(-60);
    expect(levels.right[15]).toBeGreaterThan(-20);
  });

  it("adds the levels to the transcription media of a meeting file", async () => {
    const media = await withStereoChannelLevels(extractAudioOnlyWithFfmpeg)({
      source: { kind: "file", path },
      timeoutMs: 30_000,
    });

    expect(media.chunks.length).toBeGreaterThan(0);
    expect(media.channelLevels?.left.length).toBeGreaterThanOrEqual(19);
  });

  it("still returns the media when the levels cannot be read", async () => {
    const media: AudioOnlyTranscriptionMedia = {
      mimeType: "audio/mp4",
      maxVolumeDb: -10,
      chunks: [],
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await withStereoChannelLevels(
      async () => media,
      async () => {
        throw new Error("ffmpeg exploded");
      },
    )({ source: { kind: "file", path }, timeoutMs: 1_000 });

    expect(result).toEqual({ ...media, channelLevels: null });
    warn.mockRestore();
  });
});
