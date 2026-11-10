import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AUDIO_LEVEL_MAX_GAIN_DB,
  boostQuietAudio,
  buildBoostArgs,
  measureLoudness,
  parseEbur128Summary,
  parseFfmpegInputInfo,
  planAudioBoost,
} from "./audio-level.js";
import { resolveFfmpegCommand } from "./video-remux.js";

const SUMMARY = `
[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:         -42.2 LUFS
    Threshold: -52.4 LUFS

  Loudness range:
    LRA:         6.0 LU

  Sample peak:
    Peak:      -25.3 dBFS
`;

describe("parseEbur128Summary", () => {
  it("reads integrated loudness and sample peak", () => {
    expect(parseEbur128Summary(SUMMARY)).toEqual({
      integratedLufs: -42.2,
      samplePeakDbfs: -25.3,
    });
  });

  it("ignores per-frame lines before the summary", () => {
    const stderr = `t: 1.0 M: -30.0 S: -30.0 I: -10.0 LUFS LRA: 0.0 LU\n${SUMMARY}`;
    expect(parseEbur128Summary(stderr).integratedLufs).toBe(-42.2);
  });

  it("returns null for -inf peaks and a missing summary", () => {
    expect(
      parseEbur128Summary("Summary:\n I: -70.0 LUFS\n Peak: -inf dBFS"),
    ).toEqual({ integratedLufs: -70, samplePeakDbfs: null });
    expect(parseEbur128Summary("no summary")).toEqual({
      integratedLufs: null,
      samplePeakDbfs: null,
    });
  });
});

describe("parseFfmpegInputInfo", () => {
  it("reads duration and audio presence", () => {
    const stderr = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x.mp4':
  Duration: 00:03:35.18, start: 0.000000, bitrate: 2439 kb/s
  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 1920x1064
  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, stereo, fltp`;
    expect(parseFfmpegInputInfo(stderr)).toEqual({
      durationMs: 215_180,
      hasAudio: true,
      audioStreams: 1,
    });
  });

  it("reports a missing audio stream and an unknown duration", () => {
    expect(
      parseFfmpegInputInfo(
        "Duration: N/A\n  Stream #0:0: Video: h264, yuv420p",
      ),
    ).toEqual({ durationMs: null, hasAudio: false, audioStreams: 0 });
  });
});

describe("parseFfmpegInputInfo stream count", () => {
  it("counts every audio stream", () => {
    const stderr = `  Duration: 00:00:04.00, start: 0.000000
  Stream #0:0: Video: h264
  Stream #0:1: Audio: aac, 48000 Hz, stereo
  Stream #0:2: Audio: aac, 48000 Hz, mono`;
    expect(parseFfmpegInputInfo(stderr).audioStreams).toBe(2);
  });
});

describe("planAudioBoost", () => {
  it("boosts a quiet clip toward -16 LUFS", () => {
    expect(
      planAudioBoost({ integratedLufs: -42.2, samplePeakDbfs: -25.3 }),
    ).toEqual({ action: "boost", gainDb: 26.2 });
  });

  it("caps the boost", () => {
    expect(
      planAudioBoost({ integratedLufs: -65, samplePeakDbfs: -40 }),
    ).toEqual({ action: "boost", gainDb: AUDIO_LEVEL_MAX_GAIN_DB });
  });

  it("keeps normal, silent and unmeasured clips", () => {
    expect(planAudioBoost({ integratedLufs: -18, samplePeakDbfs: -2 })).toEqual(
      { action: "keep", reason: "already-normal" },
    );
    expect(
      planAudioBoost({ integratedLufs: -70, samplePeakDbfs: null }),
    ).toEqual({ action: "keep", reason: "silent" });
    expect(
      planAudioBoost({ integratedLufs: null, samplePeakDbfs: null }),
    ).toEqual({ action: "keep", reason: "unmeasured" });
  });
});

describe("buildBoostArgs", () => {
  it("copies video and re-encodes only the audio with a limiter", () => {
    const args = buildBoostArgs({
      inputPath: "in.mp4",
      outputPath: "out.mp4",
      gainDb: 26.2,
      format: "mp4",
    });
    expect(args).toContain("copy");
    expect(args.join(" ")).toContain(
      "volume=26.2dB,alimiter=limit=0.891:level=0",
    );
    expect(args).toContain("+faststart");
    expect(args.slice(-1)).toEqual(["out.mp4"]);
  });

  it("uses opus for webm", () => {
    const args = buildBoostArgs({
      inputPath: "in.webm",
      outputPath: "out.webm",
      gainDb: 10,
      format: "webm",
    });
    expect(args).toContain("libopus");
    expect(args).not.toContain("+faststart");
  });
});

const hasFfmpeg =
  spawnSync(resolveFfmpegCommand(), ["-version"], { stdio: "ignore" })
    .status === 0;

// oracle-change: needs a real ffmpeg binary; hosts without one skip the end-to-end check.
describe.skipIf(!hasFfmpeg)("boostQuietAudio (ffmpeg)", () => {
  let dir = "";
  let quietClip = new Uint8Array();

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "audio-level-test-"));
    const path = join(dir, "quiet.mp4");
    // A 4 s clip: black video plus a modulated tone about 28 dB under the target (near -45 LUFS).
    const result = spawnSync(resolveFfmpegCommand(), [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=320x240:r=30:d=4",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=220:duration=4:sample_rate=48000",
      "-af",
      "volume=-20dB,tremolo=f=3:d=0.6",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      path,
    ]);
    expect(result.status).toBe(0);
    quietClip = new Uint8Array(await readFile(path));
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("raises a quiet clip close to the target and keeps a normal one", async () => {
    const boosted = await boostQuietAudio({
      mediaBytes: quietClip,
      format: "mp4",
    });
    expect(boosted.changed).toBe(true);
    if (!boosted.changed) return;
    expect(boosted.measurement.integratedLufs ?? 0).toBeLessThan(-30);

    const { writeFile } = await import("node:fs/promises");
    const outPath = join(dir, "boosted.mp4");
    await writeFile(outPath, boosted.bytes);
    const after = await measureLoudness(outPath);
    expect(after.integratedLufs ?? -99).toBeGreaterThan(-19);
    expect(after.integratedLufs ?? 0).toBeLessThan(-13);
    expect(after.samplePeakDbfs ?? 0).toBeLessThanOrEqual(-0.9);

    const again = await boostQuietAudio({
      mediaBytes: boosted.bytes,
      format: "mp4",
    });
    expect(again).toMatchObject({ changed: false, reason: "already-normal" });
  }, 60_000);
});
