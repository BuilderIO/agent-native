import { decodeNativeFloat16 } from "./native-linear-golden";

declare const GPUBufferUsage: Readonly<{ COPY_DST: number; MAP_READ: number }>;
declare const GPUMapMode: Readonly<{ READ: number }>;

export const MAX_VALIDATION_MOUNT_PIXELS = 4_194_304;
const MAX_VALIDATION_MOUNT_SIDE = 4_096;
const MAX_VALIDATION_READBACK_BYTES = 64 * 1_024 * 1_024;

export class NativeMountedOutputError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "NativeMountedOutputError";
  }
}

export class NativeMountedOutputCleanupError extends Error {
  readonly code = "mounted-output-cleanup-failed";

  constructor(readonly causes: unknown[]) {
    super("mounted-output-cleanup-failed");
    this.name = "NativeMountedOutputCleanupError";
  }
}

export async function withNativeMountedTextureReadback<Result>(args: {
  device: GPUDevice;
  texture: GPUTexture;
  plan: ReturnType<typeof planNativeMountedOutputReadback>;
  signal: AbortSignal;
  assertCurrent: () => void;
  consume: (mapped: ArrayBuffer) => Promise<Result>;
}): Promise<Result> {
  const { device, texture, plan, signal, assertCurrent, consume } = args;
  if (signal.aborted) throw signal.reason;
  let buffer: GPUBuffer | null = null;
  let mapped = false;
  let scopeOpen = false;
  let failure: unknown;
  let failed = false;
  let result: Result | undefined;
  try {
    buffer = device.createBuffer({
      size: plan.byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    device.pushErrorScope("validation");
    scopeOpen = true;
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture },
      { buffer, bytesPerRow: plan.bytesPerRow, rowsPerImage: plan.height },
      [plan.width, plan.height, 1],
    );
    assertCurrent();
    if (signal.aborted) throw signal.reason;
    device.queue.submit([encoder.finish()]);
    const gpuError = await device.popErrorScope();
    scopeOpen = false;
    if (gpuError)
      throw new NativeMountedOutputError("mounted-output-gpu-validation");
    const onAbort = () => buffer?.destroy();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      if (signal.aborted) onAbort();
      await buffer.mapAsync(GPUMapMode.READ);
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new NativeMountedOutputError("mounted-output-map-failed");
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    mapped = true;
    if (signal.aborted) throw signal.reason;
    assertCurrent();
    result = await consume(buffer.getMappedRange());
    if (signal.aborted) throw signal.reason;
    assertCurrent();
  } catch (error) {
    failed = true;
    failure = error;
  }
  const cleanup: unknown[] = [];
  if (scopeOpen)
    try {
      const gpuError = await device.popErrorScope();
      if (gpuError)
        cleanup.push(
          new NativeMountedOutputError("mounted-output-gpu-validation"),
        );
    } catch (error) {
      cleanup.push(error);
    }
  if (mapped)
    try {
      buffer?.unmap();
    } catch (error) {
      cleanup.push(error);
    }
  try {
    buffer?.destroy();
  } catch (error) {
    cleanup.push(error);
  }
  if (cleanup.length)
    throw new NativeMountedOutputCleanupError(
      failed ? [failure, ...cleanup] : cleanup,
    );
  if (failed) throw failure;
  if (result === undefined)
    throw new NativeMountedOutputError("mounted-output-incomplete");
  return result;
}

export type NativeMountedOutputSample = {
  x: number;
  y: number;
  expected: readonly [number, number, number, number];
  tolerance: number;
};

export function planNativeMountedOutputReadback(
  width: number,
  height: number,
): {
  width: number;
  height: number;
  bytesPerRow: number;
  byteLength: number;
} {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_VALIDATION_MOUNT_SIDE ||
    height > MAX_VALIDATION_MOUNT_SIDE ||
    width * height > MAX_VALIDATION_MOUNT_PIXELS
  )
    throw new NativeMountedOutputError("mounted-output-size-invalid");
  const bytesPerRow = Math.ceil((width * 8) / 256) * 256;
  const byteLength = bytesPerRow * height;
  if (byteLength > MAX_VALIDATION_READBACK_BYTES)
    throw new NativeMountedOutputError("mounted-output-budget-exceeded");
  return { width, height, bytesPerRow, byteLength };
}

export function evaluateNativeMountedOutputBytes(
  mapped: ArrayBuffer | ArrayBufferView,
  plan: ReturnType<typeof planNativeMountedOutputReadback>,
  samples?: readonly NativeMountedOutputSample[],
): {
  packedRgba16f: Uint8Array<ArrayBuffer>;
  nonTransparentPixels: number;
  partialAlphaPixels: number;
  nonZeroRgbaPixels: number;
  linearGolden?: { sampleCount: number; maxAbsError: number; passed: boolean };
} {
  const bytes = ArrayBuffer.isView(mapped)
    ? new Uint8Array(mapped.buffer, mapped.byteOffset, mapped.byteLength)
    : new Uint8Array(mapped);
  if (bytes.byteLength !== plan.byteLength)
    throw new NativeMountedOutputError(
      bytes.byteLength < plan.byteLength
        ? "mounted-output-readback-truncated"
        : "mounted-output-readback-size-mismatch",
    );
  if (
    samples &&
    (samples.length < 1 ||
      samples.length > 32 ||
      samples.some(
        (item) =>
          !Number.isSafeInteger(item.x) ||
          !Number.isSafeInteger(item.y) ||
          item.x < 0 ||
          item.y < 0 ||
          item.x >= plan.width ||
          item.y >= plan.height ||
          !Number.isFinite(item.tolerance) ||
          item.tolerance < 0 ||
          item.expected.some((value) => !Number.isFinite(value)),
      ))
  )
    throw new NativeMountedOutputError("mounted-output-samples-invalid");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const packedRgba16f = new Uint8Array(plan.width * plan.height * 8);
  let nonTransparentPixels = 0;
  let partialAlphaPixels = 0;
  let nonZeroRgbaPixels = 0;
  for (let y = 0; y < plan.height; y += 1) {
    const rowStart = y * plan.bytesPerRow;
    packedRgba16f.set(
      bytes.subarray(rowStart, rowStart + plan.width * 8),
      y * plan.width * 8,
    );
    for (let x = 0; x < plan.width; x += 1) {
      const base = rowStart + x * 8;
      let nonZero = false;
      for (let channel = 0; channel < 4; channel += 1) {
        const value = decodeNativeFloat16(
          view.getUint16(base + 2 * channel, true),
        );
        if (!Number.isFinite(value))
          throw new NativeMountedOutputError("mounted-output-nonfinite");
        if (value !== 0) nonZero = true;
      }
      if (nonZero) nonZeroRgbaPixels += 1;
      const alpha = decodeNativeFloat16(view.getUint16(base + 6, true));
      if (alpha < 0 || alpha > 1)
        throw new NativeMountedOutputError("mounted-output-alpha-invalid");
      if (alpha > 0) nonTransparentPixels += 1;
      if (alpha > 0 && alpha < 1) partialAlphaPixels += 1;
    }
  }
  if (!samples)
    return {
      packedRgba16f,
      nonTransparentPixels,
      partialAlphaPixels,
      nonZeroRgbaPixels,
    };
  let maxAbsError = 0;
  let passed = true;
  for (const sample of samples) {
    const base = sample.y * plan.bytesPerRow + sample.x * 8;
    for (let channel = 0; channel < 4; channel += 1) {
      const actual = decodeNativeFloat16(
        view.getUint16(base + 2 * channel, true),
      );
      const error = Math.abs(actual - sample.expected[channel]);
      maxAbsError = Math.max(maxAbsError, error);
      if (error > sample.tolerance) passed = false;
    }
  }
  return {
    packedRgba16f,
    nonTransparentPixels,
    partialAlphaPixels,
    nonZeroRgbaPixels,
    linearGolden: { sampleCount: samples.length, maxAbsError, passed },
  };
}
