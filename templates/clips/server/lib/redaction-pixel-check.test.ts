
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  mosaicBlockPx,
  redactionBurnFfmpegArgs,
  redactionEdgePx,
  redactionFilterGraph,
  redactionRectAt,
  type VideoRedaction,
} from "../../app/lib/video-redactions.js";
import {
  findGridPhase,
  measureArea,
  readCoveredArea,
  measureSmoothArea,
  CONTROL_MIN_GRADIENT,
} from "./redaction-pixel-check.js";
import { isFfmpegAvailable, resolveFfmpegCommand } from "./video-remux.js";

const hasFfmpeg = isFfmpegAvailable();

function rgb(
  width: number,
  height: number,
  pixel: (x: number, y: number) => number,
): Uint8Array {
  const bytes = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.max(0, Math.min(255, Math.round(pixel(x, y))));
      const i = (y * width + x) * 3;
      bytes[i] = v;
      bytes[i + 1] = v;
      bytes[i + 2] = v;
    }
  }
  return bytes;
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegCommand(), args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg ${code}: ${err.slice(-400)}`)),
    );
  });
}

describe("measuring a covered area", () => {
  it("calls a flat fill destroyed", () => {
    const detail = measureArea({
      bytes: rgb(200, 200, () => 11),
      width: 200,
      height: 200,
      blockPx: 40,
    });
    expect(detail.destroyed).toBe(true);
    expect(detail.spread).toBeLessThan(1);
  });

  it("calls a mosaic destroyed, and finds its grid", () => {
    const block = 40;
    const bytes = rgb(200, 200, (x, y) => {
      const bx = Math.floor((x + 7) / block);
      const by = Math.floor((y + 3) / block);
      return ((bx * 7 + by * 13) % 16) * 15;
    });
    const detail = measureArea({
      bytes,
      width: 200,
      height: 200,
      blockPx: block,
    });
    expect(detail.destroyed).toBe(true);
    expect(detail.flatBlocks).toBe(1);
    expect(detail.gridStrength).toBeGreaterThan(2);
  });

  it("calls readable detail what it is", () => {
    const bytes = rgb(200, 200, (x) => (x % 3 === 0 ? 240 : 10));
    const detail = measureArea({ bytes, width: 200, height: 200, blockPx: 40 });
    expect(detail.destroyed).toBe(false);
    expect(detail.spread).toBeGreaterThan(20);
  });

  it("is not fooled by a grid that starts mid-block", () => {
    const block = 32;
    const offset = 19;
    const bytes = rgb(256, 256, (x, y) => {
      const bx = Math.floor((x + offset) / block);
      const by = Math.floor((y + offset) / block);
      return (bx + by) % 2 === 0 ? 40 : 200;
    });
    const detail = measureArea({
      bytes,
      width: 256,
      height: 256,
      blockPx: block,
    });
    expect(detail.destroyed).toBe(true);
  });

  it("still tiles an area too small to drop its rim, rather than giving up", () => {
    const block = 43;
    const bytes = rgb(129, 86, (x, y) => {
      const bx = Math.floor(x / block);
      const by = Math.floor(y / block);
      return ((bx * 5 + by * 9) % 8) * 30;
    });
    const detail = measureArea({
      bytes,
      width: 129,
      height: 86,
      blockPx: block,
    });
    expect(detail.destroyed).toBe(true);
    expect(detail.flatBlocks).toBe(1);
  });

  it("picks the phase carrying the edges", () => {
    const profile = new Array(100).fill(1);
    for (let i = 5; i < 100; i += 10) profile[i] = 50;
    const { phase, strength } = findGridPhase(profile, 10);
    expect(phase).toBe(5);
    expect(strength).toBeGreaterThan(5);
  });
});

describe("reading an area out of a file", () => {
  it("refuses a frame size of zero rather than measuring the corner", async () => {
    await expect(
      readCoveredArea({
        inputPath: "/nonexistent.mp4",
        atMs: 0,
        rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        frameWidth: 0,
        frameHeight: 0,
      }),
    ).rejects.toThrow(/frame size/i);
  });
});

describe.skipIf(!hasFfmpeg)("burning for real", () => {
  const width = 640;
  const height = 480;

  async function burn(redaction: VideoRedaction, dir: string) {
    const input = join(dir, "in.mp4");
    const output = join(dir, "out.mp4");
    await ffmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=s=${width}x${height}:r=25:d=4,noise=alls=40:allf=t`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      input,
    ]);
    const graph = redactionFilterGraph([redaction], 4000, width, height);
    expect(graph.filterComplex).not.toBe("");
    await ffmpeg(
      redactionBurnFfmpegArgs({
        inputPath: input,
        outputPath: output,
        filterComplex: graph.filterComplex,
        outputLabel: graph.outputLabel,
      }),
    );
    return output;
  }

  it("leaves no edge behind, and says so only where there was one to lose", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clips-smooth-"));
    try {
      const rect = { x: 0.25, y: 0.25, w: 0.4, h: 0.3 };
      const redaction: VideoRedaction = {
        id: "s1",
        kind: "redact",
        style: "mosaic",
        startMs: 0,
        endMs: 2000,
        keys: [{ atMs: 0, ...rect }],
      };
      const output = await burn(redaction, dir);

      const covered = await readCoveredArea({
        inputPath: output,
        atMs: 1000,
        rect,
        frameWidth: width,
        frameHeight: height,
      });
      expect(
        measureSmoothArea({ ...covered, insetPx: redactionEdgePx(width) + 2 })
          .destroyed,
      ).toBe(true);

      const after = await readCoveredArea({
        inputPath: output,
        atMs: 3000,
        rect,
        frameWidth: width,
        frameHeight: height,
      });
      const control = measureSmoothArea({
        ...after,
        insetPx: redactionEdgePx(width) + 2,
      });
      expect(control.destroyed).toBe(false);
      expect(control.gradient).toBeGreaterThan(CONTROL_MIN_GRADIENT);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("fills a mosaic from nothing the frame contains", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clips-mosaic-"));
    try {
      const redaction: VideoRedaction = {
        id: "m1",
        kind: "redact",
        style: "mosaic",
        startMs: 0,
        endMs: 4000,
        keys: [{ atMs: 0, x: 0.25, y: 0.25, w: 0.4, h: 0.3 }],
      };
      const means: Array<[number, number, number]> = [];
      for (const [name, source] of [
        ["white", `color=c=white:s=${width}x${height}:r=25:d=4`],
        ["busy", `testsrc2=s=${width}x${height}:r=25:d=4,noise=alls=40:allf=t`],
      ] as const) {
        const input = join(dir, `${name}.mp4`);
        const output = join(dir, `${name}-out.mp4`);
        await ffmpeg([
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          source,
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "18",
          "-pix_fmt",
          "yuv420p",
          input,
        ]);
        const graph = redactionFilterGraph(
          [redaction],
          4000,
          width,
          height,
          42,
        );
        expect(graph.filterComplex).not.toBe("");
        await ffmpeg(
          redactionBurnFfmpegArgs({
            inputPath: input,
            outputPath: output,
            filterComplex: graph.filterComplex,
            outputLabel: graph.outputLabel,
          }),
        );
        const raw = join(dir, `${name}.rgb`);
        await ffmpeg([
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-ss",
          "1",
          "-i",
          output,
          "-frames:v",
          "1",
          "-vf",
          `crop=${Math.round(width * 0.3)}:${Math.round(height * 0.2)}:${Math.round(width * 0.28)}:${Math.round(height * 0.28)}`,
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          raw,
        ]);
        const bytes = await readFile(raw);
        const channel = (offset: number) => {
          let total = 0;
          let count = 0;
          for (let i = offset; i < bytes.length; i += 3) {
            total += bytes[i];
            count += 1;
          }
          return total / count;
        };
        means.push([channel(0), channel(1), channel(2)]);
      }

      const [overWhite, overBusy] = means;
      for (let channel = 0; channel < 3; channel += 1) {
        expect(Math.abs(overWhite[channel] - overBusy[channel])).toBeLessThan(
          8,
        );
      }
      expect(overBusy[0]).toBeGreaterThan(170);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("reads an area out of a still image, where there is no frame to seek to", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clips-still-"));
    try {
      const still = join(dir, "still.jpg");
      await ffmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=640x480:d=1",
        "-frames:v",
        "1",
        still,
      ]);
      const crop = await readCoveredArea({
        inputPath: still,
        atMs: 0,
        rect: { x: 0.25, y: 0.25, w: 0.4, h: 0.4 },
        frameWidth: 640,
        frameHeight: 480,
      });
      expect(crop.bytes.length).toBe(crop.width * crop.height * 3);
      expect(crop.bytes.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }, 60_000);

  it("destroys the area under a box that stays put, and leaves the rest alone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clips-burn-check-"));
    try {
      const redaction: VideoRedaction = {
        id: "r-static",
        kind: "redact",
        style: "mosaic",
        startMs: 500,
        endMs: 2500,
        keys: [{ atMs: 500, x: 0.3, y: 0.3, w: 0.3, h: 0.3 }],
      };
      const output = await burn(redaction, dir);
      const rect = redactionRectAt(redaction, 1500);
      const blockPx = mosaicBlockPx(width);

      const covered = await readCoveredArea({
        inputPath: output,
        atMs: 1500,
        rect,
        frameWidth: width,
        frameHeight: height,
      });
      expect(measureArea({ ...covered, blockPx }).destroyed).toBe(true);

      const after = await readCoveredArea({
        inputPath: output,
        atMs: 3200,
        rect,
        frameWidth: width,
        frameHeight: height,
      });
      const detail = measureArea({ ...after, blockPx });
      expect(detail.destroyed).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }, 180_000);

  it("destroys the whole path of a box that moves, not just where it started", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clips-burn-move-"));
    try {
      const redaction: VideoRedaction = {
        id: "r-moving",
        kind: "redact",
        style: "mosaic",
        startMs: 0,
        endMs: 4000,
        keys: [
          { atMs: 0, x: 0.05, y: 0.1, w: 0.25, h: 0.25 },
          { atMs: 2000, x: 0.4, y: 0.4, w: 0.25, h: 0.25 },
          { atMs: 4000, x: 0.7, y: 0.65, w: 0.25, h: 0.25 },
        ],
      };
      const output = await burn(redaction, dir);
      const blockPx = mosaicBlockPx(width);

      for (const atMs of [200, 1000, 2000, 3000, 3800]) {
        const rect = redactionRectAt(redaction, atMs);
        const covered = await readCoveredArea({
          inputPath: output,
          atMs,
          rect,
          frameWidth: width,
          frameHeight: height,
        });
        const detail = measureArea({ ...covered, blockPx });
        expect(
          detail.destroyed,
          `box at ${atMs}ms (x=${rect.x.toFixed(2)}, y=${rect.y.toFixed(2)}) ` +
            `spread ${detail.spread.toFixed(1)}, flat ${(detail.flatBlocks * 100).toFixed(0)}%`,
        ).toBe(true);
      }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }, 240_000);
});
