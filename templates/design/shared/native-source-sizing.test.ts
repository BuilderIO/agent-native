import { describe, expect, it } from "vitest";

import {
  defaultNativeIntrinsicSourceSizing,
  isNativeSourceSizing,
} from "./native-source-sizing";

const legacySizing = {
  inputSpace: "rendered-surface" as const,
  aspectRatio: 2,
  fit: "cover" as const,
  worldSize: [0, 0] as [number, number],
  origin: [0.5, 0.5] as [number, number],
  offset: [0, 0] as [number, number],
  scale: 1,
  rotationDegrees: 0,
  sampling: {
    min: "linear" as const,
    mag: "linear" as const,
    mipmap: "none" as const,
  },
};

describe("saved source sizing data", () => {
  it("keeps old sizing values parseable without executing retired projection math", () => {
    expect(isNativeSourceSizing(legacySizing)).toBe(true);
    expect(isNativeSourceSizing({ ...legacySizing, fit: "unknown" })).toBe(
      false,
    );
    expect(isNativeSourceSizing({ ...legacySizing, scale: Number.NaN })).toBe(
      false,
    );
  });
  it("continues to derive measured intrinsic aspect and default sampling", () => {
    expect(defaultNativeIntrinsicSourceSizing(640, 320)).toMatchObject({
      ok: true,
      value: { aspectRatio: 2, fit: "cover", sampling: { mipmap: "none" } },
    });
    expect(defaultNativeIntrinsicSourceSizing(0, 320)).toEqual({
      ok: false,
      code: "source-sizing-intrinsic-dimensions-invalid",
    });
  });
});
