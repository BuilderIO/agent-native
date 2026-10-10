import { describe, expect, it } from "vitest";

import {
  MAX_NATIVE_SOURCE_CLIPS,
  classifyNativeOverflowClip,
  nativePointInsideSourceClips,
  planNativeSourceClips,
  type NativeSourceClipCandidate,
} from "./native-source-clip-plan";

function candidate(
  patch: Partial<NativeSourceClipCandidate> = {},
): NativeSourceClipCandidate {
  return {
    borderBox: { x: 10, y: 20, width: 200, height: 120 },
    localWidth: 100,
    localHeight: 80,
    scaleX: 2,
    scaleY: 1.5,
    axisAligned: true,
    border: { top: 2, right: 4, bottom: 6, left: 8 },
    padding: { top: 3, right: 5, bottom: 7, left: 9 },
    outerRadii: {
      topLeft: { x: 30, y: 20 },
      topRight: { x: 10, y: 10 },
      bottomRight: { x: 12, y: 14 },
      bottomLeft: { x: 16, y: 18 },
    },
    edge: "padding",
    ...patch,
  };
}

describe("native source clip plan", () => {
  it("classifies bounded two-axis overflow and computed visual-box pixel outsets", () => {
    expect(classifyNativeOverflowClip("visible", "visible", "0px")).toEqual({
      ok: true,
      edge: "none",
      outset: 0,
    });
    expect(classifyNativeOverflowClip("hidden", "hidden", "5px")).toEqual({
      ok: true,
      edge: "padding",
      outset: 0,
    });
    expect(
      classifyNativeOverflowClip("clip", "clip", "padding-box 0px"),
    ).toEqual({
      ok: true,
      edge: "padding",
      outset: 0,
    });
    expect(classifyNativeOverflowClip("clip", "clip", "content-box")).toEqual({
      ok: true,
      edge: "content",
      outset: 0,
    });
    expect(
      classifyNativeOverflowClip("clip", "clip", "content-box 0px"),
    ).toEqual({ ok: true, edge: "content", outset: 0 });
    expect(
      classifyNativeOverflowClip("clip", "clip", "content-box 2px"),
    ).toEqual({ ok: true, edge: "content", outset: 2 });
    expect(
      classifyNativeOverflowClip("clip", "clip", "border-box 0px"),
    ).toEqual({ ok: true, edge: "border", outset: 0 });
    expect(
      classifyNativeOverflowClip("clip", "clip", "2.5px border-box"),
    ).toEqual({
      ok: true,
      edge: "border",
      outset: 2.5,
    });
    expect(classifyNativeOverflowClip("clip", "clip", "")).toMatchObject({
      ok: false,
      reason: "clip-margin-unreadable",
    });
    expect(classifyNativeOverflowClip("clip", "clip", "", false)).toMatchObject(
      {
        ok: false,
        reason: "clip-margin-unavailable",
      },
    );
    expect(
      classifyNativeOverflowClip("clip", "clip", "2px", false),
    ).toMatchObject({
      ok: false,
      reason: "clip-margin-unavailable",
    });
    expect(classifyNativeOverflowClip("", "clip", "2px")).toMatchObject({
      ok: false,
      reason: "overflow-unreadable",
    });
    for (const margin of [
      "-2px",
      "2em",
      "calc(1px + 2px)",
      "border-box content-box",
      "1e309px",
    ])
      expect(classifyNativeOverflowClip("clip", "clip", margin)).toMatchObject({
        ok: false,
        reason: "unsupported-clip-margin",
      });
    for (const axes of [
      ["clip", "visible"],
      ["auto", "auto"],
      ["hidden", "clip"],
    ])
      expect(classifyNativeOverflowClip(axes[0], axes[1], "0px")).toMatchObject(
        {
          ok: false,
          reason: "unsupported-overflow",
        },
      );
  });

  it("projects an asymmetric curved padding edge through independent x/y scales", () => {
    const result = planNativeSourceClips([candidate()]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clips[0].rect).toEqual({
      x: 26,
      y: 23,
      width: 176,
      height: 108,
    });
    expect(result.clips[0].radii.topLeft).toEqual({ x: 44, y: 27 });
    expect(result.clips[0].radii.bottomRight).toEqual({ x: 16, y: 12 });
  });

  it("projects replaced-media pixels to the curved content edge", () => {
    const result = planNativeSourceClips([candidate({ edge: "content" })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clips[0].rect).toEqual({
      x: 44,
      y: 27.5,
      width: 148,
      height: 93,
    });
    expect(result.clips[0].radii.topLeft).toEqual({ x: 26, y: 22.5 });
  });

  it("projects border, padding, and content outsets through independent scales", () => {
    const border = planNativeSourceClips([
      candidate({ edge: "border", outset: 12 }),
    ]);
    const padding = planNativeSourceClips([
      candidate({ edge: "padding", outset: 3 }),
    ]);
    const content = planNativeSourceClips([
      candidate({ edge: "content", outset: 5 }),
    ]);
    expect(border.ok && border.clips[0].rect).toEqual({
      x: -14,
      y: 2,
      width: 248,
      height: 156,
    });
    expect(border.ok && border.clips[0].radii.topLeft).toEqual({
      x: 84,
      y: 48,
    });
    expect(padding.ok && padding.clips[0].rect).toEqual({
      x: 20,
      y: 18.5,
      width: 188,
      height: 117,
    });
    expect(padding.ok && padding.clips[0].radii.topLeft).toEqual({
      x: 50,
      y: 31.5,
    });
    expect(content.ok && content.clips[0].rect).toEqual({
      x: 34,
      y: 20,
      width: 168,
      height: 108,
    });
    expect(content.ok && content.clips[0].radii.topLeft).toEqual({
      x: 36,
      y: 30,
    });
    if (!border.ok) return;
    expect(nativePointInsideSourceClips(-13, 3, border.clips)).toBe(false);
    expect(nativePointInsideSourceClips(110, 3, border.clips)).toBe(true);
  });

  it("uses the specified small-corner outset curve independently for elliptical axes", () => {
    const zero = { x: 0, y: 0 };
    const border = planNativeSourceClips([
      candidate({
        edge: "border",
        outset: 20,
        outerRadii: {
          topLeft: { x: 10, y: 5 },
          topRight: zero,
          bottomRight: zero,
          bottomLeft: zero,
        },
      }),
    ]);
    expect(border.ok).toBe(true);
    if (!border.ok) return;
    expect(border.clips[0].radii.topLeft.x).toBeCloseTo(55.009765625, 10);
    expect(border.clips[0].radii.topLeft.y).toBeCloseTo(24.86846923828125, 10);
    expect(border.clips[0].radii.topRight).toEqual(zero);

    const mixed = planNativeSourceClips([
      candidate({
        edge: "padding",
        outset: 5,
        outerRadii: {
          topLeft: { x: 1, y: 2 },
          topRight: zero,
          bottomRight: zero,
          bottomLeft: zero,
        },
      }),
    ]);
    expect(mixed.ok).toBe(true);
    if (!mixed.ok) return;
    expect(mixed.clips[0].radii.topLeft.x).toBe(0);
    expect(mixed.clips[0].radii.topLeft.y).toBeCloseTo(7.333334666666667, 10);
  });

  it("keeps a square corner square and a zero-area edge finite", () => {
    const square = planNativeSourceClips([
      candidate({
        edge: "border",
        outset: 20,
        outerRadii: {
          topLeft: { x: 0, y: 0 },
          topRight: { x: 0, y: 0 },
          bottomRight: { x: 0, y: 0 },
          bottomLeft: { x: 0, y: 0 },
        },
      }),
    ]);
    expect(square.ok && square.clips[0].radii.topLeft).toEqual({ x: 0, y: 0 });
    const empty = planNativeSourceClips([
      candidate({
        edge: "content",
        localWidth: 20,
        localHeight: 20,
        borderBox: { x: 0, y: 0, width: 40, height: 30 },
        border: { top: 10, right: 10, bottom: 10, left: 10 },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        outerRadii: {
          topLeft: { x: 0, y: 0 },
          topRight: { x: 0, y: 0 },
          bottomRight: { x: 0, y: 0 },
          bottomLeft: { x: 0, y: 0 },
        },
      }),
    ]);
    expect(empty.ok && empty.clips[0].rect).toEqual({
      x: 20,
      y: 15,
      width: 0,
      height: 0,
    });
  });

  it("keeps ancestor ellipses separate and intersects their visible bounds", () => {
    const outer = candidate({
      borderBox: { x: 0, y: 0, width: 200, height: 120 },
    });
    const inner = candidate({
      borderBox: { x: 100, y: 20, width: 200, height: 120 },
    });
    const result = planNativeSourceClips([outer, inner]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clips).toHaveLength(2);
    expect(result.bounds).toEqual({ x: 116, y: 23, width: 76, height: 88 });
    expect(nativePointInsideSourceClips(150, 70, result.clips)).toBe(true);
    expect(nativePointInsideSourceClips(30, 70, result.clips)).toBe(false);
    expect(nativePointInsideSourceClips(117, 24, result.clips)).toBe(false);
  });

  it("rejects rotated, mirrored, or inconsistent projected transforms", () => {
    expect(
      planNativeSourceClips([candidate({ axisAligned: false })]),
    ).toMatchObject({ ok: false, reason: "unsupported-transform" });
    expect(planNativeSourceClips([candidate({ scaleX: -2 })])).toMatchObject({
      ok: false,
      reason: "unsupported-transform",
    });
    expect(
      planNativeSourceClips([
        candidate({ borderBox: { x: 10, y: 20, width: 201, height: 120 } }),
      ]),
    ).toMatchObject({ ok: false, reason: "invalid-geometry" });
  });

  it("rejects degenerate and non-quarter-ellipse inner curves", () => {
    expect(
      planNativeSourceClips([
        candidate({ border: { top: 2, right: 4, bottom: 6, left: 101 } }),
      ]),
    ).toMatchObject({ ok: false, reason: "invalid-geometry" });
    expect(
      planNativeSourceClips([
        candidate({
          outerRadii: {
            topLeft: { x: 96, y: 20 },
            topRight: { x: 4, y: 10 },
            bottomRight: { x: 12, y: 14 },
            bottomLeft: { x: 16, y: 18 },
          },
          border: { top: 2, right: 8, bottom: 6, left: 0 },
        }),
      ]),
    ).toMatchObject({ ok: false, reason: "unsupported-curve" });
  });

  it("enforces the bounded per-record clip list", () => {
    expect(
      planNativeSourceClips(
        Array.from({ length: MAX_NATIVE_SOURCE_CLIPS }, () => candidate()),
      ).ok,
    ).toBe(true);
    expect(
      planNativeSourceClips(
        Array.from({ length: MAX_NATIVE_SOURCE_CLIPS + 1 }, () => candidate()),
      ),
    ).toMatchObject({ ok: false, reason: "too-many-clips" });
  });
});
