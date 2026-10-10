import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NativeGpuProfiler,
  nativeGpuTimestampFeature,
} from "./native-gpu-profiler";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture({ supported = true } = {}) {
  const lost = deferred<GPUDeviceLostInfo>();
  const buffers: Array<{
    data: BigUint64Array;
    map: ReturnType<typeof deferred<void>>;
    mapped: boolean;
    destroy: ReturnType<typeof vi.fn>;
    unmap: ReturnType<typeof vi.fn>;
  }> = [];
  const device = {
    features: new Set(supported ? ["timestamp-query"] : []),
    lost: lost.promise,
    createQuerySet: vi.fn(() => ({ destroy: vi.fn() })),
    createBuffer: vi.fn(({ size }: { size: number }) => {
      const map = deferred<void>();
      const buffer = {
        data: new BigUint64Array(size / 8),
        map,
        mapped: false,
        get mapState() {
          return this.mapped ? "mapped" : "unmapped";
        },
        mapAsync: vi.fn(() =>
          map.promise.then(() => {
            buffer.mapped = true;
          }),
        ),
        getMappedRange: vi.fn(() => buffer.data.buffer),
        unmap: vi.fn(() => {
          buffer.mapped = false;
        }),
        destroy: vi.fn(),
      };
      buffers.push(buffer);
      return buffer;
    }),
  } as unknown as GPUDevice;
  const encoder = {
    resolveQuerySet: vi.fn(),
    copyBufferToBuffer: vi.fn(),
  } as unknown as GPUCommandEncoder;
  return { device, encoder, buffers, lost };
}

beforeEach(() => {
  vi.stubGlobal("GPUBufferUsage", {
    QUERY_RESOLVE: 512,
    COPY_SRC: 4,
    COPY_DST: 8,
    MAP_READ: 1,
  });
  vi.stubGlobal("GPUMapMode", { READ: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NativeGpuProfiler", () => {
  it("reports capacity instead of a partial total when feedback compute steps exceed the 16-pass frame limit", async () => {
    const { device, encoder, buffers } = fixture();
    const profiler = new NativeGpuProfiler(device, {
      sampleEveryFrames: 1,
      ringSlots: 1,
    });
    const started = profiler.beginSample(0);
    if (started.kind !== "sample")
      throw new Error("Expected a timestamp sample");
    for (let index = 0; index < 16; index += 1) {
      expect(
        profiler.timestampWritesForPass(
          started.sample,
          `feedback:compute:step-${index + 1}`,
        ).kind,
      ).toBe("pass");
    }
    expect(
      profiler.timestampWritesForPass(
        started.sample,
        "feedback:resolve:step-16",
      ),
    ).toEqual({ kind: "skipped", code: "capacity" });
    expect(profiler.latestResult()).toMatchObject({
      kind: "error",
      code: "capacity",
    });
    expect(profiler.finishSample(started.sample, encoder)).toBe(true);
    profiler.afterSubmit(started.sample);
    buffers[1].data.set(
      Array.from({ length: 32 }, (_, index) => BigInt(index * 1_000_000)),
    );
    buffers[1].map.resolve();
    await vi.waitFor(() => expect(buffers[1].unmap).toHaveBeenCalledOnce());
    expect(profiler.latestResult()).toMatchObject({
      kind: "error",
      code: "capacity",
    });
    profiler.dispose();
  });

  it("reports unsupported timestamp queries without interfering with rendering", () => {
    const { device } = fixture({ supported: false });
    const profiler = new NativeGpuProfiler(device);
    expect(profiler.latestResult()).toEqual({
      kind: "unavailable",
      code: "timestamp-query-unavailable",
    });
    expect(profiler.beginSample(0)).toEqual({
      kind: "skipped",
      code: "unavailable",
    });
    expect(
      device.createQuerySet as ReturnType<typeof vi.fn>,
    ).not.toHaveBeenCalled();
    expect(
      nativeGpuTimestampFeature({
        features: new Set(["timestamp-query"]),
      } as unknown as GPUAdapter),
    ).toEqual(["timestamp-query"]);
  });

  it("samples sparsely, sums real GPU pass timestamps asynchronously, and reuses a completed slot", async () => {
    const { device, encoder, buffers } = fixture();
    const profiler = new NativeGpuProfiler(device, {
      sampleEveryFrames: 2,
      maxPassesPerSample: 2,
      ringSlots: 1,
    });
    expect(profiler.beginSample(1)).toEqual({
      kind: "skipped",
      code: "sparse",
    });
    const started = profiler.beginSample(2);
    expect(started.kind).toBe("sample");
    if (started.kind !== "sample") return;
    const first = profiler.timestampWritesForPass(started.sample, "source");
    const second = profiler.timestampWritesForPass(started.sample, "effect");
    expect(first).toMatchObject({
      kind: "pass",
      label: "source",
      timestampWrites: { beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
    });
    expect(second).toMatchObject({
      kind: "pass",
      label: "effect",
      timestampWrites: { beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 },
    });
    expect(profiler.finishSample(started.sample, encoder)).toBe(true);
    expect(encoder.resolveQuerySet).toHaveBeenCalledWith(
      expect.anything(),
      0,
      4,
      expect.anything(),
      0,
    );
    expect(encoder.copyBufferToBuffer).toHaveBeenCalledWith(
      expect.anything(),
      0,
      expect.anything(),
      0,
      32,
    );
    profiler.afterSubmit(started.sample);
    expect(profiler.beginSample(4)).toEqual({
      kind: "skipped",
      code: "capacity",
    });
    expect(profiler.latestResult()).toMatchObject({
      kind: "error",
      code: "capacity",
    });
    buffers[1].data.set([1000000n, 3000000n, 4000000n, 9000000n]);
    buffers[1].map.resolve();
    await vi.waitFor(() =>
      expect(profiler.latestResult()).toMatchObject({
        kind: "ready",
        frameIndex: 2,
        passCount: 2,
        gpuPassSumMs: 7,
      }),
    );
    expect(profiler.latestResult()).toMatchObject({
      passes: [
        { label: "source", gpuMs: 2 },
        { label: "effect", gpuMs: 5 },
      ],
      estimatedResourceBytes: 96,
    });
    expect(profiler.beginSample(6).kind).toBe("sample");
  });

  it("drains an over-capacity profiling sample without publishing a partial GPU duration", async () => {
    const { device, encoder, buffers } = fixture();
    const profiler = new NativeGpuProfiler(device, {
      sampleEveryFrames: 1,
      maxPassesPerSample: 1,
      ringSlots: 1,
    });
    const started = profiler.beginSample(0);
    if (started.kind !== "sample") throw new Error("Expected a sample");
    expect(profiler.timestampWritesForPass(started.sample, "first").kind).toBe(
      "pass",
    );
    expect(profiler.timestampWritesForPass(started.sample, "second")).toEqual({
      kind: "skipped",
      code: "capacity",
    });
    expect(profiler.finishSample(started.sample, encoder)).toBe(true);
    profiler.afterSubmit(started.sample);
    buffers[1].data.set([1000000n, 2000000n]);
    buffers[1].map.resolve();
    await vi.waitFor(() => expect(buffers[1].unmap).toHaveBeenCalledOnce());
    expect(profiler.latestResult()).toMatchObject({
      kind: "error",
      code: "capacity",
    });
    expect(profiler.beginSample(1).kind).toBe("sample");
  });

  it("keeps readback failure distinct from a valid zero-duration GPU sample", async () => {
    const { device, encoder, buffers } = fixture();
    const profiler = new NativeGpuProfiler(device, {
      sampleEveryFrames: 1,
      ringSlots: 1,
    });
    const started = profiler.beginSample(0);
    if (started.kind !== "sample") throw new Error("Expected a sample");
    profiler.timestampWritesForPass(started.sample, "pass");
    profiler.finishSample(started.sample, encoder);
    profiler.afterSubmit(started.sample);
    buffers[1].map.reject(new Error("mapping failed"));
    await vi.waitFor(() =>
      expect(profiler.latestResult()).toMatchObject({
        kind: "error",
        code: "read-failed",
      }),
    );
    expect(buffers[1].unmap).toHaveBeenCalledOnce();
  });

  it("rejects inverted GPU timestamps and does not map the same submission twice", async () => {
    const { device, encoder, buffers } = fixture();
    const profiler = new NativeGpuProfiler(device, {
      sampleEveryFrames: 1,
      ringSlots: 1,
    });
    const started = profiler.beginSample(0);
    if (started.kind !== "sample") throw new Error("Expected a sample");
    profiler.timestampWritesForPass(started.sample, "pass");
    profiler.finishSample(started.sample, encoder);
    profiler.afterSubmit(started.sample);
    profiler.afterSubmit(started.sample);
    expect(
      (buffers[1] as unknown as { mapAsync: ReturnType<typeof vi.fn> })
        .mapAsync,
    ).toHaveBeenCalledOnce();
    buffers[1].data.set([2000000n, 1000000n]);
    buffers[1].map.resolve();
    await vi.waitFor(() =>
      expect(profiler.latestResult()).toMatchObject({
        kind: "error",
        code: "invalid-timestamps",
      }),
    );
  });

  it("destroys bounded resources on loss and ignores a late map completion", async () => {
    const { device, encoder, buffers, lost } = fixture();
    const profiler = new NativeGpuProfiler(device, {
      sampleEveryFrames: 1,
      ringSlots: 1,
    });
    const started = profiler.beginSample(0);
    if (started.kind !== "sample") throw new Error("Expected a sample");
    profiler.timestampWritesForPass(started.sample, "pass");
    profiler.finishSample(started.sample, encoder);
    profiler.afterSubmit(started.sample);
    lost.resolve({ reason: "destroyed", message: "test" } as GPUDeviceLostInfo);
    await vi.waitFor(() =>
      expect(profiler.latestResult()).toEqual({
        kind: "unavailable",
        code: "device-lost",
      }),
    );
    expect(
      buffers.every((buffer) => buffer.destroy.mock.calls.length === 1),
    ).toBe(true);
    buffers[1].map.resolve();
    await Promise.resolve();
    expect(profiler.latestResult()).toEqual({
      kind: "unavailable",
      code: "device-lost",
    });
  });
  it("keeps the newer completed sample when older mapping completes or fails later", async () => {
    for (const olderFails of [false, true]) {
      const { device, encoder, buffers } = fixture();
      const profiler = new NativeGpuProfiler(device, {
        sampleEveryFrames: 1,
        ringSlots: 2,
      });
      const a = profiler.beginSample(10),
        b = profiler.beginSample(11);
      if (a.kind !== "sample" || b.kind !== "sample")
        throw new Error("Expected samples");
      for (const start of [a, b]) {
        profiler.timestampWritesForPass(
          start.sample,
          `frame-${start.sample.frameIndex}`,
        );
        profiler.finishSample(start.sample, encoder);
        profiler.afterSubmit(start.sample);
      }
      buffers[3].data.set([0n, 2_000_000n]);
      buffers[3].map.resolve();
      await vi.waitFor(() =>
        expect(profiler.latestResult()).toMatchObject({
          kind: "ready",
          frameIndex: 11,
          gpuPassSumMs: 2,
        }),
      );
      if (olderFails) buffers[1].map.reject(new Error("older failure"));
      else {
        buffers[1].data.set([0n, 9_000_000n]);
        buffers[1].map.resolve();
      }
      await vi.waitFor(() => expect(buffers[1].unmap).toHaveBeenCalledOnce());
      expect(profiler.latestResult()).toMatchObject({
        kind: "ready",
        frameIndex: 11,
        gpuPassSumMs: 2,
      });
      profiler.dispose();
    }
  });
});

describe("GPU completion events", () => {
  it("emits older completed and failed samples exactly once independently of latest state", async () => {
    const { device, encoder, buffers } = fixture();
    const event = vi.fn();
    const profiler = new NativeGpuProfiler(device, {
      sampleEveryFrames: 1,
      onSampleEvent: event,
    });
    for (let index = 0; index < 3; index++) {
      const start = profiler.beginSample(index);
      if (start.kind !== "sample") throw new Error("Expected sample");
      profiler.timestampWritesForPass(start.sample, `chosen:${index}`);
      profiler.finishSample(start.sample, encoder);
      profiler.afterSubmit(start.sample);
      profiler.afterSubmit(start.sample);
    }
    buffers[5].data.set([0n, 2_000_000n]);
    buffers[5].map.resolve();
    await vi.waitFor(() => expect(buffers[5].unmap).toHaveBeenCalledOnce());
    buffers[1].data.set([0n, 9_000_000n]);
    buffers[1].map.resolve();
    buffers[3].map.reject(new Error("fake failed map"));
    await vi.waitFor(() => expect(buffers[3].unmap).toHaveBeenCalledOnce());
    expect(profiler.latestResult()).toMatchObject({
      frameIndex: 2,
      gpuPassSumMs: 2,
    });
    expect(
      event.mock.calls.map((call) => [
        call[0].kind,
        call[0].frameIndex,
        call[0].result?.kind,
      ]),
    ).toEqual([
      ["submitted", 0, undefined],
      ["submitted", 1, undefined],
      ["submitted", 2, undefined],
      ["completed", 2, "ready"],
      ["completed", 0, "ready"],
      ["completed", 1, "error"],
    ]);
    profiler.dispose();
  });

  it("emits one read-failed result after unmap fails and never a preceding ready result", async () => {
    const { device, encoder, buffers } = fixture();
    const event = vi.fn();
    const profiler = new NativeGpuProfiler(device, {
      sampleEveryFrames: 1,
      onSampleEvent: event,
    });
    const start = profiler.beginSample(0);
    if (start.kind !== "sample") throw new Error("Expected sample");
    profiler.timestampWritesForPass(start.sample, "chosen:main");
    profiler.finishSample(start.sample, encoder);
    profiler.afterSubmit(start.sample);
    buffers[1].unmap.mockImplementationOnce(() => {
      buffers[1].mapped = false;
      throw new Error("fake unmap failure");
    });
    buffers[1].data.set([0n, 2_000_000n]);
    buffers[1].map.resolve();
    await vi.waitFor(() => expect(event).toHaveBeenCalledTimes(2));
    expect(event.mock.calls[1][0]).toMatchObject({
      kind: "completed",
      frameIndex: 0,
      result: { kind: "error", code: "read-failed" },
    });
    profiler.dispose();
  });

  it("emits abandoned and zero-pass attempts once, and does not emit completion after device loss", async () => {
    const { device, encoder, buffers, lost } = fixture();
    const event = vi.fn();
    const profiler = new NativeGpuProfiler(device, {
      sampleEveryFrames: 1,
      onSampleEvent: event,
    });
    const a = profiler.beginSample(0);
    if (a.kind !== "sample") throw new Error("Expected sample");
    profiler.abandonSample(a.sample);
    profiler.abandonSample(a.sample);
    const b = profiler.beginSample(1);
    if (b.kind !== "sample") throw new Error("Expected sample");
    expect(profiler.finishSample(b.sample, encoder)).toBe(false);
    profiler.abandonSample(b.sample);
    const c = profiler.beginSample(2);
    if (c.kind !== "sample") throw new Error("Expected sample");
    profiler.timestampWritesForPass(c.sample, "chosen:main");
    profiler.finishSample(c.sample, encoder);
    profiler.afterSubmit(c.sample);
    lost.resolve({
      reason: "destroyed",
      message: "fake loss",
    } as GPUDeviceLostInfo);
    await vi.waitFor(() =>
      expect(profiler.latestResult()).toMatchObject({ code: "device-lost" }),
    );
    buffers[1].map.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(
      event.mock.calls.map((call) => [call[0].kind, call[0].frameIndex]),
    ).toEqual([
      ["abandoned", 0],
      ["abandoned", 1],
      ["submitted", 2],
    ]);
    profiler.dispose();
    expect(
      buffers.every((buffer) => buffer.destroy.mock.calls.length === 1),
    ).toBe(true);
  });
});
