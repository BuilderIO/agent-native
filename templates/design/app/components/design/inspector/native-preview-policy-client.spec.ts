import { describe, expect, it } from "vitest";

import {
  NativePreviewPolicyError,
  readNativePreviewStatus,
} from "./native-preview-policy-client";

const measured = {
  requestedQuality: "performance",
  frameRateTarget: 120,
  devicePixelRatio: 2,
  effectivePixelRatio: 1,
  targetFrameIntervalMs: 1000 / 120,
  renderWallMs: 4.2,
  rafIntervalMs: 8.4,
};
describe("native preview policy diagnostics", () => {
  it("distinguishes requested performance policy from the measured effective density and wall cadence", () => {
    expect(readNativePreviewStatus(measured)).toEqual(measured);
  });
  it("allows a fresh preview before wall intervals have been measured", () => {
    const { renderWallMs: _render, rafIntervalMs: _raf, ...fresh } = measured;
    expect(readNativePreviewStatus(fresh)).toEqual(fresh);
  });
  it("rejects an invented HDR/GPU timing or invalid effective density instead of presenting it as measured", () => {
    expect(() =>
      readNativePreviewStatus({ ...measured, effectivePixelRatio: Infinity }),
    ).toThrow(NativePreviewPolicyError);
    expect(() =>
      readNativePreviewStatus({ ...measured, frameRateTarget: 144 }),
    ).toThrow(NativePreviewPolicyError);
  });
});
