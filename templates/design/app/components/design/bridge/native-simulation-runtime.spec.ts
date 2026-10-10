// @vitest-environment happy-dom
import { build } from "esbuild";
import { afterEach, expect, it, vi } from "vitest";

import { OWNED_FEEDBACK_TEST_DEFINITION } from "../../../../shared/native-effect-owned-test-fixtures";
import type {
  EffectDefinition,
  EffectInstance,
} from "../../../../shared/native-effects";

const original = {
  script: Object.getOwnPropertyDescriptor(document, "currentScript"),
  readyState: Object.getOwnPropertyDescriptor(document, "readyState"),
  buffer: Object.getOwnPropertyDescriptor(globalThis, "GPUBufferUsage"),
  texture: Object.getOwnPropertyDescriptor(globalThis, "GPUTextureUsage"),
  stage: Object.getOwnPropertyDescriptor(globalThis, "GPUShaderStage"),
};

afterEach(() => {
  document.body.replaceChildren();
  for (const [name, value] of [
    ["GPUBufferUsage", original.buffer],
    ["GPUTextureUsage", original.texture],
    ["GPUShaderStage", original.stage],
  ] as const) {
    if (value) Object.defineProperty(globalThis, name, value);
    else Reflect.deleteProperty(globalThis, name);
  }
  if (original.script)
    Object.defineProperty(document, "currentScript", original.script);
  else Reflect.deleteProperty(document, "currentScript");
  if (original.readyState)
    Object.defineProperty(document, "readyState", original.readyState);
  else Reflect.deleteProperty(document, "readyState");
  vi.restoreAllMocks();
});

it("dispatches seeded state at 120 Hz and draws exactly the selected particle tier", async () => {
  Object.defineProperty(globalThis, "GPUBufferUsage", {
    configurable: true,
    value: { COPY_SRC: 4, COPY_DST: 8, STORAGE: 128, UNIFORM: 64 },
  });
  Object.defineProperty(globalThis, "GPUTextureUsage", {
    configurable: true,
    value: {
      COPY_SRC: 1,
      COPY_DST: 2,
      TEXTURE_BINDING: 4,
      RENDER_ATTACHMENT: 16,
    },
  });
  Object.defineProperty(globalThis, "GPUShaderStage", {
    configurable: true,
    value: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
  });
  const script = document.createElement("script");
  document.body.append(script);
  Object.defineProperty(document, "currentScript", {
    configurable: true,
    value: script,
  });
  Object.defineProperty(document, "readyState", {
    configurable: true,
    get: () => "loading",
  });
  const built = await build({
    entryPoints: [
      new URL("./native-shader-runtime.bridge.ts", import.meta.url).pathname,
    ],
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
  });
  new Function(built.outputFiles[0].text)();
  const runtime = (window as Window & { __anNativeShaders?: object })
    .__anNativeShaders as {
    device: object;
    deviceEpoch: number;
    sampler: object;
    white: object;
    ensureDevice(): Promise<object>;
    simulationPasses(
      mount: object,
      source: object,
      time: number,
      encoder: object,
      definition: EffectDefinition,
      instance: EffectInstance,
      deterministic: boolean,
    ): Promise<object>;
    attachSimulationPointer(mount: object): void;
    mounts: Map<string, object>;
    playing: boolean;
    previewDirty: boolean;
    raf: number;
    frame(): void;
    requestSourceFrame(): void;
    renderInternal(time: number, strict: boolean): Promise<unknown>;
    running: Promise<unknown> | null;
    simulationExportSession: { id: string; nextFrame: number } | null;
    beginSimulationExportSession(options: {
      fps: number;
      totalFrames: number;
      startTimeSeconds: number;
      signal?: AbortSignal;
    }): Promise<{ sessionId: string }>;
    endSimulationExportSession(sessionId: string): Promise<void>;
    dispose(): void;
  };
  const buffers: { id: number; size: number; destroyed: boolean }[] = [];
  const dispatches: number[] = [];
  const draws: [number, number][] = [];
  const bindings: { binding: number; resource: unknown }[][] = [];
  const device = {
    limits: {
      maxComputeWorkgroupsPerDimension: 65535,
      maxStorageBufferBindingSize: 134_217_728,
    },
    queue: { writeBuffer() {} },
    createBuffer({ size }: { size: number }) {
      const buffer = {
        id: buffers.length,
        size,
        destroyed: false,
        destroy() {
          this.destroyed = true;
        },
      };
      buffers.push(buffer);
      return buffer;
    },
    createTexture({ size, format }: { size: number[]; format: string }) {
      return {
        width: size[0],
        height: size[1],
        format,
        createView: () => ({}),
        destroy() {},
      };
    },
    createShaderModule() {
      return { getCompilationInfo: async () => ({ messages: [] }) };
    },
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createComputePipelineAsync: async () => ({}),
    createRenderPipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroup({
      entries,
    }: {
      entries: { binding: number; resource: unknown }[];
    }) {
      bindings.push(entries);
      return {};
    },
  };
  runtime.device = device;
  runtime.deviceEpoch = 1;
  runtime.sampler = {};
  runtime.white = { createView: () => ({}), destroy() {} };
  runtime.ensureDevice = async () => device;
  const definition: EffectDefinition = {
    id: "bounded-flow",
    name: "Bounded flow",
    version: 1,
    kind: "simulation",
    placements: ["layer"],
    properties: {
      quality: {
        type: "enum",
        label: "Quality",
        default: "low",
        options: ["low", "medium", "high"],
      },
    },
    simulation: {
      fixedDt: 1 / 120,
      stateResource: "state",
      bytesPerParticle: 32,
      count: {
        property: "quality",
        tiers: { low: 10000, medium: 25000, high: 50000 },
      },
      maxInteractiveSteps: 8,
      maxDeterministicSteps: 512,
      idlePointer: { x: 0.5, y: 0.5 },
    },
    resources: [
      {
        name: "state",
        kind: "buffer",
        byteLength: 1_600_000,
        persistent: true,
        usage: ["storage", "copy-src", "copy-dst"],
      },
      { name: "color", kind: "texture-2d", usage: ["render", "sampled"] },
      {
        name: "trail",
        kind: "texture-2d",
        format: "rgba16float",
        persistent: true,
        usage: ["render", "sampled"],
      },
    ],
    output: "trail",
    passes: [
      {
        id: "advance",
        kind: "compute",
        wgsl: "@compute @workgroup_size(256) fn cs() {}",
        reads: [],
        previousFrameReads: ["state"],
        output: "state",
        persistent: true,
        dispatch: { workgroupSize: 256, elements: "simulation-count" },
      },
      {
        id: "draw",
        kind: "render",
        wgsl: "@vertex fn vs() {} @fragment fn fs() {}",
        reads: ["state"],
        output: "color",
        draw: { vertices: 6, instances: "simulation-count" },
      },
      {
        id: "trail-pass",
        kind: "render",
        wgsl: "@vertex fn vs() {} @fragment fn fs() {}",
        reads: ["color"],
        previousFrameReads: ["trail"],
        output: "trail",
        persistent: true,
      },
    ],
    provenance: { origin: "user-authored" },
  };
  const instance: EffectInstance = {
    id: "flow-one",
    nodeId: "flow-target",
    definitionId: definition.id,
    definitionVersion: 1,
    placement: "layer",
    params: { quality: "low" },
    enabled: true,
    opacity: 1,
    seed: 7,
    clip: "bounds",
    blend: "normal",
    timing: { speed: 1, paused: false, time: 0 },
  };
  const target = document.createElement("div");
  document.body.append(target);
  const mount = {
    instance,
    target,
    width: 128,
    height: 64,
    pixelRatio: 1,
    resourceTextures: new Map(),
    drawBindings: new Map(),
    simulation: null,
    simulationCaughtUp: true,
    clock: { global: 0, local: 0, speed: 1, paused: false },
    definition,
    outputTexture: null,
    provider: { needsContinuousFrames: () => false },
    animationCapability: "animated" as const,
  };
  const encoder = {
    beginComputePass: () => ({
      setPipeline() {},
      setBindGroup() {},
      dispatchWorkgroups(count: number) {
        dispatches.push(count);
      },
      end() {},
    }),
    beginRenderPass: () => ({
      setPipeline() {},
      setBindGroup() {},
      draw(vertices: number, count = 1) {
        draws.push([vertices, count]);
      },
      end() {},
    }),
  };
  const source = { createView: () => ({}) };
  await runtime.simulationPasses(
    mount,
    source,
    0,
    encoder,
    definition,
    instance,
    true,
  );
  expect(dispatches).toEqual([40]);
  expect(draws).toEqual([
    [6, 10000],
    [3, 1],
  ]);
  await runtime.simulationPasses(
    mount,
    source,
    1 / 60,
    encoder,
    definition,
    instance,
    true,
  );
  expect(dispatches).toEqual([40, 40, 40]);
  expect(draws).toEqual([
    [6, 10000],
    [3, 1],
    [6, 10000],
    [3, 1],
  ]);
  expect(
    bindings.some(
      (entries) =>
        entries.map((entry) => entry.binding).join() === "0,1,2,3,4,5,6",
    ),
  ).toBe(true);
  expect(buffers.filter((buffer) => buffer.size === 1_600_000)).toHaveLength(2);
  expect(target.getAttribute("data-an-native-simulation-step")).toBe("2");
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 128, 64),
  );
  instance.transform = { translate: [16, 0] };
  runtime.attachSimulationPointer(mount);
  target.dispatchEvent(
    new PointerEvent("pointermove", { clientX: 64, clientY: 32 }),
  );
  const transformedPointer = (
    mount.simulation as unknown as {
      pointer: { x: number; y: number; active: boolean };
    }
  ).pointer;
  expect(transformedPointer.x).toBeCloseTo(0.375, 5);
  expect(transformedPointer.y).toBeCloseTo(0.5, 5);
  expect(transformedPointer.active).toBe(true);
  target.dispatchEvent(
    new PointerEvent("pointermove", { clientX: 0, clientY: 32 }),
  );
  expect(
    (
      mount.simulation as unknown as {
        pointer: { active: boolean };
      }
    ).pointer.active,
  ).toBe(false);
  instance.transform = undefined;
  await runtime.simulationPasses(
    mount,
    source,
    0,
    encoder,
    definition,
    instance,
    true,
  );
  expect(dispatches).toHaveLength(4);
  expect(
    buffers.filter((buffer) => buffer.size === 1_600_000 && buffer.destroyed),
  ).toHaveLength(2);
  runtime.playing = false;
  runtime.mounts = new Map([[instance.id, mount]]);
  const previewState = mount.simulation;
  const previewResources = mount.resourceTextures;
  const session = await runtime.beginSimulationExportSession({
    fps: 60,
    totalFrames: 180,
    startTimeSeconds: 0,
  });
  expect(mount.simulation).toBeNull();
  expect(mount.resourceTextures).not.toBe(previewResources);
  await expect(
    runtime.beginSimulationExportSession({
      fps: 60,
      totalFrames: 180,
      startTimeSeconds: 0,
    }),
  ).rejects.toMatchObject({ code: "simulation-session-busy" });
  await expect(
    runtime.endSimulationExportSession(session.sessionId),
  ).rejects.toMatchObject({
    code: "simulation-session-incomplete",
  });
  expect(mount.simulation).toBe(previewState);
  expect(mount.resourceTextures).toBe(previewResources);
  runtime.running = new Promise(() => {});
  const canceled = new AbortController();
  const cancelReason = new Error("particle validation canceled");
  const pendingSession = runtime.beginSimulationExportSession({
    fps: 60,
    totalFrames: 2,
    startTimeSeconds: 0,
    signal: canceled.signal,
  });
  canceled.abort(cancelReason);
  await expect(pendingSession).rejects.toBe(cancelReason);
  expect(runtime.simulationExportSession).toBeNull();
  expect(mount.simulation).toBe(previewState);
  expect(mount.resourceTextures).toBe(previewResources);
  runtime.running = null;
  instance.timing.time = 1 / 120;
  const seek = await runtime.beginSimulationExportSession({
    fps: 60,
    totalFrames: 2,
    startTimeSeconds: 1 / 60,
  });
  const dispatchedBeforeSeek = dispatches.length;
  await runtime.simulationPasses(
    mount,
    source,
    instance.timing.time + 1 / 60,
    encoder,
    definition,
    instance,
    true,
  );
  expect(dispatches).toHaveLength(dispatchedBeforeSeek + 4);
  await expect(
    runtime.endSimulationExportSession(seek.sessionId),
  ).rejects.toMatchObject({ code: "simulation-session-incomplete" });
  instance.timing.time = 5;
  await expect(
    runtime.beginSimulationExportSession({
      fps: 60,
      totalFrames: 2,
      startTimeSeconds: 0,
    }),
  ).rejects.toMatchObject({ code: "simulation-seek-budget-exceeded" });
  instance.timing.time = 0;
  const schedule = vi
    .spyOn(window, "requestAnimationFrame")
    .mockReturnValue(19);
  const render = vi.fn().mockResolvedValue({ failures: [] });
  runtime.renderInternal = render;
  runtime.playing = true;
  mount.instance.timing.paused = true;
  mount.clock.paused = true;
  runtime.previewDirty = false;
  runtime.frame();
  expect(schedule).not.toHaveBeenCalled();
  expect(render).toHaveBeenCalledTimes(1);
  runtime.requestSourceFrame();
  expect(schedule).toHaveBeenCalledTimes(1);
  runtime.raf = 0;
  mount.provider.needsContinuousFrames = () => true;
  runtime.frame();
  expect(schedule).toHaveBeenCalledTimes(2);
  runtime.playing = false;
  runtime.running = null;
  const previewFeedback = {
    retirements: new Set<Promise<void>>(),
    executor: { dispose: vi.fn() },
  };
  const exportFeedback = {
    retirements: new Set<Promise<void>>(),
    executor: { dispose: vi.fn() },
  };
  const feedbackMount = {
    ...mount,
    definition: OWNED_FEEDBACK_TEST_DEFINITION,
    instance: {
      ...instance,
      id: "feedback-one",
      definitionId: OWNED_FEEDBACK_TEST_DEFINITION.id,
      params: { seed: 37.5 },
      timing: { speed: 1, paused: false, time: 0 },
    },
    simulation: null,
    feedback: previewFeedback,
    feedbackFrame: null,
    resourceTextures: new Map(),
    outputTexture: null,
  };
  runtime.mounts = new Map([[feedbackMount.instance.id, feedbackMount]]);
  const feedbackSession = await runtime.beginSimulationExportSession({
    fps: 60,
    totalFrames: 1,
    startTimeSeconds: 0,
  });
  expect(feedbackMount.feedback).toBeNull();
  feedbackMount.feedback = exportFeedback;
  runtime.simulationExportSession!.nextFrame = 1;
  await runtime.endSimulationExportSession(feedbackSession.sessionId);
  expect(exportFeedback.executor.dispose).toHaveBeenCalledOnce();
  expect(feedbackMount.feedback).toBe(previewFeedback);
  expect(previewFeedback.executor.dispose).not.toHaveBeenCalled();
  runtime.mounts.clear();
  runtime.dispose();
});
