import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import ffmpegPath from "ffmpeg-static";
import { describe, expect, it } from "vitest";

import { planFrameSheet } from "./video-frame-sheet.js";
import {
  extractJpegFrameFromFile,
  extractJpegFrameSheetFromFile,
  probeFrameSheetFpsFromFile,
  probeMediaDurationMs,
} from "./video-frame.js";

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

describe("extractJpegFrameFromFile", () => {
  it("classifies empty media separately from a missing timestamp frame", async () => {
    const root = await mkdtemp(join(tmpdir(), "clips-empty-frame-test-"));
    const emptyPath = join(root, "empty.mp4");
    await writeFile(emptyPath, new Uint8Array());

    try {
      await expect(
        extractJpegFrameFromFile({ mediaPath: emptyPath, atMs: 1000 }),
      ).rejects.toMatchObject({
        name: "VideoFrameExtractionError",
        code: "EMPTY_MEDIA",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!availableFfmpegPath)(
    "classifies audio-only media separately from a missing timestamp frame",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "clips-audio-frame-test-"));
      const audioPath = join(root, "audio-only.mp4");
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
          "anullsrc=channel_layout=stereo:sample_rate=44100",
          "-t",
          "1",
          "-c:a",
          "aac",
          audioPath,
        ]);

        await expect(
          extractJpegFrameFromFile({ mediaPath: audioPath, atMs: 500 }),
        ).rejects.toMatchObject({
          name: "VideoFrameExtractionError",
          code: "NO_VIDEO_TRACK",
        });
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

  it.skipIf(!availableFfmpegPath)(
    "returns the frame that starts within the millisecond before atMs",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "clips-frame-start-test-"));
      const videoPath = join(root, "video.mp4");
      const framePath = join(root, "frame.jpg");
      const previousFfmpegPath = process.env.FFMPEG_PATH;
      process.env.FFMPEG_PATH = availableFfmpegPath!;

      // Frame n is one of three grays (n mod 3), so a neighbouring frame
      // reads differently. At 30 fps most frames start between milliseconds.
      const shadeAt = async (atMs: number) => {
        await writeFile(
          framePath,
          await extractJpegFrameFromFile({ mediaPath: videoPath, atMs }),
        );
        const { stdout } = await execFileAsync(
          availableFfmpegPath!,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            framePath,
            "-vf",
            "scale=1:1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "gray",
            "-",
          ],
          { encoding: "buffer" },
        );
        const level = stdout[0];
        return level < 75 ? 0 : level < 168 ? 1 : 2;
      };

      try {
        await execFileAsync(availableFfmpegPath!, [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=black:s=32x32:r=30:d=1.2,geq=lum='40+mod(N,3)*80':cb=128:cr=128",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          videoPath,
        ]);

        // Frame starts rounded up to whole milliseconds, as comments store them.
        for (const frame of [1, 2, 30, 31]) {
          const atMs = Math.ceil((frame * 1000) / 30);
          expect({ atMs, shade: await shadeAt(atMs) }).toEqual({
            atMs,
            shade: frame % 3,
          });
        }
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

  it.skipIf(!availableFfmpegPath)(
    "classifies a missing timestamp separately from recordings without video",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "clips-timestamp-frame-test-"));
      const videoPath = join(root, "video.mp4");
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
          "color=c=red:s=32x32:r=1",
          "-t",
          "1",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          videoPath,
        ]);

        await expect(
          extractJpegFrameFromFile({ mediaPath: videoPath, atMs: 10_000 }),
        ).rejects.toMatchObject({
          name: "VideoFrameExtractionError",
          code: "NO_FRAME_AT_TIMESTAMP",
        });
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

describe("extractJpegFrameSheetFromFile", () => {
  // Frame n of each test video is a flat gray with luma 20 + 4n, so a cell's
  // brightness names the frame it shows. JPEG stores full-range luma, which
  // maps back to the video's 16-235 range.
  const frameIndexOf = (level: number) =>
    Math.round(((level * 219) / 255 + 16 - 20) / 4);

  async function grayLevels(
    imagePath: string,
    width: number,
    points: Array<[number, number]>,
  ) {
    const { stdout } = await execFileAsync(
      availableFfmpegPath!,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        imagePath,
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        "-",
      ],
      { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
    );
    return points.map(([x, y]) => stdout[y * width + x]);
  }

  async function withNumberedVideo(
    run: (paths: { root: string; videoPath: string }) => Promise<void>,
    { dropFrames }: { dropFrames?: [number, number] } = {},
  ) {
    const root = await mkdtemp(join(tmpdir(), "clips-frame-sheet-test-"));
    const videoPath = join(root, "video.mp4");
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
        "color=c=black:s=64x48:r=30:d=1.5,geq=lum='20+4*N':cb=128:cr=128",
        // A screen recording drops frames while nothing moves.
        ...(dropFrames
          ? [
              "-vf",
              `select='not(between(n,${dropFrames[0]},${dropFrames[1]}))'`,
              "-fps_mode",
              "vfr",
            ]
          : []),
        "-c:v",
        "libx264",
        "-qp",
        "0",
        "-g",
        "15",
        "-pix_fmt",
        "yuv420p",
        videoPath,
      ]);
      await run({ root, videoPath });
    } finally {
      if (previousFfmpegPath === undefined) {
        delete process.env.FFMPEG_PATH;
      } else {
        process.env.FFMPEG_PATH = previousFfmpegPath;
      }
      await rm(root, { recursive: true, force: true });
    }
  }

  async function sheetFrames(
    root: string,
    videoPath: string,
    request: { startMs: number; endMs: number; fps: number },
  ) {
    const result = planFrameSheet({
      request,
      fps: request.fps,
      width: 64,
      height: 48,
    });
    if (!result.ok) throw new Error(result.error);
    const plan = result.value;
    const sheetPath = join(root, "sheet.jpg");
    await writeFile(
      sheetPath,
      await extractJpegFrameSheetFromFile({ mediaPath: videoPath, plan }),
    );
    const centers = plan.frameTimesMs.map((_, index): [number, number] => [
      (index % plan.columns) * plan.cellWidth + plan.cellWidth / 2,
      Math.floor(index / plan.columns) * plan.cellHeight + plan.cellHeight / 2,
    ]);
    const levels = await grayLevels(
      sheetPath,
      plan.columns * plan.cellWidth,
      centers,
    );
    return { plan, frames: levels.map(frameIndexOf), levels };
  }

  it.skipIf(!availableFfmpegPath)(
    "shows every frame once at the video's own rate, matching single frames",
    async () => {
      await withNumberedVideo(async ({ root, videoPath }) => {
        await expect(probeFrameSheetFpsFromFile(videoPath)).resolves.toBe(30);
        const { plan, frames } = await sheetFrames(root, videoPath, {
          startMs: 500,
          endMs: 800,
          fps: 30,
        });
        expect(frames).toEqual([15, 16, 17, 18, 19, 20, 21, 22, 23]);

        const framePath = join(root, "frame.jpg");
        const singles: number[] = [];
        for (const atMs of plan.frameTimesMs) {
          await writeFile(
            framePath,
            await extractJpegFrameFromFile({ mediaPath: videoPath, atMs }),
          );
          const [level] = await grayLevels(framePath, 64, [[32, 24]]);
          singles.push(frameIndexOf(level));
        }
        expect(frames).toEqual(singles);
      });
    },
  );

  it.skipIf(!availableFfmpegPath)(
    "samples a slower rate from the frames on screen",
    async () => {
      await withNumberedVideo(async ({ root, videoPath }) => {
        const { frames } = await sheetFrames(root, videoPath, {
          startMs: 0,
          endMs: 600,
          fps: 10,
        });
        expect(frames).toEqual([0, 3, 6, 9, 12, 15]);
      });
    },
  );

  it.skipIf(!availableFfmpegPath)(
    "keeps the frame on screen through a stretch with no new frames",
    async () => {
      await withNumberedVideo(
        async ({ root, videoPath }) => {
          const { frames } = await sheetFrames(root, videoPath, {
            startMs: 600,
            endMs: 1300,
            fps: 10,
          });
          expect(frames).toEqual([18, 19, 19, 19, 19, 19, 36]);
        },
        { dropFrames: [20, 35] },
      );
    },
  );

  it.skipIf(!availableFfmpegPath)(
    "leaves cells past the end of the video black",
    async () => {
      await withNumberedVideo(async ({ root, videoPath }) => {
        const { frames, levels } = await sheetFrames(root, videoPath, {
          startMs: 1400,
          endMs: 1600,
          fps: 30,
        });
        expect(frames.slice(0, 3)).toEqual([42, 43, 44]);
        expect(levels.slice(3).every((level) => level < 5)).toBe(true);
      });
    },
  );
});
