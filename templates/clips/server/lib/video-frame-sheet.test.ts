import { describe, expect, it } from "vitest";

import {
  clampFrameSheetRange,
  frameSheetFfmpegArgs,
  frameSheetFpsFromProbe,
  parseFrameSheetRequest,
  planFrameSheet,
  type FrameSheetRequest,
} from "./video-frame-sheet.js";

function request(overrides: Partial<FrameSheetRequest> = {}) {
  return { startMs: 1000, endMs: 2000, fps: 30, ...overrides };
}

function plan(overrides: Parameters<typeof planFrameSheet>[0]) {
  const result = planFrameSheet(overrides);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("parseFrameSheetRequest", () => {
  it("reads the range and leaves out what the request leaves out", () => {
    expect(
      parseFrameSheetRequest({ startMs: "1000.4", endMs: "", fps: "" }),
    ).toEqual({
      ok: true,
      value: { startMs: 1000, endMs: null, fps: null },
    });
    expect(
      parseFrameSheetRequest({ startMs: "", endMs: "500", fps: "12.5" }),
    ).toEqual({ ok: true, value: { startMs: 0, endMs: 500, fps: 12.5 } });
  });

  it("refuses values an agent can fix, with the fix", () => {
    const unfilled = parseFrameSheetRequest({
      startMs: "0",
      endMs: "{endMs}",
      fps: "",
    });
    expect(unfilled).toMatchObject({
      ok: false,
      nextStep: expect.stringContaining("leave it out"),
    });
    expect(
      parseFrameSheetRequest({ startMs: "-1", endMs: "", fps: "" }),
    ).toMatchObject({ ok: false });
    expect(
      parseFrameSheetRequest({ startMs: "1000", endMs: "1000", fps: "" }),
    ).toMatchObject({ ok: false });
    expect(
      parseFrameSheetRequest({ startMs: "0", endMs: "", fps: "0" }),
    ).toMatchObject({ ok: false });
    expect(
      parseFrameSheetRequest({ startMs: "0", endMs: "", fps: "5e-324" }),
    ).toMatchObject({ ok: false });
    expect(
      parseFrameSheetRequest({ startMs: "0", endMs: "", fps: "0.1" }),
    ).toMatchObject({ ok: true, value: { fps: 0.1 } });
    expect(
      parseFrameSheetRequest({ startMs: "0", endMs: "", fps: "61" }),
    ).toMatchObject({ ok: false });
  });
});

describe("clampFrameSheetRange", () => {
  it("keeps the range inside the recording", () => {
    expect(
      clampFrameSheetRange(request({ startMs: 9000, endMs: 12_000 }), 10_000),
    ).toEqual({
      ok: true,
      value: { startMs: 9000, endMs: 10_000, fps: 30 },
    });
    expect(
      clampFrameSheetRange(request({ startMs: 15_000, endMs: null }), 10_000),
    ).toMatchObject({ ok: true, value: { startMs: 9997 } });
  });

  it("refuses a range longer than a minute", () => {
    const result = clampFrameSheetRange(
      request({ startMs: 0, endMs: 61_000 }),
      null,
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("61 seconds"),
    });
  });
});

describe("frameSheetFpsFromProbe", () => {
  const probe = (streamLine: string) =>
    [
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'input.mp4':",
      "  Duration: 00:00:04.00, start: 0.000000, bitrate: 144 kb/s",
      `  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 640x360, ${streamLine} (default)`,
      "Stream mapping:",
      "  Stream #0:0 -> #0:0 (h264 (native) -> wrapped_avframe (native))",
      "Output #0, null, to 'pipe:':",
      "  Stream #0:0(und): Video: wrapped_avframe, yuv420p, 640x360, 25 fps, 25 tbn",
    ].join("\n");

  it("uses the input stream's nominal rate", () => {
    expect(
      frameSheetFpsFromProbe(probe("139 kb/s, 30 fps, 30 tbr, 15360 tbn")),
    ).toBe(30);
    // A screen recording's average drops while nothing moves; tbr does not.
    expect(frameSheetFpsFromProbe(probe("7.31 fps, 60 tbr, 90k tbn"))).toBe(60);
    expect(frameSheetFpsFromProbe(probe("29.97 fps, 29.97 tbr, 30k tbn"))).toBe(
      29.97,
    );
  });

  it("falls back to 30 fps when the stream has no usable rate", () => {
    // MediaRecorder WebM: a millisecond timebase and no frame rate.
    expect(frameSheetFpsFromProbe(probe("1k tbr, 1k tbn"))).toBe(30);
    expect(frameSheetFpsFromProbe("Duration: 00:00:01.00")).toBe(30);
  });

  it("caps a high frame rate at 60", () => {
    expect(frameSheetFpsFromProbe(probe("120 fps, 120 tbr, 15360 tbn"))).toBe(
      60,
    );
    expect(frameSheetFpsFromProbe(probe("240 fps, 240 tbr, 15360 tbn"))).toBe(
      60,
    );
  });
});

describe("planFrameSheet", () => {
  it("puts one cell at each step from startMs", () => {
    const result = plan({ request: request(), fps: 30 });
    expect(result.frameCount).toBe(30);
    expect(result.frameTimesMs.slice(0, 4)).toEqual([1000, 1033, 1067, 1100]);
    expect(result).toMatchObject({
      columns: 4,
      rows: 8,
      cellWidth: 320,
      cellHeight: 180,
    });
  });

  it("fills the sheet when endMs is left out, without passing the end", () => {
    expect(
      plan({ request: request({ endMs: null }), fps: 30 }).frameCount,
    ).toBe(36);
    expect(
      plan({
        request: request({ startMs: 9500, endMs: null }),
        fps: 30,
        durationMs: 10_000,
      }).frameCount,
    ).toBe(15);
    // At 0.5 fps, 36 frames would span 72 seconds; the sheet stops at 60.
    expect(
      plan({ request: request({ endMs: null, fps: 0.5 }), fps: 0.5 })
        .frameCount,
    ).toBe(30);
  });

  it("names a request that fits when a range needs too many frames", () => {
    const result = planFrameSheet({
      request: request({ startMs: 1000, endMs: 3000 }),
      fps: 30,
    });
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("60 frames"),
    });
    if (result.ok) return;
    expect(result.nextStep).toContain("endMs=2200");
    expect(result.nextStep).toContain("fps=18");

    const shorter = plan({
      request: request({ startMs: 1000, endMs: 2200 }),
      fps: 30,
    });
    expect(shorter.frameCount).toBe(36);
    const slower = plan({
      request: request({ startMs: 1000, endMs: 3000 }),
      fps: 18,
    });
    expect(slower.frameCount).toBe(36);
  });

  it("names requests that fit for any rate", () => {
    for (const fps of [29.975, 23.976, 59.94, 7, 0.7]) {
      for (const endMs of [2000, 5001, 60_000]) {
        const result = planFrameSheet({
          request: request({ startMs: 0, endMs, fps }),
          fps,
        });
        if (result.ok) continue;
        const suggested = (name: string) =>
          [
            ...result.nextStep.matchAll(new RegExp(`${name}=([0-9.]+)`, "g")),
          ].map((match) => Number(match[1]));
        const [keptFps, otherFps] = suggested("fps");
        const [fittingEndMs] = suggested("endMs");
        expect(keptFps).toBe(fps);
        expect(
          planFrameSheet({
            request: request({ startMs: 0, endMs: fittingEndMs, fps }),
            fps,
          }).ok,
        ).toBe(true);
        expect(
          planFrameSheet({
            request: request({ startMs: 0, endMs, fps: otherFps }),
            fps: otherFps,
          }).ok,
        ).toBe(true);
      }
    }
  });

  it("keeps portrait and square cells inside the box", () => {
    expect(
      plan({ request: request(), fps: 30, width: 1080, height: 1920 }),
    ).toMatchObject({ cellWidth: 136, cellHeight: 240, columns: 9 });
    expect(
      plan({ request: request(), fps: 30, width: 1000, height: 1000 }),
    ).toMatchObject({ cellWidth: 240, cellHeight: 240, columns: 5 });
  });
});

describe("frameSheetFfmpegArgs", () => {
  it("seeks to the keyframe before startMs and moves startMs to time zero", () => {
    const { inputArgs, filter } = frameSheetFfmpegArgs(
      plan({ request: request(), fps: 30 }),
    );
    expect(inputArgs).toEqual(["-noaccurate_seek", "-ss", "1.000000"]);
    expect(filter).toBe(
      [
        "setpts=PTS-0.002000/TB",
        "fps=fps=30:start_time=0:round=up",
        "trim=end_frame=30",
        "scale=320:180:force_original_aspect_ratio=decrease",
        "pad=320:180:-1:-1:color=black",
        "tile=4x8",
      ].join(","),
    );
  });
});
