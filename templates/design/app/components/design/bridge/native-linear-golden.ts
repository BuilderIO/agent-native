import type {
  NativeExpectedLinearSamples,
  NativeLinearGoldenSummary,
} from "../../../../shared/native-shader-validation";

export const NATIVE_LINEAR_SAMPLE_BYTES_PER_ROW = 256;
const MAX_NATIVE_LINEAR_GOLDEN_SAMPLES = 32;

export class NativeLinearGoldenError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "NativeLinearGoldenError";
  }
}

export function planNativeLinearGoldenReadback(
  samples: NativeExpectedLinearSamples,
  width: number,
  height: number,
): {
  byteLength: number;
  origins: readonly { x: number; y: number; offset: number }[];
} {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    samples.length < 1 ||
    samples.length > MAX_NATIVE_LINEAR_GOLDEN_SAMPLES ||
    samples.some(
      (sample) =>
        !Number.isSafeInteger(sample.x) ||
        !Number.isSafeInteger(sample.y) ||
        sample.x < 0 ||
        sample.y < 0 ||
        sample.x >= width ||
        sample.y >= height,
    )
  )
    throw new NativeLinearGoldenError("linear-golden-coordinate-invalid");
  return {
    byteLength: samples.length * NATIVE_LINEAR_SAMPLE_BYTES_PER_ROW,
    origins: samples.map((sample, index) => ({
      x: sample.x,
      y: sample.y,
      offset: index * NATIVE_LINEAR_SAMPLE_BYTES_PER_ROW,
    })),
  };
}

export function decodeNativeFloat16(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 0x1f)
    return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

export function evaluateNativeLinearGoldenBytes(
  mapped: ArrayBuffer | ArrayBufferView,
  samples: NativeExpectedLinearSamples,
): NativeLinearGoldenSummary {
  const view = ArrayBuffer.isView(mapped)
    ? new DataView(mapped.buffer, mapped.byteOffset, mapped.byteLength)
    : new DataView(mapped);
  const countOutsideLimit =
    samples.length < 1 || samples.length > MAX_NATIVE_LINEAR_GOLDEN_SAMPLES;
  const readbackTruncated =
    view.byteLength < samples.length * NATIVE_LINEAR_SAMPLE_BYTES_PER_ROW;
  if (countOutsideLimit || readbackTruncated)
    throw new NativeLinearGoldenError("linear-golden-readback-truncated");
  let maxAbsError = 0;
  let passed = true;
  for (const [index, sample] of samples.entries()) {
    const base = index * NATIVE_LINEAR_SAMPLE_BYTES_PER_ROW;
    for (let channel = 0; channel < 4; channel += 1) {
      const actual = decodeNativeFloat16(
        view.getUint16(base + channel * 2, true),
      );
      if (!Number.isFinite(actual))
        throw new NativeLinearGoldenError("linear-golden-nonfinite");
      const error = Math.abs(actual - sample.expected[channel]);
      maxAbsError = Math.max(maxAbsError, error);
      if (error > sample.tolerance) passed = false;
    }
  }
  return { sampleCount: samples.length, maxAbsError, passed };
}
