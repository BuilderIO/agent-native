import { afterEach, describe, expect, it, vi } from "vitest";

import {
  evaluateNativeMountedOutputBytes,
  NativeMountedOutputCleanupError,
  NativeMountedOutputError,
  planNativeMountedOutputReadback,
  withNativeMountedTextureReadback,
} from "./native-mounted-output-summary";

describe("exact mounted output readback", () => {
  it("counts only the mounted half-float output and compares golden samples from the same bytes", () => {
    const plan = planNativeMountedOutputReadback(3, 2);
    expect(plan).toEqual({
      width: 3,
      height: 2,
      bytesPerRow: 256,
      byteLength: 512,
    });
    const bytes = new Uint8Array(plan.byteLength);
    const view = new DataView(bytes.buffer);
    const write = (x: number, y: number, rgba: readonly number[]) => {
      const base = y * plan.bytesPerRow + x * 8;
      rgba.forEach((bits, channel) =>
        view.setUint16(base + channel * 2, bits, true),
      );
    };
    write(1, 0, [0x3800, 0, 0, 0x3800]);
    write(2, 0, [0x3c00, 0, 0, 0x3c00]);
    write(0, 1, [0x3800, 0, 0, 0x3800]);
    write(1, 1, [0x3c00, 0, 0, 0]);
    const result = evaluateNativeMountedOutputBytes(bytes, plan, [
      { x: 0, y: 0, expected: [0, 0, 0, 0], tolerance: 0 },
      { x: 1, y: 0, expected: [0.5, 0, 0, 0.5], tolerance: 0 },
    ]);
    expect(result).toMatchObject({
      nonTransparentPixels: 3,
      partialAlphaPixels: 2,
      nonZeroRgbaPixels: 4,
      linearGolden: { sampleCount: 2, maxAbsError: 0, passed: true },
    });
    expect(result.packedRgba16f.byteLength).toBe(48);
    expect([...result.packedRgba16f.slice(24, 32)]).toEqual([
      ...bytes.slice(256, 264),
    ]);
    expect(
      evaluateNativeMountedOutputBytes(bytes, plan, [
        { x: 1, y: 0, expected: [1, 0, 0, 0.5], tolerance: 0.01 },
      ]).linearGolden,
    ).toEqual({ sampleCount: 1, maxAbsError: 0.5, passed: false });
  });

  it("refuses oversized, truncated, out-of-bounds, and nonfinite output", () => {
    const plan = planNativeMountedOutputReadback(3, 2);
    const bytes = new Uint8Array(plan.byteLength);
    expect(() => planNativeMountedOutputReadback(4096, 4096)).toThrowError(
      NativeMountedOutputError,
    );
    expect(() =>
      evaluateNativeMountedOutputBytes(bytes.subarray(0, 511), plan),
    ).toThrowError("mounted-output-readback-truncated");
    expect(() =>
      evaluateNativeMountedOutputBytes(new Uint8Array(513), plan),
    ).toThrowError("mounted-output-readback-size-mismatch");
    expect(() =>
      evaluateNativeMountedOutputBytes(bytes, plan, [
        { x: 3, y: 0, expected: [0, 0, 0, 0], tolerance: 0 },
      ]),
    ).toThrowError("mounted-output-samples-invalid");
    new DataView(bytes.buffer).setUint16(6, 0x7c00, true);
    expect(() => evaluateNativeMountedOutputBytes(bytes, plan)).toThrowError(
      "mounted-output-nonfinite",
    );
  });
});

afterEach(() => vi.unstubAllGlobals());

function fakeMountedDevice(
  options: {
    validationError?: boolean;
    mapError?: boolean;
    holdMap?: boolean;
    unmapError?: boolean;
  } = {},
) {
  vi.stubGlobal("GPUBufferUsage", { COPY_DST: 8, MAP_READ: 1 });
  vi.stubGlobal("GPUMapMode", { READ: 1 });
  const plan = planNativeMountedOutputReadback(2, 2);
  const bytes = new ArrayBuffer(plan.byteLength);
  let rejectMap: ((reason: unknown) => void) | undefined;
  let startMap: (() => void) | undefined;
  const mapStarted = new Promise<void>((resolve) => {
    startMap = resolve;
  });
  const buffer = {
    destroy: vi.fn(() => rejectMap?.(new Error("map cancelled"))),
    unmap: vi.fn(() => {
      if (options.unmapError) throw new Error("unmap failed");
    }),
    mapAsync: vi.fn(() => {
      startMap?.();
      if (options.mapError) return Promise.reject(new Error("map failed"));
      if (options.holdMap)
        return new Promise<void>((_resolve, reject) => {
          rejectMap = reject;
        });
      return Promise.resolve();
    }),
    getMappedRange: vi.fn(() => bytes),
  };
  const copyTextureToBuffer = vi.fn();
  const submit = vi.fn();
  const popErrorScope = vi.fn(async () =>
    options.validationError ? { message: "invalid copy" } : null,
  );
  const device = {
    createBuffer: vi.fn(() => buffer),
    createCommandEncoder: vi.fn(() => ({
      copyTextureToBuffer,
      finish: () => ({}),
    })),
    pushErrorScope: vi.fn(),
    popErrorScope,
    queue: { submit },
  } as unknown as GPUDevice;
  return {
    device,
    buffer,
    copyTextureToBuffer,
    submit,
    popErrorScope,
    mapStarted,
    plan,
  };
}

describe("exact mounted GPU copy transaction", () => {
  it("copies once with aligned rows, consumes mapped bytes, and retires its buffer", async () => {
    const fake = fakeMountedDevice();
    const texture = {} as GPUTexture;
    const seen = vi.fn();
    const result = await withNativeMountedTextureReadback({
      device: fake.device,
      texture,
      plan: fake.plan,
      signal: new AbortController().signal,
      assertCurrent: seen,
      consume: async (mapped) => {
        expect(mapped.byteLength).toBe(fake.plan.byteLength);
        return evaluateNativeMountedOutputBytes(mapped, fake.plan)
          .nonTransparentPixels;
      },
    });
    expect(result).toBe(0);
    expect(fake.copyTextureToBuffer).toHaveBeenCalledWith(
      { texture },
      expect.objectContaining({
        bytesPerRow: 256,
        rowsPerImage: 2,
      }),
      [2, 2, 1],
    );
    expect(fake.submit).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledTimes(3);
    expect(fake.buffer.unmap).toHaveBeenCalledTimes(1);
    expect(fake.buffer.destroy).toHaveBeenCalledTimes(1);
  });

  it("refuses GPU validation, stale identity, and map errors without leaking a buffer", async () => {
    for (const mode of ["validation", "stale", "map"] as const) {
      const fake = fakeMountedDevice({
        validationError: mode === "validation",
        mapError: mode === "map",
      });
      await expect(
        withNativeMountedTextureReadback({
          device: fake.device,
          texture: {} as GPUTexture,
          plan: fake.plan,
          signal: new AbortController().signal,
          assertCurrent: () => {
            if (mode === "stale") throw new Error("stale exact output");
          },
          consume: async () => 1,
        }),
      ).rejects.toThrow(
        mode === "validation"
          ? "mounted-output-gpu-validation"
          : mode === "stale"
            ? "stale exact output"
            : "mounted-output-map-failed",
      );
      expect(fake.buffer.destroy).toHaveBeenCalledTimes(1);
      expect(fake.popErrorScope).toHaveBeenCalledTimes(1);
      if (mode === "stale") expect(fake.submit).not.toHaveBeenCalled();
    }
  });

  it("aborts a pending map and preserves a primary error if cleanup also fails", async () => {
    const aborted = fakeMountedDevice({ holdMap: true });
    const controller = new AbortController();
    const pending = withNativeMountedTextureReadback({
      device: aborted.device,
      texture: {} as GPUTexture,
      plan: aborted.plan,
      signal: controller.signal,
      assertCurrent: () => {},
      consume: async () => 1,
    });
    await aborted.mapStarted;
    controller.abort(new Error("cancelled validation"));
    await expect(pending).rejects.toThrow("cancelled validation");
    expect(aborted.buffer.destroy).toHaveBeenCalled();
    const cleanup = fakeMountedDevice({ unmapError: true });
    await expect(
      withNativeMountedTextureReadback({
        device: cleanup.device,
        texture: {} as GPUTexture,
        plan: cleanup.plan,
        signal: new AbortController().signal,
        assertCurrent: () => {},
        consume: async () => {
          throw new Error("primary parse failure");
        },
      }),
    ).rejects.toMatchObject({
      name: NativeMountedOutputCleanupError.name,
      causes: [
        expect.objectContaining({ message: "primary parse failure" }),
        expect.objectContaining({ message: "unmap failed" }),
      ],
    });
  });
});
