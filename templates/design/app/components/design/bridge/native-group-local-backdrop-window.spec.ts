import { describe, expect, it } from "vitest";

import {
  planNativeGroupLocalBackdropWindow,
  isCurrentNativeGroupLocalBackdropWindow,
  type NativeGroupLocalBackdropWindowInput,
} from "./native-group-local-backdrop-window";

function input(): NativeGroupLocalBackdropWindowInput {
  return {
    incoming: { x: -4, y: -3, width: 24, height: 20 },
    output: { width: 12, height: 8 },
    extent: {
      pixelRatio: 1,
      width: 12,
      height: 8,
      sourceWidth: 8,
      sourceHeight: 6,
      left: 2,
      top: 1,
      right: 2,
      bottom: 1,
      expanded: true,
    },
    localBox: { x: -2, y: -1, width: 12, height: 8 },
    localToTarget: { a: 1, b: 0, c: 0, d: 1, e: 2, f: 3 },
    physicalScale: { x: 1, y: 1 },
    receiverClip: { x: 2, y: 3, width: 8, height: 6 },
  };
}

describe("contained expanded nested Backdrop capture planning", () => {
  it("retains negative child-local capture coordinates and separate receiver coverage", () => {
    expect(planNativeGroupLocalBackdropWindow(input())).toMatchObject({
      ok: true,
      plan: {
        captureWindow: { x: 0, y: 2, width: 12, height: 8 },
        replacementCoverage: { x: 2, y: 3, width: 8, height: 6 },
        sourceBox: { x: 4, y: 5, width: 12, height: 8 },
        samplingPixels: { x: 4, y: 5, width: 12, height: 8 },
      },
    });
  });

  it("resolves a negative parent-space capture through the active group's nonzero origin", () => {
    const value = input();
    value.incoming = { x: -5, y: -6, width: 18, height: 18 };
    value.localToTarget.e = -2;
    value.localToTarget.f = -4;
    value.receiverClip = { x: -2, y: -4, width: 8, height: 6 };
    expect(planNativeGroupLocalBackdropWindow(value)).toMatchObject({
      ok: true,
      plan: {
        captureWindow: { x: -4, y: -5, width: 12, height: 8 },
        sourceBox: { x: 1, y: 1, width: 12, height: 8 },
      },
    });
  });

  it("does not shrink a missing capture window to the visible receiver", () => {
    const value = input();
    value.incoming = { x: 2, y: 3, width: 8, height: 6 };
    expect(planNativeGroupLocalBackdropWindow(value)).toEqual({
      ok: false,
      reason: "capture-window-unavailable",
    });
  });

  it("rejects missing bilinear support even when geometric edges fit the parent texture", () => {
    const value = input();
    value.incoming = { x: 0, y: 2, width: 12, height: 8 };
    value.output = { width: 24, height: 16 };
    value.extent = {
      pixelRatio: 1,
      width: 24,
      height: 16,
      sourceWidth: 16,
      sourceHeight: 12,
      left: 4,
      top: 2,
      right: 4,
      bottom: 2,
      expanded: true,
    };
    expect(planNativeGroupLocalBackdropWindow(value)).toEqual({
      ok: false,
      reason: "sampling-window-unavailable",
    });
  });

  it("accepts exact pixel-aligned capture at every texture edge", () => {
    const value = input();
    value.incoming = { x: 0, y: 2, width: 12, height: 8 };
    expect(planNativeGroupLocalBackdropWindow(value)).toMatchObject({
      ok: true,
      plan: { samplingPixels: { x: 0, y: 0, width: 12, height: 8 } },
    });
  });

  it("retains rejection of an expanded flag without expanded extent geometry", () => {
    const value = input();
    value.extent = {
      pixelRatio: 1,
      width: 12,
      height: 8,
      sourceWidth: 12,
      sourceHeight: 8,
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      expanded: true,
    };
    expect(planNativeGroupLocalBackdropWindow(value)).toEqual({
      ok: false,
      reason: "extent-invalid",
    });
  });

  it.each(["left", "top", "right", "bottom"] as const)(
    "rejects stale %s extent before a source window is staged",
    (side) => {
      const value = input();
      value.extent![side] += 1;
      expect(planNativeGroupLocalBackdropWindow(value)).toEqual({
        ok: false,
        reason: "extent-invalid",
      });
    },
  );

  it.each([{ b: 0.2 }, { c: -0.2 }, { a: -1 }, { d: -1 }, { a: 0 }])(
    "retains typed affine refusal for %j",
    (matrix) => {
      const value = input();
      Object.assign(value.localToTarget, matrix);
      expect(planNativeGroupLocalBackdropWindow(value)).toEqual({
        ok: false,
        reason: "unsupported-affine",
      });
    },
  );

  it.each([NaN, Infinity, -Infinity])(
    "rejects unreadable geometry %s",
    (value) => {
      const original = input();
      original.localToTarget.e = value;
      expect(planNativeGroupLocalBackdropWindow(original)).toEqual({
        ok: false,
        reason: "invalid-geometry",
      });
    },
  );

  it("rejects replacement coverage outside the captured plane", () => {
    const value = input();
    value.receiverClip.x = -0.5;
    expect(planNativeGroupLocalBackdropWindow(value)).toEqual({
      ok: false,
      reason: "receiver-outside-capture",
    });
  });

  it("never modifies capture, incoming or replacement metadata", () => {
    const value = input();
    const before = structuredClone(value);
    expect(planNativeGroupLocalBackdropWindow(value).ok).toBe(true);
    expect(value).toEqual(before);
  });
  it("packs exact-copy coordinates without losing zero-weight edge support", () => {
    const value = input();
    value.incoming = { x: 0, y: 2, width: 12, height: 8 };
    const result = planNativeGroupLocalBackdropWindow(value);
    if (!result.ok) throw new Error("Expected exact-copy plan");
    expect(Array.from(new Float32Array(result.plan.packet))).toEqual([
      12, 8, 0, 1, 0, 0, 12, 8,
    ]);
    expect(result.plan.arithmeticEnvelope).toEqual({ x: 0, y: 0 });
  });

  it("keeps packed fractional coordinates and a checked rounding envelope", () => {
    const value = input();
    value.localToTarget.e += 0.3;
    value.receiverClip.x += 0.3;
    const result = planNativeGroupLocalBackdropWindow(value);
    if (!result.ok) throw new Error("Expected fractional plan");
    expect(result.plan.sourceBox.x).toBe(Math.fround(4.3));
    expect(result.plan.packet[3]).toBe(0);
    expect(result.plan.samplingPixels).toEqual({
      x: 4,
      y: 4,
      width: 13,
      height: 10,
    });
    expect(result.plan.arithmeticEnvelope.x).toBeGreaterThan(0);
  });

  it("rejects fractional sampling that loses a rounding tap at a texture edge", () => {
    const value = input();
    value.incoming = { x: 0, y: 2, width: 13, height: 8 };
    value.localToTarget.e += 0.25;
    value.receiverClip.x += 0.25;
    expect(planNativeGroupLocalBackdropWindow(value)).toEqual({
      ok: false,
      reason: "sampling-window-unavailable",
    });
  });

  it("rejects forged or stale plans at the staging boundary", () => {
    const value = input();
    const result = planNativeGroupLocalBackdropWindow(value);
    if (!result.ok) throw new Error("Expected checked plan");
    const state = {
      incoming: value.incoming,
      output: value.output,
      extent: value.extent,
    };
    expect(isCurrentNativeGroupLocalBackdropWindow(result.plan, state)).toBe(
      true,
    );
    expect(
      isCurrentNativeGroupLocalBackdropWindow({ ...result.plan }, state),
    ).toBe(false);
    expect(
      isCurrentNativeGroupLocalBackdropWindow(result.plan, {
        ...state,
        extent: { ...result.plan.extent, expanded: false },
      }),
    ).toBe(false);
    expect(
      isCurrentNativeGroupLocalBackdropWindow(result.plan, {
        ...state,
        output: { width: 11, height: 8 },
      }),
    ).toBe(false);
    expect(
      isCurrentNativeGroupLocalBackdropWindow(result.plan, {
        ...state,
        incoming: { width: 23, height: 20 },
      }),
    ).toBe(false);
    expect(Object.isFrozen(result.plan)).toBe(true);
    expect(Object.isFrozen(result.plan.packet)).toBe(true);
    expect(Object.isFrozen(result.plan.extent)).toBe(true);
  });
});
