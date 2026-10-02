import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  AudioOnlyExtractionError,
  audioExtractionTimeoutMs,
  assertAudioHasAudibleSignal,
  extractAudioOnlyWithFfmpeg,
  isNoExtractableAudioError,
} from "./audio-only-transcription";

const ffmpegPath: string = createRequire(import.meta.url)("ffmpeg-static");

function wav({
  durationSeconds = 0.25,
  sampleRate = 16000,
  channels = 1,
  frequency = 0,
}: {
  durationSeconds?: number;
  sampleRate?: number;
  channels?: number;
  frequency?: number;
} = {}): Uint8Array {
  const frames = Math.floor(sampleRate * durationSeconds);
  const dataBytes = frames * channels * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let frame = 0; frame < frames; frame++) {
    const sample = frequency
      ? Math.round(
          Math.sin((2 * Math.PI * frequency * frame) / sampleRate) * 12000,
        )
      : 0;
    for (let channel = 0; channel < channels; channel++) {
      buffer.writeInt16LE(sample, 44 + (frame * channels + channel) * 2);
    }
  }
  return new Uint8Array(buffer);
}

function describeAudioStream(bytes: Uint8Array, dir: string): string {
  const path = join(dir, "probe.m4a");
  writeFileSync(path, bytes);
  const result = spawnSync(ffmpegPath, ["-hide_banner", "-i", path], {
    encoding: "utf8",
  });
  return result.stderr.match(/Audio: .*/)?.[0] ?? "";
}

describe("audio-only transcription media", () => {
  let dir: string;
  let server: Server;
  let serverUrl: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "clips-audio-test-"));
    const tone = wav({
      durationSeconds: 1,
      sampleRate: 44100,
      channels: 2,
      frequency: 440,
    });
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "audio/wav" });
      res.end(Buffer.from(tone));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/tone.wav`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("always re-encodes to mono 16 kHz AAC, even from stereo 44.1 kHz input", async () => {
    const input = join(dir, "stereo.wav");
    await writeFile(
      input,
      wav({
        durationSeconds: 1,
        sampleRate: 44100,
        channels: 2,
        frequency: 440,
      }),
    );

    const output = await extractAudioOnlyWithFfmpeg({
      source: { kind: "file", path: input },
      timeoutMs: 30_000,
    });

    expect(output.mimeType).toBe("audio/mp4");
    const stream = describeAudioStream(output.chunks[0]!.audioBytes, dir);
    expect(stream).toMatch(/aac/);
    expect(stream).toMatch(/16000 Hz/);
    expect(stream).toMatch(/mono/);
  });

  it("streams audio from an http URL without a local copy of the source", async () => {
    const output = await extractAudioOnlyWithFfmpeg({
      source: { kind: "url", url: serverUrl },
      timeoutMs: 30_000,
    });

    expect(describeAudioStream(output.chunks[0]!.audioBytes, dir)).toMatch(
      /16000 Hz.*mono/,
    );
  });

  it("refuses non-network protocols for URL sources", async () => {
    await expect(
      extractAudioOnlyWithFfmpeg({
        source: { kind: "url", url: `file://${join(dir, "stereo.wav")}` },
        timeoutMs: 30_000,
      }),
    ).rejects.toMatchObject({ code: "EXTRACTION_FAILED" });
  });

  it("reports a video without an audio stream as NO_AUDIO_TRACK", async () => {
    const input = join(dir, "video-only.mp4");
    const made = spawnSync(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=16x16:d=1",
      input,
    ]);
    expect(made.status).toBe(0);

    await expect(
      extractAudioOnlyWithFfmpeg({
        source: { kind: "file", path: input },
        timeoutMs: 30_000,
      }),
    ).rejects.toMatchObject({ code: "NO_AUDIO_TRACK" });
  });

  it("treats recordings known to have no saved audio as terminal failures", () => {
    expect(
      isNoExtractableAudioError(
        new AudioOnlyExtractionError(
          "NO_AUDIO_SAVED",
          "This recording has no audio track, so there was nothing to transcribe.",
        ),
      ),
    ).toBe(true);
  });

  it("rejects silent audio before cloud transcription", async () => {
    const input = join(dir, "silent.wav");
    await writeFile(input, wav());
    const media = await extractAudioOnlyWithFfmpeg({
      source: { kind: "file", path: input },
      timeoutMs: 30_000,
    });

    expect(() => assertAudioHasAudibleSignal(media)).toThrow(
      expect.objectContaining({
        code: "NO_SPEECH_DETECTED",
        message:
          "No speech was detected because the recording audio is silent.",
      }),
    );
  });

  it("accepts audible audio", async () => {
    const input = join(dir, "tone.wav");
    await writeFile(input, wav({ durationSeconds: 1, frequency: 440 }));
    const media = await extractAudioOnlyWithFfmpeg({
      source: { kind: "file", path: input },
      timeoutMs: 30_000,
    });

    expect(() => assertAudioHasAudibleSignal(media)).not.toThrow();
  });

  it("scales ffmpeg extraction timeout with media size", () => {
    expect(audioExtractionTimeoutMs(1)).toBe(35_000);
    expect(audioExtractionTimeoutMs(200 * 1024 * 1024)).toBe(65_000);

    vi.stubEnv("CLIPS_AUDIO_EXTRACTION_TIMEOUT_MS", "120000");
    expect(audioExtractionTimeoutMs(1)).toBe(90_000);
  });
});
