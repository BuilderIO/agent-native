import { beforeAll, describe, expect, it, vi } from "vitest";

import { OWNED_FEEDBACK_TEST_KERNEL } from "../../../../shared/native-effect-owned-test-fixtures";

let NativeTextureFeedbackExecutor: typeof import("./native-texture-feedback").NativeTextureFeedbackExecutor;
let NativeFeedbackFailure: typeof import("./native-texture-feedback").NativeFeedbackFailure;

beforeAll(async () => {
  vi.stubGlobal("GPUTextureUsage", {
    STORAGE_BINDING: 8,
    TEXTURE_BINDING: 4,
    COPY_DST: 2,
  });
  vi.stubGlobal("GPUBufferUsage", { UNIFORM: 64, COPY_DST: 8 });
  ({ NativeTextureFeedbackExecutor, NativeFeedbackFailure } =
    await import("./native-texture-feedback"));
});

function mockGpu() {
  let nextTexture = 0;
  const released: number[] = [];
  const allocated: number[] = [];
  const uniforms: { values: number[]; destroyed: boolean }[] = [];
  const groups: GPUBindGroupDescriptor[] = [];
  const dispatches: Array<[number, number]> = [];
  const draws: number[] = [];
  const computeDescriptors: GPUComputePassDescriptor[] = [];
  const renderDescriptors: GPURenderPassDescriptor[] = [];
  let pendingResolve: (() => void) | null = null;
  let pendingReject: ((error: Error) => void) | null = null;
  const queue = {
    writeBuffer: (
      _buffer: GPUBuffer,
      _offset: number,
      values: Float32Array,
    ) => {
      uniforms.push({ values: [...values], destroyed: false });
    },
    onSubmittedWorkDone: () =>
      new Promise<void>((resolve, reject) => {
        pendingResolve = resolve;
        pendingReject = reject;
      }),
  };
  const device = {
    limits: {
      maxTextureDimension2D: 8192,
      maxComputeWorkgroupsPerDimension: 65535,
    },
    queue,
    createShaderModule: () => ({
      getCompilationInfo: async () => ({ messages: [] }),
    }),
    createComputePipelineAsync: async () => ({
      getBindGroupLayout: () => ({}),
    }),
    createRenderPipelineAsync: async () => ({
      getBindGroupLayout: () => ({}),
    }),
    createSampler: () => ({}),
    createBuffer: () => ({
      destroy: () => {
        const item = uniforms.find((entry) => !entry.destroyed);
        if (item) item.destroyed = true;
      },
    }),
    createBindGroup: (descriptor: GPUBindGroupDescriptor) => {
      groups.push(descriptor);
      return {};
    },
  } as unknown as GPUDevice;
  const allocator = {
    allocate: (width: number, height: number) => {
      const id = ++nextTexture;
      allocated.push(id);
      return {
        id,
        width,
        height,
        createView: () => ({ textureId: id }),
      } as unknown as GPUTexture;
    },
    release: (texture: GPUTexture) => {
      released.push((texture as GPUTexture & { id: number }).id);
    },
  };
  const encoder = {
    beginRenderPass: (descriptor: GPURenderPassDescriptor) => {
      renderDescriptors.push(descriptor);
      return {
        setPipeline: () => undefined,
        setBindGroup: () => undefined,
        draw: (vertices: number) => draws.push(vertices),
        end: () => undefined,
      };
    },
    beginComputePass: (descriptor: GPUComputePassDescriptor) => {
      computeDescriptors.push(descriptor);
      return {
        setPipeline: () => undefined,
        setBindGroup: () => undefined,
        dispatchWorkgroups: (x: number, y: number) => dispatches.push([x, y]),
        end: () => undefined,
      };
    },
  } as unknown as GPUCommandEncoder;
  const source = (width = 160, height = 100) =>
    ({
      width,
      height,
      createView: () => ({ source: true }),
    }) as unknown as GPUTexture;
  const target = (width = 160, height = 100) =>
    ({
      width,
      height,
      format: "rgba16float",
      createView: () => ({ target: true }),
    }) as unknown as GPUTexture;
  return {
    device,
    allocator,
    encoder,
    source,
    target,
    groups,
    uniforms,
    dispatches,
    draws,
    computeDescriptors,
    renderDescriptors,
    allocated,
    released,
    settle: () => {
      const resolve = pendingResolve;
      pendingResolve = null;
      pendingReject = null;
      resolve?.();
    },
    loseDevice: () => {
      const reject = pendingReject;
      pendingResolve = null;
      pendingReject = null;
      reject?.(new Error("device lost"));
    },
  };
}

const params = {
  intensity: 0.7,
  blockSize: 48,
  drift: 0.35,
  churn: 0.4,
  blend: 1,
  seed: 7,
};

describe("bounded texture feedback executor", () => {
  it.each([
    { timeSeconds: 1e40 },
    { initialLocalSeconds: 1e40, mode: "interactive" as const, speed: 1 },
    { speed: 1e40, mode: "interactive" as const, initialLocalSeconds: 0 },
  ])(
    "rejects oversized timing before feedback uniforms or transaction state change: %j",
    async (timing) => {
      const gpu = mockGpu();
      const executor = await NativeTextureFeedbackExecutor.create(
        gpu.device,
        gpu.allocator,
        OWNED_FEEDBACK_TEST_KERNEL,
      );
      expect(() =>
        executor.encode({
          encoder: gpu.encoder,
          source: gpu.source(),
          target: gpu.target(),
          timeSeconds: 0,
          params,
          ...timing,
        }),
      ).toThrowError(
        expect.objectContaining({
          name: "NativeUniformTimingError",
          code: "native-uniform-timing-invalid",
        }),
      );
      expect(gpu.uniforms).toEqual([]);
      expect(gpu.groups).toEqual([]);
      expect(gpu.dispatches).toEqual([]);
      const valid = executor.encode({
        encoder: gpu.encoder,
        source: gpu.source(),
        target: gpu.target(),
        timeSeconds: 0,
        params,
      });
      expect(
        gpu.uniforms.every(({ values }) => values.every(Number.isFinite)),
      ).toBe(true);
      valid.abandon();
      executor.dispose();
    },
  );

  it("reserves timestamp pairs for each compute step and resolve without changing work when the sample fills", async () => {
    const gpu = mockGpu();
    const executor = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    const seen: Array<{ kind: "compute" | "resolve"; stepIndex: number }> = [];
    const frame = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 1 / 30,
      params,
      timestampWritesForPass: (pass) => {
        seen.push(pass);
        const index = seen.length - 1;
        return index < 2
          ? {
              timestampWrites: {
                querySet: {} as GPUQuerySet,
                beginningOfPassWriteIndex: index * 2,
                endOfPassWriteIndex: index * 2 + 1,
              },
            }
          : {};
      },
    });
    expect(seen).toEqual([
      { kind: "compute", stepIndex: 0 },
      { kind: "compute", stepIndex: 1 },
      { kind: "compute", stepIndex: 2 },
      { kind: "resolve", stepIndex: 2 },
    ]);
    expect(gpu.computeDescriptors.map((pass) => pass.timestampWrites)).toEqual([
      expect.objectContaining({
        beginningOfPassWriteIndex: 0,
        endOfPassWriteIndex: 1,
      }),
      expect.objectContaining({
        beginningOfPassWriteIndex: 2,
        endOfPassWriteIndex: 3,
      }),
      undefined,
    ]);
    expect(gpu.renderDescriptors[0]?.timestampWrites).toBeUndefined();
    expect(gpu.dispatches).toHaveLength(3);
    expect(gpu.draws).toEqual([3]);
    frame.abandon();
    executor.dispose();
  });

  it("allocates two persistent state sides and a separate display, then dispatches each seek step in order", async () => {
    const gpu = mockGpu();
    const executor = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    expect(gpu.allocated).toHaveLength(3);
    const frame = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 1 / 30,
      params,
    });
    expect(frame.steps).toBe(3);
    expect(gpu.draws).toEqual([3]);
    expect(gpu.dispatches).toEqual([
      [96, 96],
      [96, 96],
      [96, 96],
    ]);
    expect(gpu.uniforms.slice(0, 3).map((item) => item.values[0])).toEqual([
      0,
      Math.fround(1 / 60),
      Math.fround(2 / 60),
    ]);
    expect(
      gpu.groups
        .slice(0, 3)
        .map(
          (group) =>
            (group.entries[1].resource as unknown as { textureId: number })
              .textureId,
        ),
    ).toEqual([1, 2, 1]);
    const settled = frame.commit();
    expect(executor.lastCompletedStep).toBe(2);
    expect(() => executor.reset()).toThrowError(
      new NativeFeedbackFailure("feedback-busy"),
    );
    gpu.settle();
    await settled;
    executor.reset();
    expect(gpu.released).toEqual([1, 2, 3]);
    expect(executor.lastCompletedStep).toBe(0);
    executor.dispose();
    expect(gpu.released).toHaveLength(6);
  });

  it("does not advance or leak uniforms when a frame is abandoned", async () => {
    const gpu = mockGpu();
    const executor = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    const frame = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 0,
      params,
    });
    frame.abandon();
    expect(executor.lastCompletedStep).toBe(0);
    expect(gpu.uniforms.every((uniform) => uniform.destroyed)).toBe(true);
    executor.dispose();
  });

  it("refuses a mismatched or aliased resolve target before encoding any work", async () => {
    const gpu = mockGpu();
    const executor = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    const source = gpu.source();
    for (const target of [gpu.target(100, 100), source]) {
      expect(() =>
        executor.encode({
          encoder: gpu.encoder,
          source,
          target,
          timeSeconds: 0,
          params,
        }),
      ).toThrowError(new NativeFeedbackFailure("feedback-target-invalid"));
    }
    expect(gpu.dispatches).toHaveLength(0);
    expect(gpu.draws).toHaveLength(0);
    executor.dispose();
  });

  it("rejects a resized source until reset, preserving the previous state", async () => {
    const gpu = mockGpu();
    const executor = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    const first = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 0,
      params,
    });
    const settled = first.commit();
    gpu.settle();
    await settled;
    expect(() =>
      executor.encode({
        encoder: gpu.encoder,
        source: gpu.source(300, 80),
        target: gpu.target(300, 80),
        timeSeconds: 1 / 60,
        params,
      }),
    ).toThrowError(new NativeFeedbackFailure("feedback-source-resized"));
    expect(executor.lastCompletedStep).toBe(0);
    executor.reset();
    const after = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(300, 80),
      target: gpu.target(300, 80),
      timeSeconds: 0,
      params,
    });
    expect(after.steps).toBe(1);
    after.abandon();
    executor.dispose();
  });

  it("preserves the current state when cancellation arrives before a new frame", async () => {
    const gpu = mockGpu();
    const executor = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    expect(() =>
      executor.encode({
        encoder: gpu.encoder,
        source: gpu.source(),
        target: gpu.target(),
        timeSeconds: 0,
        params,
        signal: controller.signal,
      }),
    ).toThrowError("feedback-aborted");
    expect(executor.lastCompletedStep).toBe(0);
    expect(gpu.dispatches).toHaveLength(0);
    executor.dispose();
  });

  it("persists the first t0 seed for the next fixed step without advancing the clock", async () => {
    const gpu = mockGpu();
    const executor = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    const initial = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 0,
      params,
      sourceChanged: true,
    });
    expect(initial.steps).toBe(1);
    expect(gpu.dispatches).toHaveLength(1);
    expect(gpu.uniforms[0].values.slice(0, 2)).toEqual([0, 0]);
    expect(
      (gpu.groups[0].entries[1].resource as unknown as { textureId: number })
        .textureId,
    ).toBe(1);
    const initialSettled = initial.commit();
    gpu.settle();
    await initialSettled;
    expect(executor.lastCompletedStep).toBe(0);
    const sameFrame = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 0,
      params,
    });
    expect(sameFrame.steps).toBe(0);
    sameFrame.abandon();
    const sourceRefresh = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 0,
      params,
      sourceChanged: true,
    });
    expect(sourceRefresh.steps).toBe(1);
    expect(
      (gpu.groups[3].entries[1].resource as unknown as { textureId: number })
        .textureId,
    ).toBe(2);
    const refreshed = sourceRefresh.commit();
    gpu.settle();
    await refreshed;
    expect(executor.lastCompletedStep).toBe(0);
    const first = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 1 / 60,
      params,
    });
    expect(first.steps).toBe(1);
    expect(gpu.uniforms[5].values.slice(0, 2)).toEqual([
      Math.fround(1 / 60),
      Math.fround(1 / 60),
    ]);
    expect(
      (gpu.groups[5].entries[1].resource as unknown as { textureId: number })
        .textureId,
    ).toBe(2);
    const settled = first.commit();
    gpu.settle();
    await settled;
    const refresh = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 1 / 60,
      params,
      sourceChanged: true,
    });
    expect(refresh.steps).toBe(1);
    expect(gpu.uniforms[7].values[0]).toBe(Math.fround(1 / 60));
    expect(gpu.uniforms[7].values[1]).toBe(0);
    refresh.abandon();
    expect(executor.lastCompletedStep).toBe(1);
    executor.dispose();
  });

  it("initializes zero-time state exactly once before a first positive frame", async () => {
    const gpu = mockGpu();
    const executor = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    const first = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 1 / 60,
      params,
    });
    expect(first.steps).toBe(2);
    expect(gpu.uniforms[0].values.slice(0, 2)).toEqual([0, 0]);
    expect(gpu.uniforms[1].values.slice(0, 2)).toEqual([
      Math.fround(1 / 60),
      Math.fround(1 / 60),
    ]);
    expect(
      gpu.groups
        .slice(0, 2)
        .map(
          (group) =>
            (group.entries[1].resource as unknown as { textureId: number })
              .textureId,
        ),
    ).toEqual([1, 2]);
    first.abandon();
    expect(executor.lastCompletedStep).toBe(0);
    const retry = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 1 / 60,
      params,
    });
    expect(retry.steps).toBe(2);
    expect(gpu.uniforms[3].values.slice(0, 2)).toEqual([0, 0]);
    const retired = retry.commit();
    gpu.settle();
    await retired;
    expect(executor.lastCompletedStep).toBe(1);
    const repeated = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 1 / 60,
      params,
    });
    expect(repeated.steps).toBe(0);
    repeated.abandon();
    executor.dispose();
  });

  it("keeps a paused first callback at its bounded local time", async () => {
    const gpu = mockGpu();
    const executor = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    const paused = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 1 / 60,
      initialLocalSeconds: 0,
      mode: "interactive",
      speed: 0,
      params,
    });
    expect(paused.steps).toBe(1);
    expect(gpu.uniforms[0].values.slice(0, 2)).toEqual([0, 0]);
    const retired = paused.commit();
    gpu.settle();
    await retired;
    expect(executor.lastCompletedStep).toBe(0);
    expect(executor.playbackStatus).toMatchObject({
      disposition: "clamped",
      simulationLocalSeconds: 0,
      requestedLocalSeconds: 1 / 60,
    });
    executor.dispose();
  });

  it("reinitializes the persisted seed after a validated reset", async () => {
    const gpu = mockGpu();
    const executor = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    const first = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 0,
      params,
    });
    const firstSettled = first.commit();
    gpu.settle();
    await firstSettled;
    executor.reset();
    expect(gpu.released).toEqual([1, 2, 3]);
    const restarted = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(320, 200),
      target: gpu.target(320, 200),
      timeSeconds: 0,
      params: { ...params, seed: 37.5 },
    });
    expect(restarted.steps).toBe(1);
    expect(
      (gpu.groups[2].entries[1].resource as unknown as { textureId: number })
        .textureId,
    ).toBe(4);
    const restartedSettled = restarted.commit();
    gpu.settle();
    await restartedSettled;
    const next = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(320, 200),
      target: gpu.target(320, 200),
      timeSeconds: 1 / 60,
      params: { ...params, seed: 37.5 },
    });
    expect(
      (gpu.groups[4].entries[1].resource as unknown as { textureId: number })
        .textureId,
    ).toBe(5);
    next.abandon();
    executor.dispose();
    expect(gpu.released).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("refreshes paused compute controls without stepping, but a blend-only edit only resolves", async () => {
    const gpu = mockGpu();
    const executor = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    const start = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 1 / 60,
      params,
    });
    const started = start.commit();
    gpu.settle();
    await started;
    expect(executor.lastCompletedStep).toBe(1);
    const lastFixedStepInput = (
      gpu.groups[1].entries[1].resource as unknown as { textureId: number }
    ).textureId;
    const editedParams = { ...params, intensity: 0.42, blockSize: 67 };
    const edited = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 1 / 60,
      params: editedParams,
    });
    expect(edited.steps).toBe(1);
    expect(gpu.uniforms[3].values.slice(0, 5)).toEqual([
      Math.fround(1 / 60),
      0,
      params.seed,
      Math.fround(0.42),
      67,
    ]);
    const editedStateInput = (
      gpu.groups[3].entries[1].resource as unknown as { textureId: number }
    ).textureId;
    expect(editedStateInput).not.toBe(lastFixedStepInput);
    const editedSettled = edited.commit();
    gpu.settle();
    await editedSettled;
    expect(executor.lastCompletedStep).toBe(1);
    const blendOnly = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 1 / 60,
      params: { ...editedParams, blend: 0.25 },
    });
    expect(blendOnly.steps).toBe(0);
    blendOnly.abandon();
    const nextStep = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 2 / 60,
      params: editedParams,
    });
    expect(nextStep.steps).toBe(1);
    expect(
      (gpu.groups[6].entries[1].resource as unknown as { textureId: number })
        .textureId,
    ).toBe(editedStateInput);
    nextStep.abandon();
    executor.dispose();
  });

  it("does not commit compute controls when a dirty refresh is abandoned or rejected", async () => {
    const gpu = mockGpu();
    const executor = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    const initial = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 0,
      params,
    });
    const settled = initial.commit();
    gpu.settle();
    await settled;
    const changed = { ...params, drift: 0.61 };
    const abandoned = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 0,
      params: changed,
    });
    expect(abandoned.steps).toBe(1);
    abandoned.abandon();
    const retry = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 0,
      params: changed,
    });
    expect(retry.steps).toBe(1);
    const rejected = retry.rejectSubmitted(new Error("validation failed"));
    gpu.settle();
    await rejected;
    expect(executor.lastCompletedStep).toBe(0);
    expect(
      (
        executor as unknown as {
          committedComputeParams: readonly number[];
        }
      ).committedComputeParams,
    ).toEqual([
      params.intensity,
      params.blockSize,
      params.drift,
      params.churn,
      params.seed,
    ]);
    executor.dispose();
  });

  it("reports device loss, releases uniforms, and still permits final texture teardown", async () => {
    const gpu = mockGpu();
    const executor = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    const frame = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 0,
      params,
    });
    const settled = frame.commit();
    gpu.loseDevice();
    await expect(settled).rejects.toMatchObject({
      code: "feedback-device-lost",
    });
    expect(gpu.uniforms.every((uniform) => uniform.destroyed)).toBe(true);
    expect(() =>
      executor.encode({
        encoder: gpu.encoder,
        source: gpu.source(),
        target: gpu.target(),
        timeSeconds: 1 / 60,
        params,
      }),
    ).toThrowError("feedback-device-lost");
    executor.dispose();
    expect(gpu.released).toEqual([1, 2, 3]);
  });

  it("does not advance state when GPU validation rejects submitted commands", async () => {
    const gpu = mockGpu();
    const executor = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    const frame = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 0,
      params,
    });
    const retired = frame.rejectSubmitted(new Error("validation failed"));
    expect(executor.lastCompletedStep).toBe(0);
    expect(executor.playbackStatus).toBeNull();
    gpu.settle();
    await retired;
    expect(gpu.uniforms.every((uniform) => uniform.destroyed)).toBe(true);
    expect(() =>
      executor.encode({
        encoder: gpu.encoder,
        source: gpu.source(),
        target: gpu.target(),
        timeSeconds: 1 / 60,
        params,
      }),
    ).toThrowError("feedback-device-lost");
    executor.dispose();
    expect(gpu.released).toEqual([1, 2, 3]);
  });

  it("accepts bounded fractional source seeds and rejects values outside the original control range", async () => {
    const gpu = mockGpu();
    const executor = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    const frame = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 1 / 60,
      params: { ...params, seed: 37.5 },
    });
    expect(gpu.uniforms[0].values[2]).toBe(37.5);
    frame.abandon();
    for (const seed of [-0.1, 100.1, Number.NaN]) {
      expect(() =>
        executor.encode({
          encoder: gpu.encoder,
          source: gpu.source(),
          target: gpu.target(),
          timeSeconds: 1 / 60,
          params: { ...params, seed },
        }),
      ).toThrowError("feedback-params-invalid");
    }
    executor.dispose();
  });

  it("encodes a live frame after the export horizon while refusing deterministic replay past it", async () => {
    const gpu = mockGpu();
    const executor = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    const horizon = OWNED_FEEDBACK_TEST_KERNEL.timing.maxStepIndex;
    const state = executor as unknown as {
      completedStep: number;
      initializedState: boolean;
    };
    state.completedStep = horizon;
    state.initializedState = true;
    const timeSeconds = (horizon + 1) / 60;
    expect(() =>
      executor.encode({
        encoder: gpu.encoder,
        source: gpu.source(),
        target: gpu.target(),
        timeSeconds,
        mode: "deterministic",
        params,
      }),
    ).toThrowError("feedback-step-limit");
    expect(gpu.dispatches).toHaveLength(0);
    const live = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds,
      mode: "interactive",
      initialLocalSeconds: 0,
      speed: 1,
      params,
    });
    expect(live.steps).toBe(1);
    expect(gpu.dispatches).toHaveLength(1);
    live.abandon();
    expect(executor.lastCompletedStep).toBe(horizon);
    executor.dispose();
  });

  it("rolls back a partial resource allocation without claiming readiness", async () => {
    const gpu = mockGpu();
    const allocate = gpu.allocator.allocate;
    let calls = 0;
    gpu.allocator.allocate = ((width: number, height: number) => {
      calls += 1;
      if (calls === 3) throw new Error("device allocation failed");
      return allocate(width, height);
    }) as typeof gpu.allocator.allocate;
    await expect(
      NativeTextureFeedbackExecutor.create(
        gpu.device,
        gpu.allocator,
        OWNED_FEEDBACK_TEST_KERNEL,
      ),
    ).rejects.toMatchObject({ code: "feedback-resource-unavailable" });
    expect(gpu.released).toEqual([1, 2]);
  });
  it("resumes after a long interactive gap, reports committed metadata, and keeps rejected work retryable", async () => {
    const gpu = mockGpu();
    const executor = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    const input = (timeSeconds: number) => ({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds,
      mode: "interactive" as const,
      initialLocalSeconds: 0,
      speed: 1,
      params,
    });
    const first = executor.encode(input(0));
    const firstRetirement = first.commit();
    expect(executor.playbackStatus).toMatchObject({
      mode: "interactive",
      disposition: "exact",
      requestedLocalSeconds: 0,
      droppedLocalSeconds: 0,
    });
    gpu.settle();
    await firstRetirement;
    const gap = executor.encode(input(20));
    expect(gap.steps).toBe(3);
    expect(executor.playbackStatus?.requestedLocalSeconds).toBe(0);
    gap.abandon();
    expect(executor.playbackStatus?.requestedLocalSeconds).toBe(0);
    const retry = executor.encode(input(20));
    expect(retry.steps).toBe(3);
    const retired = retry.commit();
    expect(executor.lastCompletedStep).toBe(3);
    expect(executor.playbackStatus).toMatchObject({
      mode: "interactive",
      disposition: "clamped",
      requestedLocalSeconds: 20,
    });
    expect(executor.playbackStatus?.droppedLocalSeconds).toBeGreaterThan(19.94);
    gpu.settle();
    await retired;
    const following = executor.encode(input(20 + 1 / 60));
    expect(following.steps).toBe(1);
    following.abandon();
    executor.reset();
    expect(executor.playbackStatus).toBeNull();
    executor.dispose();
  });

  it("keeps deterministic sessions exact and clears interactive metadata on mode switch", async () => {
    const gpu = mockGpu();
    const executor = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    const live = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 0,
      mode: "interactive",
      initialLocalSeconds: 0,
      speed: 1,
      params,
    });
    const firstRetirement = live.commit();
    gpu.settle();
    await firstRetirement;
    expect(executor.playbackStatus?.mode).toBe("interactive");
    const deterministic = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 1 / 60,
      mode: "deterministic",
      params,
    });
    const retirement = deterministic.commit();
    expect(executor.playbackStatus).toBeNull();
    gpu.settle();
    await retirement;
    const resumed = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 1 / 60,
      mode: "interactive",
      initialLocalSeconds: 0,
      speed: 1,
      params,
    });
    expect(resumed.steps).toBe(0);
    resumed.abandon();
    expect(executor.playbackStatus).toBeNull();
    expect(() =>
      executor.encode({
        encoder: gpu.encoder,
        source: gpu.source(),
        target: gpu.target(),
        timeSeconds: 20,
        mode: "deterministic",
        params,
      }),
    ).toThrowError("feedback-step-limit");
    executor.dispose();
  });
  it("does not publish playback metadata for rejected interactive GPU work", async () => {
    const gpu = mockGpu();
    const executor = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    const failed = executor.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 0,
      mode: "interactive",
      initialLocalSeconds: 0,
      speed: 1,
      params,
    });
    const retirement = failed.rejectSubmitted(
      new Error("GPU validation failed"),
    );
    expect(executor.playbackStatus).toBeNull();
    expect(executor.lastCompletedStep).toBe(0);
    gpu.settle();
    await retirement;
    executor.dispose();
    const replacement = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    const retry = replacement.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 0,
      mode: "interactive",
      initialLocalSeconds: 0,
      speed: 1,
      params,
    });
    const nextRetirement = retry.commit();
    expect(replacement.playbackStatus).toMatchObject({
      disposition: "exact",
      droppedLocalSeconds: 0,
    });
    gpu.settle();
    await nextRetirement;
    replacement.dispose();
  });

  it("restarts a resized live feedback resource at a late clock with bounded catchup", async () => {
    const gpu = mockGpu();
    const original = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    const initial = original.encode({
      encoder: gpu.encoder,
      source: gpu.source(),
      target: gpu.target(),
      timeSeconds: 0,
      initialLocalSeconds: 0,
      mode: "interactive",
      speed: 1,
      params,
    });
    const initialRetirement = initial.commit();
    gpu.settle();
    await initialRetirement;
    original.dispose();

    const resized = await NativeTextureFeedbackExecutor.create(
      gpu.device,
      gpu.allocator,
      OWNED_FEEDBACK_TEST_KERNEL,
    );
    const late = resized.encode({
      encoder: gpu.encoder,
      source: gpu.source(320, 200),
      target: gpu.target(320, 200),
      timeSeconds: 620,
      initialLocalSeconds: 0,
      mode: "interactive",
      speed: 1,
      params,
    });
    expect(late.steps).toBe(4);
    expect(gpu.uniforms[gpu.uniforms.length - 5].values.slice(0, 2)).toEqual([
      0, 0,
    ]);
    expect(resized.playbackStatus).toBeNull();
    late.abandon();
    expect(resized.lastCompletedStep).toBe(0);
    const retry = resized.encode({
      encoder: gpu.encoder,
      source: gpu.source(320, 200),
      target: gpu.target(320, 200),
      timeSeconds: 620,
      initialLocalSeconds: 0,
      mode: "interactive",
      speed: 1,
      params,
    });
    expect(retry.steps).toBe(4);
    const retirement = retry.commit();
    expect(resized.lastCompletedStep).toBe(3);
    expect(resized.playbackStatus).toMatchObject({
      requestedLocalSeconds: 620,
      simulationLocalSeconds: 0.05,
      disposition: "clamped",
    });
    gpu.settle();
    await retirement;
    resized.dispose();
  });
});
