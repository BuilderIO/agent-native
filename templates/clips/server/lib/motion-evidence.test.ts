import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildMotionSelectFilter,
  decodeFailureIn,
  extractMotionEvidenceFrames,
  parseShowinfoFrameTimestamps,
  parseShowinfoPresentationTimes,
  parseShowinfoSourceDimensions,
  withoutMuxerLookaheadPts,
} from "./motion-evidence.js";
import { isFfmpegAvailable, runFfmpeg } from "./video-remux.js";

describe("motion evidence helpers", () => {
  it("drops only the single showinfo timestamp logged past the last written frame", () => {
    expect(withoutMuxerLookaheadPts([1, 2, 3, 4], 3)).toEqual([1, 2, 3]);
    expect(withoutMuxerLookaheadPts([1, 2, 3], 3)).toEqual([1, 2, 3]);
    expect(withoutMuxerLookaheadPts([1, 2, 3, 4, 5], 3)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("parses actual presentation timestamps without inventing missing values", () => {
    const stderr = [
      "[Parsed_showinfo_1] n: 0 pts: 3000 pts_time:0.3 duration: 1000",
      "irrelevant line",
      "[Parsed_showinfo_1] n: 1 pts: 3167 pts_time:0.3167 duration: 167",
      "[Parsed_showinfo_1] n: 2 pts: NOPTS pts_time:NOPTS",
    ].join("\n");

    expect(parseShowinfoPresentationTimes(stderr)).toEqual([300_000, 316_700]);
  });

  it("selects source frames and keeps timestamp reporting in the filter", () => {
    const consecutive = buildMotionSelectFilter({
      mode: "consecutive",
      startMs: 250,
      endMs: 750,
    });
    const filmstrip = buildMotionSelectFilter({
      mode: "filmstrip",
      startMs: 0,
      endMs: 2_000,
      filmstripTargetsMs: [250, 750, 1_250],
    });

    expect(consecutive).toContain("select=");
    expect(consecutive).toContain("showinfo");
    expect(consecutive).not.toMatch(/\bfps\s*=/);
    expect(filmstrip).toContain("selected_n");
    expect(filmstrip).toContain("lte(t,2.000000)");
    expect(filmstrip).not.toMatch(/\bfps\s*=/);
    for (const filter of [consecutive, filmstrip]) {
      expect(filter).toMatch(/showinfo.*,settb=AVTB,setpts=PTS\+N$/);
    }
  });

  it("places a source-pixel crop after timestamp reporting and before scale", () => {
    const filter = buildMotionSelectFilter({
      mode: "consecutive",
      startMs: 0,
      endMs: 500,
      crop: { x: 10, y: 12, width: 80, height: 40 },
    });
    expect(filter).toContain("showinfo,crop=80:40:10:12:exact=1,scale=");
    expect(
      parseShowinfoSourceDimensions(
        "[Parsed_showinfo_1] n:0 pts:0 pts_time:0 s:160x90 i:P",
      ),
    ).toEqual({ width: 160, height: 90 });
  });
});

function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  for (let offset = 2; offset + 9 < bytes.length; ) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1] ?? 0;
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0),
        width: ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0),
      };
    }
    offset += 2 + length;
  }
  throw new Error("expected a baseline JPEG frame header");
}

function lastOf<T>(items: T[]): T {
  for (const item of items.slice(-1)) return item;
  throw new Error("expected at least one item");
}

describe("motion evidence ffmpeg extraction", () => {
  let dir = "";
  let mediaBytes = new Uint8Array();

  beforeAll(async () => {
    expect(isFfmpegAvailable()).toBe(true);
    dir = await mkdtemp(join(tmpdir(), "clips-motion-evidence-test-"));
    const fixturePath = join(dir, "fixture.mp4");
    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x90:rate=10:duration=2",
      "-c:v",
      "libx264",
      "-g",
      "10",
      "-bf",
      "0",
      "-pix_fmt",
      "yuv420p",
      fixturePath,
    ]);
    mediaBytes = new Uint8Array(await readFile(fixturePath));
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("returns consecutive original frames with actual PTS and bounded lookahead", async () => {
    const result = await extractMotionEvidenceFrames({
      mediaBytes,
      mimeType: "video/mp4",
      startMs: 250,
      endMs: 750,
      mode: "consecutive",
      limit: 3,
    });

    expect(result.frames.map((frame) => frame.ptsMs)).toEqual([300, 400, 500]);
    expect(result.frames.every((frame) => frame.jpegBytes.byteLength > 0)).toBe(
      true,
    );
    expect(result.hasMore).toBe(true);

    const last = lastOf(result.frames);
    const next = await extractMotionEvidenceFrames({
      mediaBytes,
      mimeType: "video/mp4",
      startMs: 250,
      endMs: 750,
      mode: "consecutive",
      limit: 3,
      after: {
        pts: last.pts,
        ptsUs: last.ptsUs,
        samePtsSeen: last.samePtsOrdinal,
      },
    });
    expect(next.frames.map((frame) => frame.ptsMs)).toEqual([600, 700]);
    expect(next.hasMore).toBe(false);
  });

  it("samples source frames at or after filmstrip targets without interpolation", async () => {
    const targets = [250, 650, 1_050];
    const result = await extractMotionEvidenceFrames({
      mediaBytes,
      mimeType: "video/mp4",
      startMs: 0,
      endMs: 1_500,
      mode: "filmstrip",
      limit: targets.length,
      filmstripTargetsMs: targets,
    });

    expect(result.frames).toHaveLength(3);
    expect(result.frames.map((frame) => frame.targetMs)).toEqual(targets);
    expect(result.frames.map((frame) => frame.ptsMs)).toEqual([
      300, 700, 1_100,
    ]);
  });

  it("never returns a filmstrip sample past the end of the interval", async () => {
    const result = await extractMotionEvidenceFrames({
      mediaBytes,
      mimeType: "video/mp4",
      startMs: 140,
      endMs: 160,
      mode: "filmstrip",
      limit: 1,
      filmstripTargetsMs: [150],
    });

    expect(result.frames).toEqual([]);
  });

  it("crops odd offsets and sizes to exactly the reported rectangle", async () => {
    const crop = { x: 3, y: 5, width: 101, height: 43 };
    const result = await extractMotionEvidenceFrames({
      mediaBytes,
      mimeType: "video/mp4",
      startMs: 250,
      endMs: 750,
      mode: "consecutive",
      limit: 2,
      crop,
    });

    expect(result.crop).toEqual(crop);
    expect(result.frames).toHaveLength(2);
    for (const frame of result.frames) {
      expect(jpegSize(frame.jpegBytes)).toEqual({ width: 101, height: 43 });
    }
  });

  it("validates a crop against decoded dimensions and retains source PTS", async () => {
    const input = {
      mediaBytes,
      mimeType: "video/mp4",
      startMs: 250,
      endMs: 750,
      mode: "consecutive" as const,
      limit: 3,
    };
    const full = await extractMotionEvidenceFrames(input);
    const cropped = await extractMotionEvidenceFrames({
      ...input,
      crop: { x: 20, y: 10, width: 80, height: 40 },
    });

    expect(cropped.sourceDimensions).toEqual({ width: 160, height: 90 });
    expect(cropped.crop).toEqual({ x: 20, y: 10, width: 80, height: 40 });
    expect(cropped.frames.map((frame) => frame.ptsUs)).toEqual(
      full.frames.map((frame) => frame.ptsUs),
    );

    await expect(
      extractMotionEvidenceFrames({
        ...input,
        crop: { x: 100, y: 10, width: 80, height: 40 },
      }),
    ).rejects.toMatchObject({ code: "crop_out_of_bounds" });
  });
});

describe("telling an empty selection from a failed decode", () => {
  const emptySelection = [
    "[Parsed_showinfo_1 @ 0x1] [info] config in time_base: 1/1000, frame_rate: 10/1",
    "[vf#0:0 @ 0x2] [warning] No filtered frames for output stream, trying to initialize anyway.",
    "[mjpeg @ 0x3] [error] Non full-range YUV is non-standard, set strict_std_compliance to at most unofficial to use it.",
    "[vost#0:0/mjpeg @ 0x4] [enc:mjpeg @ 0x5] [error] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.",
    "[vf#0:0 @ 0x2] [error] Error sending frames to consumers: Invalid argument",
    "[vf#0:0 @ 0x2] [error] Task finished with error code: -22 (Invalid argument)",
    "[out#0/image2 @ 0x6] [error] Nothing was written into output file, because at least one of its streams received no packets.",
  ].join("\n");
  const shrunkCrop = [
    "[Parsed_crop_2 @ 0x7] [error] Invalid too big or non positive size for width '150' or height '80'",
    "[Parsed_crop_2 @ 0x7] [error] Failed to configure input pad on Parsed_crop_2",
    "[vf#0:0 @ 0x2] [error] Error reinitializing filters!",
    "[out#0/image2 @ 0x6] [error] Nothing was written into output file, because at least one of its streams received no packets.",
  ].join("\n");

  it("accepts only encoder fallout from an interval with no source frames", () => {
    expect(decodeFailureIn(emptySelection, 0)).toBeNull();
  });

  it("reports a filter or decoder error even when ffmpeg also says nothing was written", () => {
    expect(decodeFailureIn(shrunkCrop, 0)).toContain(
      "Invalid too big or non positive size",
    );
    expect(decodeFailureIn(shrunkCrop, 0)).toContain(
      "Error reinitializing filters!",
    );
  });

  it("reports a selected frame that never became an image", () => {
    const selectedThenLost =
      "[Parsed_showinfo_1 @ 0x1] [info] n:   0 pts:   1000 pts_time:1 duration: 100";
    expect(decodeFailureIn(selectedThenLost, 0)).toBe(
      "1 selected source frame(s) produced no image.",
    );
    expect(decodeFailureIn(selectedThenLost, 1)).toBeNull();
  });
});

describe("cursor timestamps in the stream timebase", () => {
  it("reads the exact integer PTS beside its rounded microseconds", () => {
    const stderr = [
      "[Parsed_showinfo_1 @ 0x1] [info] n:   1 pts: 127500 pts_time:1.416667 duration:   1500",
      "[Parsed_showinfo_1 @ 0x1] [info] n:   2 pts: 127500 pts_time:1.416667 duration:   1500",
    ].join("\n");
    expect(parseShowinfoFrameTimestamps(stderr)).toEqual([
      { pts: 127_500, ptsUs: 1_416_667 },
      { pts: 127_500, ptsUs: 1_416_667 },
    ]);
  });

  it("resumes at the cursor's integer PTS instead of a rounded time", () => {
    expect(
      buildMotionSelectFilter({
        mode: "consecutive",
        startMs: 1_400,
        endMs: 1_500,
        afterPts: 127_500,
      }),
    ).toContain("select='gte(pts,127500)*lte(t,1.500000)'");
  });
});

describe("motion evidence ffmpeg failures and timebases", () => {
  let dir = "";

  beforeAll(async () => {
    expect(isFfmpegAvailable()).toBe(true);
    dir = await mkdtemp(join(tmpdir(), "clips-motion-evidence-edge-"));
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function vp8(name: string, size: string): Promise<string> {
    const path = join(dir, name);
    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=${size}:rate=10:duration=1`,
      "-c:v",
      "libvpx",
      "-deadline",
      "realtime",
      "-f",
      "webm",
      path,
    ]);
    return path;
  }

  async function shrinkingWebm(): Promise<Uint8Array> {
    const large = await vp8("large.webm", "160x90");
    const small = await vp8("small.webm", "80x46");
    const list = join(dir, "list.txt");
    await writeFile(list, `file '${large}'\nfile '${small}'\n`);
    const output = join(dir, "shrinking.webm");
    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-c",
      "copy",
      output,
    ]);
    return new Uint8Array(await readFile(output));
  }

  function withZeroDurationSecondSample(bytes: Uint8Array): Uint8Array {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const boxes: Array<{ at: number; size: number }> = [];
    let start = 0;
    let end = bytes.length;
    for (const name of ["moov", "trak", "mdia", "minf", "stbl", "stts"]) {
      let found: { at: number; size: number } | null = null;
      for (let at = start; at + 8 <= end && !found; ) {
        const size = view.getUint32(at);
        if (size < 8) break;
        const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
        if (type === name) found = { at, size };
        at += size;
      }
      if (!found) throw new Error(`expected an MP4 ${name} box`);
      boxes.push(found);
      start = found.at + 8;
      end = found.at + found.size;
    }
    const stts = lastOf(boxes);
    expect(view.getUint32(stts.at + 12)).toBe(1);
    const count = view.getUint32(stts.at + 16);
    const delta = view.getUint32(stts.at + 20);
    const entries = [
      [1, delta],
      [1, 0],
      [count - 2, delta],
    ];
    const table = new Uint8Array(16 + entries.length * 8);
    const tableView = new DataView(table.buffer);
    tableView.setUint32(0, table.length);
    table.set(bytes.subarray(stts.at + 4, stts.at + 12), 4);
    tableView.setUint32(12, entries.length);
    entries.forEach(([samples = 0, duration = 0], index) => {
      tableView.setUint32(16 + index * 8, samples);
      tableView.setUint32(20 + index * 8, duration);
    });
    const grow = table.length - stts.size;
    const patched = new Uint8Array(bytes.length + grow);
    patched.set(bytes.subarray(0, stts.at));
    patched.set(table, stts.at);
    patched.set(bytes.subarray(stts.at + stts.size), stts.at + table.length);
    const patchedView = new DataView(patched.buffer);
    for (const box of boxes.slice(0, -1)) {
      patchedView.setUint32(box.at, box.size + grow);
    }
    return patched;
  }

  async function duplicatePtsMp4At90kHz(): Promise<Uint8Array> {
    const output = join(dir, "sixty.mp4");
    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x90:rate=60:duration=0.2",
      "-c:v",
      "libx264",
      "-g",
      "1",
      "-bf",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-video_track_timescale",
      "90000",
      output,
    ]);
    return withZeroDurationSecondSample(new Uint8Array(await readFile(output)));
  }

  it("returns an empty page for an interval with no source frame", async () => {
    const result = await extractMotionEvidenceFrames({
      mediaBytes: new Uint8Array(
        await readFile(await vp8("tenfps.webm", "160x90")),
      ),
      mimeType: "video/webm",
      startMs: 110,
      endMs: 190,
      mode: "consecutive",
      limit: 4,
    });

    expect(result.frames).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  it("fails typed when the crop no longer fits a source that shrank mid-stream", async () => {
    await expect(
      extractMotionEvidenceFrames({
        mediaBytes: await shrinkingWebm(),
        mimeType: "video/webm",
        startMs: 1_000,
        endMs: 1_900,
        mode: "consecutive",
        limit: 4,
        crop: { x: 0, y: 0, width: 150, height: 80 },
      }),
    ).rejects.toMatchObject({ code: "decode_failed" });
  });

  it("pages through two frames sharing one fractional 90 kHz PTS without skipping either", async () => {
    const mediaBytes = await duplicatePtsMp4At90kHz();
    const input = {
      mediaBytes,
      mimeType: "video/mp4",
      startMs: 0,
      endMs: 3_000,
      mode: "consecutive" as const,
      limit: 2,
    };
    const first = await extractMotionEvidenceFrames(input);
    expect(first.frames.map((frame) => frame.pts)).toEqual([0, 1_500]);
    expect(first.hasMore).toBe(true);

    const last = lastOf(first.frames);
    expect(last.ptsUs).toBe(16_667);
    expect(last.ptsMs).toBeCloseTo(16.667, 3);
    const second = await extractMotionEvidenceFrames({
      ...input,
      after: {
        pts: last.pts,
        ptsUs: last.ptsUs,
        samePtsSeen: last.samePtsOrdinal,
      },
    });
    expect(
      second.frames.map((frame) => [frame.pts, frame.samePtsOrdinal]),
    ).toEqual([
      [1_500, 2],
      [3_000, 1],
    ]);
    expect(second.frames.map((frame) => frame.jpegBytes)).not.toContainEqual(
      first.frames[1]?.jpegBytes,
    );
  });
});
