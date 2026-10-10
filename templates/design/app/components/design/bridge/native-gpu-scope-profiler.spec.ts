import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NativeGpuScopeProfiler,
  type NativeGpuScopedSample,
} from "./native-gpu-scope-profiler";
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

function submit(
  profiler: NativeGpuScopeProfiler,
  sample: NativeGpuScopedSample,
  encoder: GPUCommandEncoder,
) {
  expect(profiler.timestampWritesForPass(sample, "effect:main")).toMatchObject({
    kind: "pass",
    label: `${sample.instanceId}:effect:main`,
  });
  expect(profiler.finishSample(sample, encoder)).toBe(true);
  profiler.afterSubmit(sample);
}
describe("mount GPU timing scopes", () => {
  it("samples every ordered mount at its own cadence instead of selecting one modulo the scene counter", () => {
    const { device, encoder, buffers } = fixture();
    const profiler = new NativeGpuScopeProfiler(device);
    const scopes = Array.from({ length: 5 }, () => ({}));
    const definition = "definition-v1",
      instance = "instance-v1";
    const observations: number[][] = scopes.map(() => []);
    for (let frame = 0; frame <= 120; frame += 1)
      scopes.forEach((scope, index) => {
        const result = profiler.beginSample(
          scope,
          definition,
          instance,
          `mount-${index}`,
        );
        if (result.kind === "sample") {
          observations[index].push(frame);
          submit(profiler, result.sample, encoder);
        } else expect(result.code).toBe("sparse");
      });
    expect(observations).toEqual(Array.from({ length: 5 }, () => [0, 60, 120]));
    expect(buffers).toHaveLength(5 * 6);
    profiler.dispose();
    expect(
      buffers.every((buffer) => buffer.destroy.mock.calls.length === 1),
    ).toBe(true);
  });
  it("isolates capacity, leaves a full scope due, and does not borrow another mount's ring", async () => {
    const { device, encoder, buffers } = fixture();
    const profiler = new NativeGpuScopeProfiler(device, {
      sampleEveryFrames: 1,
    });
    const a = {},
      b = {},
      definition = "definition-v1",
      instance = "instance-v1";
    for (let i = 0; i < 3; i++) {
      const r = profiler.beginSample(a, definition, instance, "a");
      if (r.kind !== "sample") throw new Error("Expected sample");
      submit(profiler, r.sample, encoder);
    }
    expect(profiler.beginSample(a, definition, instance, "a")).toEqual({
      kind: "skipped",
      code: "capacity",
    });
    expect(profiler.latestResult(a, definition, instance)).toMatchObject({
      kind: "error",
      code: "capacity",
    });
    const other = profiler.beginSample(b, definition, instance, "b");
    expect(other.kind).toBe("sample");
    if (other.kind !== "sample") throw new Error("Expected other sample");
    submit(profiler, other.sample, encoder);
    buffers[1].data.set([0n, 1_000_000n]);
    buffers[1].map.resolve();
    await vi.waitFor(() => expect(buffers[1].unmap).toHaveBeenCalledOnce());
    expect(profiler.beginSample(a, definition, instance, "a").kind).toBe(
      "sample",
    );
    expect(profiler.latestResult(b, definition, instance).kind).toBe("pending");
    profiler.dispose();
  });
  it("keeps target labels and completion order independent across simultaneous mappings", async () => {
    const { device, encoder, buffers } = fixture();
    const profiler = new NativeGpuScopeProfiler(device, {
      sampleEveryFrames: 1,
    });
    const a = {},
      b = {},
      definition = "definition-v1",
      instance = "instance-v1";
    const starts = [
      profiler.beginSample(a, definition, instance, "a"),
      profiler.beginSample(b, definition, instance, "b"),
      profiler.beginSample(a, definition, instance, "a"),
    ];
    starts.forEach((r) => {
      if (r.kind !== "sample") throw new Error("Expected sample");
      submit(profiler, r.sample, encoder);
    });
    buffers[3].data.set([0n, 2_000_000n]);
    buffers[3].map.resolve();
    buffers[7].data.set([0n, 3_000_000n]);
    buffers[7].map.resolve();
    await vi.waitFor(() =>
      expect(profiler.latestResult(a, definition, instance)).toMatchObject({
        kind: "ready",
        frameIndex: 2,
        passes: [{ label: "a:effect:main", gpuMs: 2 }],
      }),
    );
    expect(profiler.latestResult(b, definition, instance)).toMatchObject({
      kind: "ready",
      frameIndex: 1,
      passes: [{ label: "b:effect:main", gpuMs: 3 }],
    });
    buffers[1].data.set([0n, 9_000_000n]);
    buffers[1].map.resolve();
    await vi.waitFor(() => expect(buffers[1].unmap).toHaveBeenCalledOnce());
    expect(profiler.latestResult(a, definition, instance)).toMatchObject({
      kind: "ready",
      frameIndex: 2,
      gpuPassSumMs: 2,
    });
    profiler.dispose();
  });
  it("bounds scopes, frees capacity on unmount, and ignores late mappings from a reused ID", async () => {
    const { device, encoder, buffers, lost } = fixture();
    const profiler = new NativeGpuScopeProfiler(device, { maxScopes: 1 });
    const a = {},
      b = {},
      definition = "definition-v1",
      instance = "instance-v1";
    const first = profiler.beginSample(a, definition, instance, "same-id");
    if (first.kind !== "sample") throw new Error("Expected sample");
    submit(profiler, first.sample, encoder);
    expect(profiler.beginSample(b, definition, instance, "same-id")).toEqual({
      kind: "skipped",
      code: "capacity",
    });
    expect(profiler.latestResult(b, definition, instance)).toMatchObject({
      kind: "error",
      code: "capacity",
    });
    expect(buffers).toHaveLength(6);
    profiler.forget(a);
    expect(profiler.beginSample(b, definition, instance, "same-id").kind).toBe(
      "sample",
    );
    buffers[1].data.set([0n, 9_000_000n]);
    buffers[1].map.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(profiler.latestResult(b, definition, instance).kind).toBe("pending");
    lost.resolve({ reason: "destroyed", message: "test" } as GPUDeviceLostInfo);
    await vi.waitFor(() =>
      expect(profiler.latestResult(b, definition, instance)).toEqual({
        kind: "unavailable",
        code: "device-lost",
      }),
    );
    profiler.dispose();
    expect(
      buffers.every((buffer) => buffer.destroy.mock.calls.length === 1),
    ).toBe(true);
  });
  it("invalidates private definition and control revisions before a target read", () => {
    const { device, buffers } = fixture();
    const profiler = new NativeGpuScopeProfiler(device);
    const scope = {},
      definition = "definition-v1",
      instance = "instance-v1";
    expect(profiler.beginSample(scope, definition, instance, "a").kind).toBe(
      "sample",
    );
    expect(profiler.latestResult(scope, definition, "instance-v2")).toEqual({
      kind: "pending",
      estimatedResourceBytes: 0,
    });
    expect(
      buffers.every((buffer) => buffer.destroy.mock.calls.length === 1),
    ).toBe(true);
    expect(
      profiler.beginSample(scope, "definition-v2", instance, "a").kind,
    ).toBe("sample");
    profiler.dispose();
  });
  it("does not allocate rings without timestamp support", () => {
    const { device, buffers } = fixture({ supported: false });
    const profiler = new NativeGpuScopeProfiler(device);
    expect(
      profiler.beginSample({}, "definition-v1", "instance-v1", "a"),
    ).toEqual({
      kind: "skipped",
      code: "unavailable",
    });
    expect(profiler.latestResult({}, "definition-v1", "instance-v1")).toEqual({
      kind: "unavailable",
      code: "timestamp-query-unavailable",
    });
    expect(buffers).toHaveLength(0);
    profiler.dispose();
  });
  it("keeps one device-loss observer across replaced rings and drains every retired resource once", () => {
    const { device, buffers, lost } = fixture();
    const observe = vi.spyOn(lost.promise, "then");
    const profiler = new NativeGpuScopeProfiler(device, { maxScopes: 1 });
    const scope = {};
    for (let revision = 0; revision < 32; revision++)
      expect(
        profiler.beginSample(
          scope,
          "definition-v1",
          `revision-${revision}`,
          "a",
        ).kind,
      ).toBe("sample");
    expect(observe).toHaveBeenCalledOnce();
    expect(
      buffers
        .slice(0, -6)
        .every((buffer) => buffer.destroy.mock.calls.length === 1),
    ).toBe(true);
    expect(
      buffers
        .slice(-6)
        .every((buffer) => buffer.destroy.mock.calls.length === 0),
    ).toBe(true);
    profiler.dispose();
    expect(
      buffers.every((buffer) => buffer.destroy.mock.calls.length === 1),
    ).toBe(true);
  });
});

describe("target GPU sample window ownership", () => {
  it("collects all target completions including older latest-suppressed output and excludes other mounts", async () => {
    const { device, encoder, buffers } = fixture();
    const profiler = new NativeGpuScopeProfiler(device, {
      sampleEveryFrames: 1,
    });
    const chosen = {},
      other = {};
    const token = profiler.beginWindow(
      chosen,
      "definition-v1",
      "instance-v1",
      "chosen",
    );
    expect(buffers).toHaveLength(0);
    expect(profiler.startWindowMeasurement(token)).toBe(-1);
    for (const [scope, id] of [
      [chosen, "chosen"],
      [other, "other"],
      [chosen, "chosen"],
    ] as const) {
      const start = profiler.beginSample(
        scope,
        "definition-v1",
        "instance-v1",
        id,
      );
      if (start.kind !== "sample") throw new Error("Expected sample");
      submit(profiler, start.sample, encoder);
    }
    for (const [index, duration] of [
      [3, 2],
      [7, 99],
      [1, 9],
    ]) {
      buffers[index].data.set([0n, BigInt(duration * 1_000_000)]);
      buffers[index].map.resolve();
      await vi.waitFor(() =>
        expect(buffers[index].unmap).toHaveBeenCalledOnce(),
      );
    }
    expect(
      profiler.latestResult(chosen, "definition-v1", "instance-v1"),
    ).toMatchObject({ frameIndex: 2, gpuPassSumMs: 2 });
    const result = profiler.endWindow(token);
    expect(result).toMatchObject({
      kind: "ready",
      throughFrameIndex: 2,
      gpuPassSumMs: { count: 2, p50: 2, p95: 9, max: 9 },
    });
    expect(result.samples.map((sample) => sample.frameIndex)).toEqual([0, 2]);
    profiler.dispose();
    expect(
      buffers.every((buffer) => buffer.destroy.mock.calls.length === 1),
    ).toBe(true);
  });

  it("retains pending-at-end and ignores prior and later window readbacks without changing frozen results", async () => {
    const { device, encoder, buffers } = fixture();
    const profiler = new NativeGpuScopeProfiler(device, {
      sampleEveryFrames: 1,
    });
    const target = {};
    const first = profiler.beginWindow(
      target,
      "definition-v1",
      "instance-v1",
      "chosen",
    );
    profiler.startWindowMeasurement(first);
    const a = profiler.beginSample(
      target,
      "definition-v1",
      "instance-v1",
      "chosen",
    );
    if (a.kind !== "sample") throw new Error("Expected sample");
    submit(profiler, a.sample, encoder);
    const frozen = profiler.endWindow(first);
    expect(frozen).toMatchObject({
      kind: "pending",
      samples: [{ frameIndex: 0, status: "submitted" }],
      gpuPassSumMs: null,
    });
    const serialized = JSON.stringify(frozen);
    const second = profiler.beginWindow(
      target,
      "definition-v1",
      "instance-v1",
      "chosen",
    );
    expect(profiler.startWindowMeasurement(second)).toBe(0);
    const b = profiler.beginSample(
      target,
      "definition-v1",
      "instance-v1",
      "chosen",
    );
    if (b.kind !== "sample") throw new Error("Expected sample");
    submit(profiler, b.sample, encoder);
    buffers[1].data.set([0n, 90_000_000n]);
    buffers[1].map.resolve();
    buffers[3].data.set([0n, 1_000_000n]);
    buffers[3].map.resolve();
    await vi.waitFor(() => expect(buffers[1].unmap).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(buffers[3].unmap).toHaveBeenCalledOnce());
    expect(profiler.endWindow(second)).toMatchObject({
      kind: "ready",
      samples: [{ frameIndex: 1 }],
      gpuPassSumMs: { count: 1, max: 1 },
    });
    expect(JSON.stringify(frozen)).toBe(serialized);
    profiler.dispose();
  });

  it.each(["definition", "instance", "unmount", "device"])(
    "invalidates an exact window on %s replacement",
    async (change) => {
      const { device, encoder, buffers, lost } = fixture();
      const profiler = new NativeGpuScopeProfiler(device, {
        sampleEveryFrames: 1,
      });
      const target = {};
      const token = profiler.beginWindow(
        target,
        "definition-v1",
        "instance-v1",
        "chosen",
      );
      profiler.startWindowMeasurement(token);
      const a = profiler.beginSample(
        target,
        "definition-v1",
        "instance-v1",
        "chosen",
      );
      if (a.kind !== "sample") throw new Error("Expected sample");
      submit(profiler, a.sample, encoder);
      if (change === "definition" || change === "instance")
        profiler.beginSample(
          target,
          change === "definition" ? "definition-v2" : "definition-v1",
          change === "instance" ? "instance-v2" : "instance-v1",
          "chosen",
        );
      else if (change === "unmount") {
        profiler.forget(target);
        profiler.beginSample({}, "definition-v1", "instance-v1", "chosen");
      } else {
        lost.resolve({
          reason: "destroyed",
          message: "fake loss",
        } as GPUDeviceLostInfo);
        await vi.waitFor(() =>
          expect(profiler.latestResult()).toMatchObject({
            code: "device-lost",
          }),
        );
      }
      buffers[1].data.set([0n, 99_000_000n]);
      buffers[1].map.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(profiler.endWindow(token)).toMatchObject({
        kind: change === "device" ? "unavailable" : "error",
        code: change === "device" ? "device-lost" : "target-changed",
        gpuPassSumMs: null,
      });
      profiler.dispose();
      expect(
        buffers.every((buffer) => buffer.destroy.mock.calls.length === 1),
      ).toBe(true);
    },
  );

  it("reports unsupported timestamps and target capacity loss without allocating extra rings or changing cadence", () => {
    const unsupported = fixture({ supported: false });
    const noGpu = new NativeGpuScopeProfiler(unsupported.device);
    const noToken = noGpu.beginWindow({}, "d", "i", "chosen");
    noGpu.startWindowMeasurement(noToken);
    expect(noGpu.endWindow(noToken)).toMatchObject({
      kind: "unavailable",
      code: "timestamp-query-unavailable",
      gpuPassSumMs: null,
    });
    expect(unsupported.buffers).toHaveLength(0);
    noGpu.dispose();
    const { device, buffers } = fixture();
    const profiler = new NativeGpuScopeProfiler(device, { maxScopes: 1 });
    profiler.beginSample({}, "d", "i", "other");
    const chosen = {};
    const token = profiler.beginWindow(chosen, "d", "i", "chosen");
    profiler.startWindowMeasurement(token);
    expect(profiler.beginSample(chosen, "d", "i", "chosen")).toMatchObject({
      kind: "skipped",
      code: "capacity",
    });
    expect(profiler.endWindow(token)).toMatchObject({
      kind: "error",
      code: "capacity",
      skippedCapacity: { measurement: 1 },
      gpuPassSumMs: null,
    });
    expect(buffers).toHaveLength(6);
    profiler.dispose();
  });

  it("permits one window and validates exact opaque tokens without disturbing lifetime or sampling cadence", () => {
    const { device, buffers } = fixture();
    const profiler = new NativeGpuScopeProfiler(device);
    const target = {};
    const token = profiler.beginWindow(target, "d", "i", "chosen");
    expect(() => profiler.beginWindow({}, "d", "i", "chosen")).toThrowError(
      "GPU sample window already active",
    );
    expect(() => profiler.startWindowMeasurement({})).toThrowError(
      "GPU sample window owner changed",
    );
    profiler.cancelWindow({});
    profiler.startWindowMeasurement(token);
    const at: number[] = [];
    for (let frame = 0; frame <= 120; frame++) {
      const start = profiler.beginSample(target, "d", "i", "chosen");
      if (start.kind === "sample") {
        at.push(frame);
        profiler.abandonSample(start.sample);
      } else expect(start.code).toBe("sparse");
    }
    expect(at).toEqual([0, 60, 120]);
    expect(buffers).toHaveLength(6);
    profiler.cancelWindow(token);
    const next = profiler.beginWindow(target, "d", "i", "chosen");
    profiler.startWindowMeasurement(next);
    profiler.endWindow(next);
    profiler.dispose();
    expect(
      buffers.every((buffer) => buffer.destroy.mock.calls.length === 1),
    ).toBe(true);
  });
});

describe("GPU window allocation failure", () => {
  it("keeps an unreadable timestamp ring distinct from no submitted target samples", () => {
    const { device } = fixture();
    vi.spyOn(device, "createBuffer").mockImplementationOnce(() => {
      throw new Error("fake GPU allocation failure");
    });
    const profiler = new NativeGpuScopeProfiler(device);
    const target = {};
    const token = profiler.beginWindow(target, "d", "i", "chosen");
    profiler.startWindowMeasurement(token);
    expect(profiler.beginSample(target, "d", "i", "chosen")).toMatchObject({
      kind: "skipped",
      code: "unavailable",
    });
    expect(profiler.endWindow(token)).toMatchObject({
      kind: "error",
      code: "profile-unavailable",
      gpuPassSumMs: null,
    });
    profiler.dispose();
  });
});

describe("target pass overflow before mapping drains", () => {
  it("freezes known capacity with a submitted-pending sample instead of waiting for its failed readback", () => {
    const { device, encoder } = fixture();
    const profiler = new NativeGpuScopeProfiler(device);
    const target = {};
    const token = profiler.beginWindow(target, "d", "i", "chosen");
    profiler.startWindowMeasurement(token);
    const start = profiler.beginSample(target, "d", "i", "chosen");
    if (start.kind !== "sample") throw new Error("Expected sample");
    for (let index = 0; index < 16; index++)
      expect(
        profiler.timestampWritesForPass(start.sample, `pass-${index}`).kind,
      ).toBe("pass");
    expect(
      profiler.timestampWritesForPass(start.sample, "overflow"),
    ).toMatchObject({ kind: "skipped", code: "capacity" });
    expect(
      profiler.timestampWritesForPass(start.sample, "overflow-again"),
    ).toMatchObject({ kind: "skipped", code: "capacity" });
    profiler.finishSample(start.sample, encoder);
    profiler.afterSubmit(start.sample);
    expect(profiler.endWindow(token)).toMatchObject({
      kind: "error",
      code: "capacity",
      samples: [{ status: "submitted" }],
      skippedCapacity: { measurement: 1 },
      gpuPassSumMs: null,
    });
    profiler.dispose();
  });
});
