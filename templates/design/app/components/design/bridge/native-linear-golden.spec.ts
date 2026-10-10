import { describe, expect, it } from "vitest";

import type { NativeExpectedLinearSamples } from "../../../../shared/native-shader-validation";
import {
  decodeNativeFloat16,
  evaluateNativeLinearGoldenBytes,
  NativeLinearGoldenError,
  NATIVE_LINEAR_SAMPLE_BYTES_PER_ROW,
  planNativeLinearGoldenReadback,
} from "./native-linear-golden";

const samples: NativeExpectedLinearSamples = [
  { x: 3, y: 2, expected: [0.5, 1, -2, 0.25], tolerance: 0.001 },
  { x: 9, y: 7, expected: [2, -0.5, 0, 1], tolerance: 0.001 },
];

describe("bounded premultiplied-linear GPU samples", () => {
  it("plans distinct aligned one-pixel copies and compares signed HDR half floats", () => {
    const plan = planNativeLinearGoldenReadback(samples, 10, 8);
    expect(plan).toEqual({
      byteLength: 512,
      origins: [
        { x: 3, y: 2, offset: 0 },
        { x: 9, y: 7, offset: 256 },
      ],
    });
    const buffer = new ArrayBuffer(plan.byteLength);
    const view = new DataView(buffer);
    [0x3800, 0x3c00, 0xc000, 0x3400].forEach((bits, channel) =>
      view.setUint16(channel * 2, bits, true),
    );
    [0x4000, 0xb800, 0x0000, 0x3c00].forEach((bits, channel) =>
      view.setUint16(
        NATIVE_LINEAR_SAMPLE_BYTES_PER_ROW + channel * 2,
        bits,
        true,
      ),
    );
    expect(evaluateNativeLinearGoldenBytes(buffer, samples)).toEqual({
      sampleCount: 2,
      maxAbsError: 0,
      passed: true,
    });
    view.setUint16(NATIVE_LINEAR_SAMPLE_BYTES_PER_ROW, 0x4200, true);
    expect(evaluateNativeLinearGoldenBytes(buffer, samples)).toEqual({
      sampleCount: 2,
      maxAbsError: 1,
      passed: false,
    });
  });

  it("rejects out-of-bounds samples, truncated maps, and nonfinite GPU values", () => {
    expect(() => planNativeLinearGoldenReadback(samples, 9, 8)).toThrowError(
      NativeLinearGoldenError,
    );
    expect(() =>
      evaluateNativeLinearGoldenBytes(new ArrayBuffer(256), samples),
    ).toThrowError("linear-golden-readback-truncated");
    const buffer = new ArrayBuffer(256);
    new DataView(buffer).setUint16(0, 0x7c00, true);
    expect(() =>
      evaluateNativeLinearGoldenBytes(buffer, samples.slice(0, 1)),
    ).toThrowError("linear-golden-nonfinite");
    expect(decodeNativeFloat16(0x0001)).toBe(2 ** -24);
    expect(decodeNativeFloat16(0x8001)).toBe(-(2 ** -24));
  });
});
