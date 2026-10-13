import { beforeAll, describe, expect, it, vi } from "vitest";

import type {
  EffectDefinition,
  EffectPass,
} from "../../../../shared/native-effects";

let Session: typeof import("./native-stateful-resource").NativeStatefulResourceSession;
let Failure: typeof import("./native-stateful-resource").NativeStatefulResourceError;
let planCaptures: typeof import("./native-stateful-resource").planNativeStatefulSourceCaptureTimes;
let resolveTargetStep: typeof import("./native-stateful-resource").resolveNativeStatefulTargetStep;
let acquireOutput: typeof import("./native-stateful-resource").acquireNativeStatefulOutput;

beforeAll(async () => {
  vi.stubGlobal("GPUTextureUsage", {
    TEXTURE_BINDING: 1,
    STORAGE_BINDING: 2,
    RENDER_ATTACHMENT: 4,
    COPY_SRC: 8,
    COPY_DST: 16,
  });
  vi.stubGlobal("GPUBufferUsage", {
    STORAGE: 1,
    UNIFORM: 2,
    COPY_SRC: 4,
    COPY_DST: 8,
    MAP_READ: 16,
  });
  vi.stubGlobal("GPUMapMode", { READ: 1 });
  ({
    NativeStatefulResourceSession: Session,
    NativeStatefulResourceError: Failure,
    planNativeStatefulSourceCaptureTimes: planCaptures,
    resolveNativeStatefulTargetStep: resolveTargetStep,
    acquireNativeStatefulOutput: acquireOutput,
  } = await import("./native-stateful-resource"));
});

it("bounds deterministic stateful seeks while allowing safe continuous live steps", () => {
  const fixedDt = 1 / 60;
  expect(resolveTargetStep(600, fixedDt, 36_000, true)).toBe(36_000);
  expect(resolveTargetStep(601, fixedDt, 36_000, true)).toBeNull();
  expect(resolveTargetStep(601, fixedDt, 36_000, false)).toBe(36_060);
  expect(
    resolveTargetStep(Number.POSITIVE_INFINITY, fixedDt, 36_000, false),
  ).toBeNull();
  expect(
    resolveTargetStep(Number.MAX_SAFE_INTEGER, fixedDt, 36_000, false),
  ).toBeNull();
});

it("reuses graph and finish textures across committed and failed stateful frames", () => {
  type Texture = { id: number; width: number; height: number; format: string };
  const source: Texture = {
    id: 0,
    width: 32,
    height: 32,
    format: "rgba8unorm",
  };
  const resources = new Map<string, Texture>();
  const retired: Texture[] = [];
  let created = 0;
  let presented: Texture | null = null;
  const create = (): Texture => ({
    id: ++created,
    width: 32,
    height: 32,
    format: "rgba8unorm",
  });
  const next = () =>
    acquireOutput(
      resources,
      "color",
      presented,
      source,
      32,
      32,
      "rgba8unorm",
      create,
      (texture) => retired.push(texture),
    );
  for (let index = 0; index < 100; index += 1) {
    const graphOutput = next();
    if (index === 3) {
      expect(next()).toBe(graphOutput);
      continue;
    }
    const finished = resources.get("__native_final_back") ?? create();
    const prior = presented;
    presented = finished;
    if (prior) resources.set("__native_final_back", prior);
    else resources.delete("__native_final_back");
  }
  expect(created).toBe(3);
  expect(retired).toEqual([]);
  expect(new Set(resources.values())).toEqual(
    new Set([resources.get("color"), resources.get("__native_final_back")]),
  );
  expect(presented).not.toBe(resources.get("color"));
});

it("keeps prior output mappings when a replacement allocation fails", () => {
  const old = { width: 64, height: 64, format: "rgba16float" };
  const resources = new Map([
    ["color", old],
    ["__native_final_back", old],
  ]);
  const retire = vi.fn();
  expect(() =>
    acquireOutput(
      resources,
      "color",
      null,
      { width: 32, height: 32, format: "rgba8unorm" },
      32,
      32,
      "rgba8unorm",
      () => {
        throw new Error("allocation-failed");
      },
      retire,
    ),
  ).toThrow("allocation-failed");
  expect(resources.get("color")).toBe(old);
  expect(resources.get("__native_final_back")).toBe(old);
  expect(retire).not.toHaveBeenCalled();
});

it("schedules each missing source step at its own global clock time", () => {
  const fixedDt = 1 / 60;
  expect(
    planCaptures(
      [{ completedStep: 0, fixedDt, timeOffset: 0, speed: 1, paused: false }],
      1 / 30,
    ),
  ).toEqual([fixedDt]);
  expect(
    planCaptures(
      [
        { completedStep: 0, fixedDt, timeOffset: 0, speed: 1, paused: false },
        { completedStep: 0, fixedDt, timeOffset: 0, speed: 2, paused: false },
      ],
      1 / 30,
    ),
  ).toEqual([1 / 120, fixedDt, 1 / 40]);
  expect(
    planCaptures(
      [{ completedStep: -1, fixedDt, timeOffset: 0, speed: 1, paused: false }],
      1 / 24,
    ),
  ).toEqual([0, fixedDt, 2 * fixedDt]);
  expect(
    planCaptures(
      [{ completedStep: 2, fixedDt, timeOffset: 0, speed: 1, paused: false }],
      1 / 24,
    ),
  ).toEqual([]);
  expect(
    planCaptures(
      [
        {
          completedStep: 2,
          fixedDt,
          timeOffset: 3 * fixedDt,
          speed: 2,
          paused: true,
        },
      ],
      1 / 30,
    ),
  ).toEqual([]);
});

it("bounds missing source captures and leaves pre-zero history to the immutable-source gate", () => {
  const fixedDt = 1 / 60;
  expect(
    planCaptures(
      [
        {
          completedStep: -1,
          fixedDt,
          timeOffset: fixedDt,
          speed: 1,
          paused: false,
        },
      ],
      fixedDt,
    ),
  ).toEqual([0]);
  expect(() =>
    planCaptures(
      [{ completedStep: 0, fixedDt, timeOffset: 0, speed: 30, paused: false }],
      1 / 30,
    ),
  ).toThrow("stateful-capture-budget-exceeded");
});

const passes: EffectPass[] = [
  {
    id: "velocity",
    kind: "compute",
    wgsl: "@compute @workgroup_size(8,8,1) fn cs() {}",
    reads: ["source"],
    previousFrameReads: ["velocity"],
    output: "velocity",
    dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
  },
  {
    id: "particles",
    kind: "compute",
    wgsl: "@compute @workgroup_size(4,1,1) fn cs() {}",
    reads: ["velocity"],
    previousFrameReads: ["particles"],
    output: "particles",
    dispatch: { elements: "output-buffer", workgroupSize: [4, 1, 1] },
  },
  {
    id: "resolve",
    kind: "render",
    wgsl: "@vertex fn vs() {} @fragment fn fs() {}",
    reads: ["source", "particles"],
    output: "output",
    draw: { vertices: 6, instances: { property: "count", max: 4 } },
  },
];

const definition = {
  resourceGraph: {
    abi: "stateful-resource-v1",
    timing: { fixedDt: 1 / 60, maxStepsPerCall: 8, maxStepIndex: 3600 },
    stateResources: ["velocity", "particles"],
  },
  output: "output",
  passes,
  resources: [
    { name: "source", kind: "texture-2d", external: true, usage: ["sampled"] },
    {
      name: "velocity",
      kind: "texture-2d",
      size: "fixed",
      width: 8,
      height: 8,
      format: "rgba16float",
      usage: ["sampled", "storage"],
      persistent: true,
    },
    {
      name: "particles",
      kind: "buffer",
      size: "fixed",
      byteLength: 128,
      usage: ["storage"],
      persistent: true,
    },
    {
      name: "output",
      kind: "texture-2d",
      size: "viewport",
      format: "rgba16float",
      usage: ["sampled", "render"],
    },
  ],
} as unknown as EffectDefinition;

function fakeGpu() {
  let nextId = 0;
  const groups: GPUBindGroupDescriptor[] = [];
  const waits: Array<() => void> = [];
  const released: number[] = [];
  let leases = 0;
  const leasedTextures: Set<GPUTexture>[] = [];
  const texture = (width = 8, height = 8) => ({
    id: ++nextId,
    width,
    height,
    format: "rgba16float",
    createView() {
      return { texture: this };
    },
    destroy() {
      released.push(this.id);
    },
  });
  const source = texture();
  const target = texture();
  const device = {
    limits: {
      maxTextureDimension2D: 8192,
      maxStorageBufferBindingSize: 16_777_216,
      maxBufferSize: 16_777_216,
      maxComputeWorkgroupsPerDimension: 65_535,
    },
    createSampler: () => ({}),
    createBuffer: (descriptor: { size: number; usage: number }) => ({
      id: ++nextId,
      mapAsync: async () => undefined,
      getMappedRange: () => new Uint8Array(descriptor.size).buffer,
      unmap: () => undefined,
      destroy: () => undefined,
    }),
    createBindGroup: (descriptor: GPUBindGroupDescriptor) => {
      groups.push(descriptor);
      return {};
    },
    createCommandEncoder: () => encoder,
    queue: {
      writeBuffer: () => undefined,
      submit: () => undefined,
      onSubmittedWorkDone: () =>
        new Promise<void>((resolve) => waits.push(resolve)),
    },
  } as unknown as GPUDevice;
  const encoder = {
    clearBuffer: () => undefined,
    beginRenderPass: () => ({
      setPipeline: () => undefined,
      setBindGroup: () => undefined,
      draw: () => undefined,
      end: () => undefined,
    }),
    beginComputePass: () => ({
      setPipeline: () => undefined,
      setBindGroup: () => undefined,
      dispatchWorkgroups: () => undefined,
      end: () => undefined,
    }),
    copyBufferToBuffer: () => undefined,
    copyTextureToBuffer: () => undefined,
    finish: () => ({}),
  } as unknown as GPUCommandEncoder;
  const allocator = {
    texture: (width: number, height: number) =>
      texture(width, height) as unknown as GPUTexture,
    buffer: (byteLength: number) =>
      device.createBuffer({ size: byteLength, usage: 1 }),
    releaseTexture: (value: GPUTexture) => value.destroy(),
    releaseBuffer: (value: GPUBuffer) => value.destroy(),
    lease: (textures: Set<GPUTexture>) => {
      leases += 1;
      leasedTextures.push(textures);
      return () => {
        leases -= 1;
      };
    },
  };
  return {
    device,
    encoder,
    allocator,
    source: source as unknown as GPUTexture,
    target: target as unknown as GPUTexture,
    groups,
    waits,
    released,
    leasedTextures,
    leases: () => leases,
  };
}

describe("NativeStatefulResourceSession", () => {
  it("keeps the committed bank untouched through multi-step catch-up and promotes both fields together", async () => {
    const gpu = fakeGpu();
    const session = Session.create(gpu.device, gpu.allocator, definition, 8, 8);
    const pipeline = { getBindGroupLayout: () => ({}) };
    const frame = session.encode({
      encoder: gpu.encoder,
      source: gpu.source,
      target: gpu.target,
      pipelines: new Map(
        passes.map((pass) => [
          pass.id,
          pipeline as unknown as GPUComputePipeline,
        ]),
      ),
      passes,
      steps: [0, 1],
      fixedDt: 1 / 60,
      seed: 1,
      sourceIdentity: "asset:still.png",
      sourceRevision: "asset:still.png",
      sourceEpoch: null,
      drawCount: () => 4,
      uniforms: () => new Float32Array(136),
    });
    const firstVelocity = gpu.groups[0]!.entries.find(
      (entry) => entry.binding === 3,
    )!.resource as { texture: { id: number } };
    const firstWrite = gpu.groups[0]!.entries.find(
      (entry) => entry.binding === 18,
    )!.resource as { texture: { id: number } };
    const secondVelocity = gpu.groups[3]!.entries.find(
      (entry) => entry.binding === 3,
    )!.resource as { texture: { id: number } };
    const secondWrite = gpu.groups[3]!.entries.find(
      (entry) => entry.binding === 18,
    )!.resource as { texture: { id: number } };
    expect(secondVelocity.texture.id).toBe(firstWrite.texture.id);
    expect(secondWrite.texture.id).not.toBe(firstVelocity.texture.id);
    expect(session.lastCompletedStep).toBe(-1);
    expect(gpu.leasedTextures[0]?.has(gpu.source)).toBe(true);
    expect(gpu.leasedTextures[0]?.has(gpu.target)).toBe(true);
    const completion = frame.commit();
    expect(session.lastCompletedStep).toBe(-1);
    gpu.waits.shift()!();
    await completion;
    expect(session.lastCompletedStep).toBe(1);
    expect(gpu.leases()).toBe(0);
    const snapshot = session.snapshotState();
    gpu.waits.shift()!();
    const state = await snapshot;
    expect(state.resources.map((resource) => resource.name)).toEqual([
      "particles",
      "velocity",
    ]);
    expect([
      state.completedStep,
      state.seed,
      state.sourceRevision,
      state.sourceEpoch,
    ]).toEqual([1, 1, "asset:still.png", null]);
    session.dispose();
    expect(gpu.released).toHaveLength(3);
  });

  it("advances one fixed step at a later observed live source without fabricating intermediate frames", async () => {
    const gpu = fakeGpu();
    const session = Session.create(gpu.device, gpu.allocator, definition, 8, 8);
    const pipeline = { getBindGroupLayout: () => ({}) };
    const pipelines = new Map(
      passes.map((pass) => [
        pass.id,
        pipeline as unknown as GPUComputePipeline,
      ]),
    );
    const encode = (step: number, onDt: (dt: number) => void) =>
      session.encode({
        encoder: gpu.encoder,
        source: gpu.source,
        target: gpu.target,
        pipelines,
        passes,
        steps: [step],
        fixedDt: 1 / 60,
        seed: 1,
        sourceIdentity: "authored:static",
        sourceRevision: `capture:${step}`,
        sourceEpoch: step,
        drawCount: () => 4,
        uniforms: (_pass, _width, _height, _time, dt) => {
          onDt(dt);
          return new Float32Array(136);
        },
      });
    const initial = encode(0, () => undefined);
    const initialCommit = initial.commit();
    gpu.waits.shift()!();
    await initialCommit;
    const deltas: number[] = [];
    const observed = encode(120, (dt) => deltas.push(dt));
    expect(deltas).toEqual(passes.map(() => 1 / 60));
    const commit = observed.commit();
    gpu.waits.shift()!();
    await commit;
    expect(session.lastCompletedStep).toBe(120);
    const later = encode(36_000, () => undefined);
    const laterCommit = later.commit();
    gpu.waits.shift()!();
    await laterCommit;
    const groupCount = gpu.groups.length;
    const next = encode(36_001, (dt) => deltas.push(dt));
    const priorVelocity = gpu.groups[groupCount]!.entries.find(
      (entry) => entry.binding === 3,
    )!.resource as { texture: { id: number } };
    const priorWrite = gpu.groups[groupCount - 3]!.entries.find(
      (entry) => entry.binding === 18,
    )!.resource as { texture: { id: number } };
    expect(priorVelocity.texture.id).toBe(priorWrite.texture.id);
    const nextCommit = next.commit();
    gpu.waits.shift()!();
    await nextCommit;
    expect(session.lastCompletedStep).toBe(36_001);
    expect(deltas).toEqual([...passes, ...passes].map(() => 1 / 60));
    const snapshotPromise = session.snapshotState();
    gpu.waits.shift()!();
    const snapshot = await snapshotPromise;
    expect([
      snapshot.completedStep,
      snapshot.seed,
      snapshot.sourceIdentity,
      snapshot.sourceRevision,
      snapshot.sourceEpoch,
    ]).toEqual([36_001, 1, "authored:static", "capture:36001", 36_001]);
    session.dispose();
  });

  it("holds submitted state and output leases until GPU completion during disposal", async () => {
    const gpu = fakeGpu();
    const session = Session.create(gpu.device, gpu.allocator, definition, 8, 8);
    const pipeline = { getBindGroupLayout: () => ({}) };
    const frame = session.encode({
      encoder: gpu.encoder,
      source: gpu.source,
      target: gpu.target,
      pipelines: new Map(
        passes.map((pass) => [
          pass.id,
          pipeline as unknown as GPUComputePipeline,
        ]),
      ),
      passes,
      steps: [0],
      fixedDt: 1 / 60,
      seed: 1,
      sourceIdentity: "asset:still.png",
      sourceRevision: "asset:still.png",
      sourceEpoch: null,
      drawCount: () => 4,
      uniforms: () => new Float32Array(136),
    });
    frame.markSubmitted();
    frame.abandon();
    session.dispose();
    expect(gpu.leases()).toBe(1);
    gpu.waits.shift()!();
    await Promise.resolve();
    expect(gpu.leases()).toBe(0);
    expect(session.lastCompletedStep).toBe(-1);
  });

  it("does not commit an unmounted session after submitted work completes", async () => {
    const gpu = fakeGpu();
    const session = Session.create(gpu.device, gpu.allocator, definition, 8, 8);
    const pipeline = { getBindGroupLayout: () => ({}) };
    const frame = session.encode({
      encoder: gpu.encoder,
      source: gpu.source,
      target: gpu.target,
      pipelines: new Map(
        passes.map((pass) => [
          pass.id,
          pipeline as unknown as GPUComputePipeline,
        ]),
      ),
      passes,
      steps: [0],
      fixedDt: 1 / 60,
      seed: 1,
      sourceIdentity: "asset:still.png",
      sourceRevision: "asset:still.png",
      sourceEpoch: null,
      drawCount: () => 4,
      uniforms: () => new Float32Array(136),
    });
    frame.markSubmitted();
    const commit = frame.commit();
    session.dispose();
    gpu.waits.shift()!();
    await expect(commit).rejects.toMatchObject({
      code: "stateful-device-lost",
    });
    expect(session.lastCompletedStep).toBe(-1);
    expect(gpu.leases()).toBe(0);
  });

  it("rerenders a repeated step from committed fields without integrating them again", async () => {
    const gpu = fakeGpu();
    const session = Session.create(gpu.device, gpu.allocator, definition, 8, 8);
    const pipeline = { getBindGroupLayout: () => ({}) };
    const options = {
      encoder: gpu.encoder,
      source: gpu.source,
      target: gpu.target,
      pipelines: new Map(
        passes.map((pass) => [
          pass.id,
          pipeline as unknown as GPUComputePipeline,
        ]),
      ),
      passes,
      steps: [0],
      fixedDt: 1 / 60,
      seed: 1,
      sourceIdentity: "asset:still.png",
      sourceRevision: "asset:still.png",
      sourceEpoch: null,
      drawCount: () => 4,
      uniforms: () => new Float32Array(136),
    };
    const first = session.encode(options);
    const committedParticles = gpu.groups[1]!.entries.find(
      (entry) => entry.binding === 18,
    )!.resource as { buffer: GPUBuffer };
    const firstCommit = first.commit();
    gpu.waits.shift()!();
    await firstCommit;
    const groupsBeforeRepeat = gpu.groups.length;
    const repeated = session.encode(options);
    expect(gpu.groups).toHaveLength(groupsBeforeRepeat + 1);
    expect(
      (
        gpu.groups.at(-1)!.entries.find((entry) => entry.binding === 3)!
          .resource as { buffer: GPUBuffer }
      ).buffer,
    ).toBe(committedParticles.buffer);
    const repeatCommit = repeated.commit();
    gpu.waits.shift()!();
    await repeatCommit;
    expect(session.lastCompletedStep).toBe(0);
    const nextGroup = gpu.groups.length;
    const next = session.encode({ ...options, steps: [1] });
    expect(
      (
        gpu.groups[nextGroup + 1]!.entries.find((entry) => entry.binding === 3)!
          .resource as { buffer: GPUBuffer }
      ).buffer,
    ).toBe(committedParticles.buffer);
    next.abandon();
    session.dispose();
  });

  it("rejects a submitted frame without promoting its work bank", async () => {
    const gpu = fakeGpu();
    const session = Session.create(gpu.device, gpu.allocator, definition, 8, 8);
    const pipeline = { getBindGroupLayout: () => ({}) };
    const frame = session.encode({
      encoder: gpu.encoder,
      source: gpu.source,
      target: gpu.target,
      pipelines: new Map(
        passes.map((pass) => [
          pass.id,
          pipeline as unknown as GPUComputePipeline,
        ]),
      ),
      passes,
      steps: [0],
      fixedDt: 1 / 60,
      seed: 1,
      sourceIdentity: "asset:still.png",
      sourceRevision: "asset:still.png",
      sourceEpoch: null,
      drawCount: () => 4,
      uniforms: () => new Float32Array(136),
    });
    const rejected = frame.rejectSubmitted(new Error("GPU validation"));
    gpu.waits.shift()!();
    await rejected;
    expect(session.lastCompletedStep).toBe(-1);
    expect(gpu.leases()).toBe(0);
    expect(() =>
      session.encode({
        encoder: gpu.encoder,
        source: gpu.source,
        target: gpu.target,
        pipelines: new Map(),
        passes,
        steps: [0],
        fixedDt: 1 / 60,
        seed: 1,
        sourceIdentity: "asset:still.png",
        sourceRevision: "asset:still.png",
        sourceEpoch: null,
        drawCount: () => 4,
        uniforms: () => new Float32Array(136),
      }),
    ).toThrow(Failure);
    session.dispose();
  });
});
