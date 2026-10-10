import { describe, expect, it } from "vitest";

import { NativePreviewPolicyController } from "./native-preview-policy";

describe("native preview policy", () => {
  it("defaults to Auto/60 and distinguishes requested from effective density", () => {
    const policy = new NativePreviewPolicyController();
    expect(policy.status(1.6)).toMatchObject({
      requestedQuality: "auto",
      frameRateTarget: 60,
      devicePixelRatio: 1.6,
      effectivePixelRatio: 1.6,
    });
    expect(policy.status(3).effectivePixelRatio).toBe(2);
    policy.setPolicy({ quality: "performance", frameRateTarget: 120 });
    expect(policy.status(2).effectivePixelRatio).toBe(1.5);
    expect(policy.status(2).targetFrameIntervalMs).toBeCloseTo(1000 / 120);
    policy.setPolicy({ quality: "quality", frameRateTarget: 60 });
    expect(policy.status(2).effectivePixelRatio).toBe(2);
  });

  it("downshifts only after sustained measured wall cost and recovers gradually", () => {
    const policy = new NativePreviewPolicyController();
    for (let index = 0; index < 7; index += 1)
      expect(policy.observeRenderWall(20)).toBe(false);
    expect(policy.status(2).effectivePixelRatio).toBe(2);
    expect(policy.observeRenderWall(20)).toBe(true);
    expect(policy.status(2).effectivePixelRatio).toBe(1.75);
    for (let index = 0; index < 8; index += 1) policy.observeRenderWall(20);
    expect(policy.status(2).effectivePixelRatio).toBe(1.5);
    for (let index = 0; index < 89; index += 1)
      expect(policy.observeRenderWall(4)).toBe(false);
    expect(policy.observeRenderWall(4)).toBe(true);
    expect(policy.status(2).effectivePixelRatio).toBe(1.75);
  });

  it("targets submission cadence while dirty work bypasses the interval", () => {
    const policy = new NativePreviewPolicyController();
    expect(policy.shouldSubmit(100, false)).toBe(true);
    expect(policy.shouldSubmit(108, false)).toBe(false);
    expect(policy.shouldSubmit(109, true)).toBe(true);
    expect(policy.shouldSubmit(117, false)).toBe(false);
    policy.setPolicy({ quality: "quality", frameRateTarget: 120 });
    expect(policy.shouldSubmit(200, false)).toBe(true);
    expect(policy.shouldSubmit(208.4, false)).toBe(true);
  });

  it("resets adaptive density when the authored policy changes", () => {
    const policy = new NativePreviewPolicyController();
    for (let index = 0; index < 8; index += 1) policy.observeRenderWall(20);
    expect(policy.status(2).effectivePixelRatio).toBe(1.75);
    expect(
      policy.setPolicy({ quality: "performance", frameRateTarget: 60 }),
    ).toBe(true);
    expect(policy.status(2).effectivePixelRatio).toBe(1.5);
    expect(policy.setPolicy({ quality: "auto", frameRateTarget: 60 })).toBe(
      true,
    );
    expect(policy.status(2).effectivePixelRatio).toBe(2);
  });
});
