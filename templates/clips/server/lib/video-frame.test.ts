import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import ffmpegPath from "ffmpeg-static";
import { describe, expect, it } from "vitest";

import { probeMediaDurationMs } from "./video-frame.js";

const execFileAsync = promisify(execFile);
const availableFfmpegPath =
  ffmpegPath && existsSync(ffmpegPath)
    ? ffmpegPath
    : (() => {
        try {
          execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
          return "ffmpeg";
        } catch {
          return null;
        }
      })();

describe("probeMediaDurationMs", () => {
  it("hands validation capacity through the queue without leaking it", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "clips-video-frame-handoff-test-"),
    );
    const slowFfmpegPath = join(root, "slow-ffmpeg.sh");
    const previousFfmpegPath = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = slowFfmpegPath;

    try {
      await writeFile(
        slowFfmpegPath,
        "#!/bin/sh\nsleep 0.05\nprintf '  Duration: 00:00:01.00, start: 0.000000, bitrate: 1 kb/s\\n' >&2\n",
      );
      await chmod(slowFfmpegPath, 0o755);

      const activeValidation = probeMediaDurationMs(
        new Uint8Array([1]),
        "video/mp4",
        { requireComplete: true },
      );
      const queuedValidation = probeMediaDurationMs(
        new Uint8Array([1]),
        "video/mp4",
        { requireComplete: true },
      );

      await expect(
        Promise.all([activeValidation, queuedValidation]),
      ).resolves.toEqual([1_000, 1_000]);
      await expect(
        probeMediaDurationMs(new Uint8Array([1]), "video/mp4", {
          requireComplete: true,
          maxQueueWaitMs: 1,
        }),
      ).resolves.toBe(1_000);
    } finally {
      if (previousFfmpegPath === undefined) {
        delete process.env.FFMPEG_PATH;
      } else {
        process.env.FFMPEG_PATH = previousFfmpegPath;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails a queued complete validation before the worker deadline", async () => {
    const root = await mkdtemp(join(tmpdir(), "clips-video-frame-queue-test-"));
    const slowFfmpegPath = join(root, "slow-ffmpeg.sh");
    const previousFfmpegPath = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = slowFfmpegPath;

    try {
      await writeFile(slowFfmpegPath, "#!/bin/sh\nsleep 0.1\nexit 1\n");
      await chmod(slowFfmpegPath, 0o755);

      const activeValidation = probeMediaDurationMs(
        new Uint8Array([1]),
        "video/mp4",
        { requireComplete: true },
      );
      const queuedValidation = probeMediaDurationMs(
        new Uint8Array([1]),
        "video/mp4",
        { requireComplete: true, maxQueueWaitMs: 1 },
      );

      await expect(queuedValidation).resolves.toBeNull();
      await expect(activeValidation).resolves.toBeNull();
    } finally {
      if (previousFfmpegPath === undefined) {
        delete process.env.FFMPEG_PATH;
      } else {
        process.env.FFMPEG_PATH = previousFfmpegPath;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!availableFfmpegPath)(
    "rejects a truncated faststart MP4 when complete validation is requested",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "clips-video-frame-test-"));
      const fullPath = join(root, "full.mp4");
      const coverImagePath = join(root, "cover.jpg");
      const coverArtPath = join(root, "audio-with-cover-art.mp4");
      const previousFfmpegPath = process.env.FFMPEG_PATH;
      process.env.FFMPEG_PATH = availableFfmpegPath!;

      try {
        await execFileAsync(availableFfmpegPath!, [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=red:s=32x32",
          "-frames:v",
          "1",
          coverImagePath,
        ]);
        await execFileAsync(availableFfmpegPath!, [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=black:s=160x90:r=30",
          "-f",
          "lavfi",
          "-i",
          "anullsrc=channel_layout=stereo:sample_rate=44100",
          "-t",
          "2",
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-movflags",
          "+faststart",
          fullPath,
        ]);
        await execFileAsync(availableFfmpegPath!, [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "anullsrc=channel_layout=stereo:sample_rate=44100",
          "-i",
          coverImagePath,
          "-t",
          "2",
          "-map",
          "0:a:0",
          "-map",
          "1:v:0",
          "-c:a",
          "aac",
          "-c:v",
          "mjpeg",
          "-disposition:v:0",
          "attached_pic",
          "-movflags",
          "+faststart",
          coverArtPath,
        ]);

        const fullBytes = new Uint8Array(await readFile(fullPath));
        const coverArtBytes = new Uint8Array(await readFile(coverArtPath));
        const truncatedBytes = fullBytes.slice(
          0,
          Math.floor(fullBytes.byteLength * 0.9),
        );

        await expect(
          probeMediaDurationMs(fullBytes, "video/mp4", {
            requireComplete: true,
          }),
        ).resolves.toBeGreaterThan(0);
        await expect(
          probeMediaDurationMs(truncatedBytes, "video/mp4", {
            requireComplete: true,
          }),
        ).resolves.toBeNull();
        await expect(
          probeMediaDurationMs(coverArtBytes, "video/mp4", {
            requireComplete: true,
          }),
        ).resolves.toBeNull();
      } finally {
        if (previousFfmpegPath === undefined) {
          delete process.env.FFMPEG_PATH;
        } else {
          process.env.FFMPEG_PATH = previousFfmpegPath;
        }
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
