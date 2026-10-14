// @vitest-environment happy-dom
import { build } from "esbuild";
import { afterEach, expect, it, vi } from "vitest";

import { FLOCKING_SWARM_EFFECT } from "../../../../shared/native-effect-owned-aa-flocking";
import { FLUID_ADVECTED_PARTICLES_EFFECT } from "../../../../shared/native-effect-owned-aq-fluid-particles";
import { OWNED_FEEDBACK_TEST_DEFINITION } from "../../../../shared/native-effect-owned-test-fixtures";
import { GRAIN_GRADIENT_EFFECT } from "../../../../shared/native-effect-presets";
import { hashEffectDefinition } from "../../../../shared/native-effect-trust";
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
    texture(width: number, height: number, format: string): object;
    transparent: object;
    layout(mount: object): void;
    finish(mount: object, source: object): Promise<object>;
    present(mount: object, source: object): Promise<void>;
    renderMount(
      mount: object,
      time: number,
      deterministic: boolean,
      complete: Set<string>,
      active: Set<string>,
    ): Promise<void>;
    simulationPasses(
      mount: object,
      source: object,
      time: number,
      encoder: object,
      definition: EffectDefinition,
      instance: EffectInstance,
      deterministic: boolean,
    ): Promise<object>;
    attachPointer(mount: object): void;
    mounts: Map<string, object>;
    playing: boolean;
    previewDirty: boolean;
    raf: number;
    frame(): void;
    requestSourceFrame(): void;
    renderInternal(time: number, strict: boolean): Promise<unknown>;
    running: Promise<unknown> | null;
    simulationExportSession: {
      id: string;
      nextFrame: number;
      failed: boolean;
      sourceStale: boolean;
    } | null;
    scan(): Promise<void>;
    scanOnce(): Promise<void>;
    rescanPending: boolean;
    beginSimulationExportSession(options: {
      fps: number;
      totalFrames: number;
      startTimeSeconds: number;
      targetInstanceIds?: string[];
      signal?: AbortSignal;
    }): Promise<{ sessionId: string }>;
    endSimulationExportSession(sessionId: string): Promise<void>;
    setSimulationExportParameters(options: {
      sessionId: string;
      instanceId: string;
      nodeId: string;
      executionHash: string;
      params: Record<string, number>;
      signal?: AbortSignal;
    }): { instanceId: string; updatedProperties: string[] };
    dispose(): void;
  };
  const buffers: { id: number; size: number; destroyed: boolean }[] = [];
  const dispatches: number[] = [];
  const draws: [number, number][] = [];
  const bindings: { binding: number; resource: unknown }[][] = [];
  let submittedFrames = 0;
  const device = {
    limits: {
      maxComputeWorkgroupsPerDimension: 65535,
      maxStorageBufferBindingSize: 134_217_728,
      maxSampledTexturesPerShaderStage: 16,
    },
    queue: {
      writeBuffer() {},
      submit() {
        submittedFrames += 1;
      },
      onSubmittedWorkDone: async () => {},
    },
    pushErrorScope() {},
    popErrorScope: async (): Promise<{ message: string } | null> => null,
    createCommandEncoder: () => ({ ...encoder, finish: () => ({}) }),
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
  target.style.overflowX = "visible";
  target.style.overflowY = "visible";
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  target.append(canvas);
  document.body.append(target);
  let sourceEpoch = 0;
  const mount = {
    instance,
    target,
    canvas,
    context: {},
    captureInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    isTopLayer: true,
    suppressed: false,
    frozenReason: null,
    previousLayerId: undefined,
    previousFillId: undefined,
    staticGeneratorPassCache: {
      read: () => null,
      commit() {},
      invalidate() {},
    },
    width: 128,
    height: 64,
    pixelRatio: 1,
    resourceTextures: new Map(),
    sourceTextures: new Map(),
    assetTextures: new Map(),
    isolationTextures: new Map(),
    authoredInputs: new Map(),
    statelessBuffers: new Set(),
    statelessInputs: new Map(),
    drawBindings: new Map(),
    simulation: null,
    simulationFrame: null,
    simulationCaughtUp: true,
    clock: { global: 0, local: 0, speed: 1, paused: false },
    definition,
    outputTexture: null,
    frameCount: 0,
    renderWallSamples: [],
    provider: {
      needsContinuousFrames: () => false,
      captureCount: () => 0,
      setLayerTargetOpacityDeferred() {},
      setDensity() {},
      setGroupLocalBackdropSource() {},
      readScene: async () => [],
      sourceEpoch: () => sourceEpoch,
    },
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
  const source = runtime.texture(128, 64, "rgba8unorm");
  runtime.transparent = source;
  runtime.layout = () => {};
  runtime.finish = async (_mount, texture) => texture;
  const presented: object[] = [];
  runtime.present = async (_mount, texture) => {
    presented.push(texture);
  };
  runtime.mounts = new Map([[instance.id, mount]]);
  await runtime.renderMount(mount, 0, true, new Set(), new Set());
  expect(dispatches).toEqual([40]);
  expect(draws).toEqual([
    [6, 10000],
    [3, 1],
  ]);
  await runtime.renderMount(mount, 1 / 60, true, new Set(), new Set());
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
  expect(buffers.filter((buffer) => buffer.size === 1_600_000)).toHaveLength(3);
  expect(target.getAttribute("data-an-native-simulation-step")).toBe("2");
  const committedSimulation = mount.simulation as unknown as {
    readIndex: number;
    completedStep: number;
    buffers: object[];
  };
  expect(committedSimulation.readIndex).toBe(2);
  expect(committedSimulation.completedStep).toBe(2);
  expect(mount.simulationFrame).toBeNull();
  const committedTrail = mount.resourceTextures.get("trail");
  const committedOutput = mount.outputTexture;
  let finishFence!: () => void;
  const pendingFence = new Promise<void>((resolve) => {
    finishFence = resolve;
  });
  device.queue.onSubmittedWorkDone = () => pendingFence;
  const priorSubmissions = submittedFrames;
  const staleFrame = runtime.renderMount(
    mount,
    3 / 120,
    true,
    new Set(),
    new Set(),
  );
  await vi.waitFor(() => expect(submittedFrames).toBe(priorSubmissions + 1));
  expect(committedSimulation.completedStep).toBe(2);
  expect(committedSimulation.readIndex).toBe(2);
  sourceEpoch = 1;
  finishFence();
  await expect(staleFrame).rejects.toMatchObject({
    code: "source-epoch-stale",
  });
  expect(mount.simulation).toBe(committedSimulation);
  expect(committedSimulation.completedStep).toBe(2);
  expect(committedSimulation.readIndex).toBe(2);
  expect(mount.resourceTextures.get("trail")).toBe(committedTrail);
  expect(mount.outputTexture).toBe(committedOutput);
  expect(presented[presented.length - 1]).toBe(committedOutput);
  sourceEpoch = 0;
  device.queue.onSubmittedWorkDone = async () => {};
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 128, 64),
  );
  Object.defineProperty(target, "offsetWidth", {
    configurable: true,
    value: 128,
  });
  Object.defineProperty(target, "offsetHeight", {
    configurable: true,
    value: 64,
  });
  instance.transform = { translate: [16, 0] };
  runtime.attachPointer(mount);
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
  await runtime.renderMount(mount, 0, true, new Set(), new Set());
  expect(dispatches).toHaveLength(5);
  expect(
    buffers.filter((buffer) => buffer.size === 1_600_000 && buffer.destroyed),
  ).toHaveLength(3);
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
  const realRenderInternal = runtime.renderInternal.bind(runtime);
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
      params: { phase: 12 },
      timing: { speed: 1, paused: false, time: 0 },
    },
    simulation: null,
    feedback: previewFeedback,
    feedbackFrame: null,
    resourceTextures: new Map(),
    outputTexture: null,
    frameCount: 0,
    renderWallSamples: [],
    definitionHash: await hashEffectDefinition(OWNED_FEEDBACK_TEST_DEFINITION),
  };
  runtime.mounts = new Map([[feedbackMount.instance.id, feedbackMount]]);
  const previewInstance = feedbackMount.instance;
  const feedbackSession = await runtime.beginSimulationExportSession({
    fps: 60,
    totalFrames: 1,
    startTimeSeconds: 0,
  });
  expect(feedbackMount.feedback).toBeNull();
  runtime.simulationExportSession!.nextFrame = 1;
  let invalidParameterError: unknown;
  try {
    runtime.setSimulationExportParameters({
      sessionId: feedbackSession.sessionId,
      instanceId: feedbackMount.instance.id,
      nodeId: feedbackMount.instance.nodeId,
      executionHash: feedbackMount.definitionHash,
      params: { unknown: 30 },
    });
  } catch (error) {
    invalidParameterError = error;
  }
  expect(invalidParameterError).toMatchObject({
    code: "simulation-session-params-invalid",
  });
  expect(feedbackMount.instance).toBe(previewInstance);
  expect(
    runtime.setSimulationExportParameters({
      sessionId: feedbackSession.sessionId,
      instanceId: feedbackMount.instance.id,
      nodeId: feedbackMount.instance.nodeId,
      executionHash: feedbackMount.definitionHash,
      params: { phase: 30 },
    }),
  ).toEqual({
    instanceId: feedbackMount.instance.id,
    updatedProperties: ["phase"],
  });
  expect(feedbackMount.instance).not.toBe(previewInstance);
  feedbackMount.feedback = exportFeedback;
  await runtime.endSimulationExportSession(feedbackSession.sessionId);
  expect(exportFeedback.executor.dispose).toHaveBeenCalledOnce();
  expect(feedbackMount.feedback).toBe(previewFeedback);
  expect(feedbackMount.instance).toBe(previewInstance);
  expect(previewFeedback.executor.dispose).not.toHaveBeenCalled();
  const ordinaryResources = new Map([["sentinel", { destroy: vi.fn() }]]);
  const ordinaryOutput = { destroy: vi.fn() };
  const ordinaryMount = {
    ...feedbackMount,
    definition: GRAIN_GRADIENT_EFFECT,
    instance: {
      ...feedbackMount.instance,
      id: "ordinary-one",
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
      params: { scale: 1 },
    },
    simulation: null,
    feedback: null,
    resourceTextures: ordinaryResources,
    outputTexture: ordinaryOutput,
    definitionHash: await hashEffectDefinition(GRAIN_GRADIENT_EFFECT),
  };
  runtime.mounts = new Map([[ordinaryMount.instance.id, ordinaryMount]]);
  const ordinaryInstance = ordinaryMount.instance;
  const ordinarySession = await runtime.beginSimulationExportSession({
    fps: 60,
    totalFrames: 1,
    startTimeSeconds: 0,
    targetInstanceIds: [ordinaryMount.instance.id],
  });
  expect(ordinaryMount.resourceTextures).not.toBe(ordinaryResources);
  runtime.simulationExportSession!.nextFrame = 1;
  runtime.setSimulationExportParameters({
    sessionId: ordinarySession.sessionId,
    instanceId: ordinaryMount.instance.id,
    nodeId: ordinaryMount.instance.nodeId,
    executionHash: ordinaryMount.definitionHash,
    params: { scale: 2 },
  });
  expect(ordinaryMount.instance).not.toBe(ordinaryInstance);
  await runtime.endSimulationExportSession(ordinarySession.sessionId);
  expect(ordinaryMount.instance).toBe(ordinaryInstance);
  expect(ordinaryMount.resourceTextures).toBe(ordinaryResources);
  expect(ordinaryMount.outputTexture).toBe(ordinaryOutput);
  const cameraMount = {
    ...ordinaryMount,
    definition: FLUID_ADVECTED_PARTICLES_EFFECT,
    instance: {
      ...ordinaryInstance,
      id: "stateful-camera",
      definitionId: FLUID_ADVECTED_PARTICLES_EFFECT.id,
      definitionVersion: FLUID_ADVECTED_PARTICLES_EFFECT.version,
      bindings: { source: { kind: "camera" as const } },
    },
    stateful: null,
  };
  runtime.mounts = new Map([[cameraMount.instance.id, cameraMount]]);
  await expect(
    runtime.beginSimulationExportSession({
      fps: 30,
      totalFrames: 2,
      startTimeSeconds: 0,
    }),
  ).rejects.toMatchObject({ code: "stateful-source-history-unavailable" });
  expect(runtime.simulationExportSession).toBeNull();
  runtime.mounts = new Map([[ordinaryMount.instance.id, ordinaryMount]]);
  await expect(
    runtime.beginSimulationExportSession({
      fps: 60,
      totalFrames: 1,
      startTimeSeconds: 0,
      targetInstanceIds: ["missing"],
    }),
  ).rejects.toMatchObject({ code: "simulation-session-target-invalid" });
  const detachedResource = { destroy: vi.fn() };
  const detachedOutput = { destroy: vi.fn() };
  const detachedResources = new Map([["held", detachedResource]]);
  const detachedMount = {
    ...ordinaryMount,
    instance: { ...ordinaryMount.instance, id: "ordinary-detached" },
    resourceTextures: detachedResources,
    outputTexture: detachedOutput,
  };
  runtime.mounts = new Map([[detachedMount.instance.id, detachedMount]]);
  const detachedSession = await runtime.beginSimulationExportSession({
    fps: 60,
    totalFrames: 1,
    startTimeSeconds: 0,
    targetInstanceIds: [detachedMount.instance.id],
  });
  const replacement = {
    ...detachedMount,
    resourceTextures: new Map(),
    outputTexture: { destroy: vi.fn() },
  };
  runtime.mounts.set(detachedMount.instance.id, replacement);
  await expect(
    runtime.endSimulationExportSession(detachedSession.sessionId),
  ).rejects.toMatchObject({ code: "simulation-session-incomplete" });
  expect(detachedResource.destroy).toHaveBeenCalledOnce();
  expect(detachedOutput.destroy).toHaveBeenCalledOnce();
  expect(replacement.outputTexture.destroy).not.toHaveBeenCalled();

  runtime.mounts = new Map([[ordinaryMount.instance.id, ordinaryMount]]);
  const scanOnce = vi.fn().mockResolvedValue(undefined);
  runtime.scanOnce = scanOnce;
  const changedSourceSession = await runtime.beginSimulationExportSession({
    fps: 60,
    totalFrames: 1,
    startTimeSeconds: 0,
    targetInstanceIds: [ordinaryMount.instance.id],
  });
  await runtime.scan();
  expect(runtime.simulationExportSession).toMatchObject({
    failed: true,
    sourceStale: true,
  });
  expect(scanOnce).not.toHaveBeenCalled();
  await expect(
    runtime.endSimulationExportSession(changedSourceSession.sessionId),
  ).rejects.toMatchObject({ code: "simulation-session-source-stale" });
  expect(scanOnce).toHaveBeenCalledOnce();
  const flockDefinition = structuredClone(FLOCKING_SWARM_EFFECT);
  flockDefinition.placements = ["layer"];
  const flockInstance: EffectInstance = {
    ...instance,
    id: "flock-one",
    definitionId: flockDefinition.id,
    placement: "layer",
    params: { agentCount: 96 },
    timing: { speed: 1, paused: false, time: 0 },
  };
  const flockMount = {
    ...mount,
    instance: flockInstance,
    definition: flockDefinition,
    simulation: null,
    resourceTextures: new Map(),
    outputTexture: null,
  };
  runtime.mounts = new Map([[flockInstance.id, flockMount]]);
  await runtime.renderMount(flockMount, 0, true, new Set(), new Set());
  expect(dispatches[dispatches.length - 1]).toBe(1);
  expect(draws.slice(-2)).toEqual([
    [6, 96],
    [3, 1],
  ]);
  expect(buffers.filter((buffer) => buffer.size === 96 * 32)).toHaveLength(3);
  expect(target.getAttribute("data-an-native-particle-count")).toBe("96");
  flockInstance.params.agentCount = 128;
  await runtime.renderMount(flockMount, 0, true, new Set(), new Set());
  expect(dispatches[dispatches.length - 1]).toBe(1);
  expect(draws.slice(-2)).toEqual([
    [6, 128],
    [3, 1],
  ]);
  expect(
    buffers.filter((buffer) => buffer.size === 96 * 32 && buffer.destroyed),
  ).toHaveLength(3);
  expect(buffers.filter((buffer) => buffer.size === 128 * 32)).toHaveLength(3);
  expect(target.getAttribute("data-an-native-particle-count")).toBe("128");
  flockInstance.params.agentCount = 257;
  await expect(
    runtime.simulationPasses(
      flockMount,
      source,
      0,
      encoder,
      flockDefinition,
      flockInstance,
      true,
    ),
  ).rejects.toMatchObject({ code: "simulation-count-invalid" });
  const draftRuntime = runtime as typeof runtime & {
    epoch: number;
    draftGeneration: number;
    draft: {
      simulation: object | null;
      showDraft: boolean;
      time: number;
      publishedTexture: object | null;
    } | null;
    previewDraft(
      request: {
        requestId: string;
        runtimeEpoch: number;
        instanceId: string;
        nodeId: string;
        baseExecutionHash: string;
        expectedExecutionHash: string;
        draftDefinition: EffectDefinition;
        params: EffectInstance["params"];
        seed: number;
        time: number;
      },
      generation: number,
    ): Promise<void>;
    controlDraft(
      request: {
        requestId: string;
        runtimeEpoch: number;
        instanceId: string;
        baseExecutionHash: string;
        expectedExecutionHash?: string;
        command: "show-published" | "show-draft" | "clear" | "set-time";
        time?: number;
      },
      generation: number,
    ): Promise<void>;
  };
  runtime.mounts = new Map([[instance.id, mount]]);
  const publishedSimulation = mount.simulation as unknown as {
    readIndex: number;
    completedStep: number;
    buffers: { destroyed: boolean }[];
  };
  const publishedBank = publishedSimulation.readIndex;
  const publishedStep = publishedSimulation.completedStep;
  const publishedOutput = mount.outputTexture;
  mount.suppressed = true;
  runtime.renderInternal = async () => {
    await runtime.renderMount(mount, 0, true, new Set(), new Set());
    return { failures: [] };
  };
  runtime.frame = () => {};
  const draftDefinition: EffectDefinition = {
    ...definition,
    passes: definition.passes.map((pass, index) =>
      index === 0 ? { ...pass, wgsl: `${pass.wgsl}\n// candidate` } : pass,
    ),
  };
  const baseHash = await hashEffectDefinition(definition);
  const draftHash = await hashEffectDefinition(draftDefinition);
  draftRuntime.draftGeneration = 200;
  await draftRuntime.previewDraft(
    {
      requestId: "particle-candidate-preview",
      runtimeEpoch: draftRuntime.epoch,
      instanceId: instance.id,
      nodeId: instance.nodeId,
      baseExecutionHash: baseHash,
      expectedExecutionHash: draftHash,
      draftDefinition,
      params: instance.params,
      seed: instance.seed,
      time: 0,
    },
    200,
  );
  const candidateSimulation = draftRuntime.draft?.simulation;
  expect(candidateSimulation).toBeDefined();
  expect(candidateSimulation).not.toBe(publishedSimulation);
  expect(draftRuntime.draft?.showDraft).toBe(true);
  expect(mount.outputTexture).not.toBe(publishedOutput);
  expect(publishedSimulation.readIndex).toBe(publishedBank);
  expect(publishedSimulation.completedStep).toBe(publishedStep);
  draftRuntime.draftGeneration = 201;
  await draftRuntime.controlDraft(
    {
      requestId: "particle-candidate-show-published",
      runtimeEpoch: draftRuntime.epoch,
      instanceId: instance.id,
      baseExecutionHash: baseHash,
      expectedExecutionHash: draftHash,
      command: "show-published",
    },
    201,
  );
  expect(draftRuntime.draft?.showDraft).toBe(false);
  expect(mount.outputTexture).toBe(publishedOutput);
  expect(draftRuntime.draft?.simulation).toBe(candidateSimulation);
  draftRuntime.draftGeneration = 202;
  await draftRuntime.controlDraft(
    {
      requestId: "particle-candidate-show-draft",
      runtimeEpoch: draftRuntime.epoch,
      instanceId: instance.id,
      baseExecutionHash: baseHash,
      expectedExecutionHash: draftHash,
      command: "show-draft",
    },
    202,
  );
  expect(draftRuntime.draft?.showDraft).toBe(true);
  expect(mount.outputTexture).not.toBe(publishedOutput);
  draftRuntime.draftGeneration = 203;
  await draftRuntime.controlDraft(
    {
      requestId: "particle-candidate-clear",
      runtimeEpoch: draftRuntime.epoch,
      instanceId: instance.id,
      baseExecutionHash: baseHash,
      expectedExecutionHash: draftHash,
      command: "clear",
    },
    203,
  );
  expect(draftRuntime.draft).toBeNull();
  expect(mount.simulation).toBe(publishedSimulation);
  expect(mount.outputTexture).toBe(publishedOutput);
  expect(publishedSimulation.readIndex).toBe(publishedBank);
  expect(publishedSimulation.completedStep).toBe(publishedStep);
  expect(publishedSimulation.buffers.every((buffer) => !buffer.destroyed)).toBe(
    true,
  );

  const fillDefinition: EffectDefinition = {
    ...definition,
    placements: ["fill"],
  };
  const fillInstance: EffectInstance = {
    ...instance,
    id: "flow-fill",
    placement: "fill",
    definitionId: fillDefinition.id,
    timing: { speed: 1, paused: false, time: 0 },
  };
  const fillTarget = document.createElement("div");
  document.documentElement.style.opacity = "1";
  document.body.style.opacity = "1";
  fillTarget.style.opacity = "1";
  fillTarget.style.overflowX = "visible";
  fillTarget.style.overflowY = "visible";
  fillTarget.style.transformOrigin = "50% 50%";
  Object.defineProperties(fillTarget, {
    offsetWidth: { configurable: true, value: 128 },
    offsetHeight: { configurable: true, value: 64 },
  });
  const fillCanvas = document.createElement("canvas");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    let configuration: Record<string, unknown> = {
      format: "unconfigured",
      alphaMode: "premultiplied",
      colorSpace: "srgb",
    };
    return {
      getConfiguration: () => configuration,
      configure: (next: Record<string, unknown>) => {
        configuration = next;
      },
      unconfigure() {},
    } as unknown as GPUCanvasContext;
  });
  vi.spyOn(
    HTMLCanvasElement.prototype,
    "getBoundingClientRect",
  ).mockImplementation(function (this: HTMLCanvasElement) {
    return new DOMRect(0, 0, this.width, this.height);
  });
  fillCanvas.width = 128;
  fillCanvas.height = 64;
  fillCanvas.style.opacity = "1";
  vi.spyOn(fillCanvas, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 128, 64),
  );
  fillTarget.append(fillCanvas);
  document.body.append(fillTarget);
  let fillEpoch = 0;
  const fillSource = document.createElement("canvas");
  fillSource.width = 128;
  fillSource.height = 64;
  const ownPaintCalls: string[] = [];
  let ownPaintScenes: Record<
    string,
    Array<{
      rect: { x: number; y: number; width: number; height: number };
      clip: { x: number; y: number; width: number; height: number };
    }>
  > = {};
  const fillProvider = {
    needsContinuousFrames: () => false,
    captureCount: () => 0,
    setLayerTargetOpacityDeferred() {},
    setDensity() {},
    setGroupLocalBackdropSource() {},
    groupLocalBackdropClipState: () => "nonempty" as const,
    sourceEpoch: () => fillEpoch,
    authoredSourceEpoch: () => fillEpoch,
    readFillOwnPaintPhase: async (phase: string) => {
      ownPaintCalls.push(phase);
      return ownPaintScenes[phase] ?? [];
    },
    readFillBoxPhase: async (_paint: object, phase: string) => [
      {
        source: fillSource,
        key: phase,
        revision: fillEpoch,
      },
    ],
    hasFillGlyph: () => false,
    readFillForeground: async (): Promise<
      Array<{
        rect: { x: number; y: number; width: number; height: number };
        clip: { x: number; y: number; width: number; height: number };
      }>
    > => [],
  };
  const fillMount = {
    ...mount,
    instance: fillInstance,
    definition: fillDefinition,
    target: fillTarget,
    canvas: fillCanvas,
    context: fillCanvas.getContext("webgpu"),
    provider: fillProvider,
    authoredFillPaint: {},
    resourceTextures: new Map(),
    simulation: null,
    simulationFrame: null,
    outputExtent: {
      pixelRatio: 1,
      width: 128,
      height: 64,
      sourceWidth: 128,
      sourceHeight: 64,
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      expanded: false,
    },
    outputTexture: null,
    suppressed: false,
    committedSourceEpoch: null as number | null,
    committedInstancePayload: null as string | null,
    committedDefinitionHash: null as string | null,
    committedLocalTime: null as number | null,
    committedInputEpochs: new Map(),
  };
  const fillRuntime = runtime as typeof runtime & {
    refreshAuthoredPaint(mount: object): void;
    upload(mount: object, record: object): object;
    drawCoveredFillPhase(...args: unknown[]): Promise<object>;
    compositeFill(...args: unknown[]): Promise<object>;
  };
  fillRuntime.refreshAuthoredPaint = () => {};
  fillRuntime.upload = () => runtime.texture(128, 64, "rgba8unorm");
  fillRuntime.drawCoveredFillPhase = async (
    _mount,
    _encoder,
    _name,
    _wgsl,
    foreground,
  ) => foreground as object;
  fillRuntime.compositeFill = async (_mount, _foreground, background) =>
    background as object;
  runtime.renderInternal = realRenderInternal;
  runtime.mounts = new Map([[fillInstance.id, fillMount]]);
  const fillFirst = await runtime.renderInternal(0, true);
  expect(fillFirst).toMatchObject({ failures: [] });
  expect(fillMount.simulation).not.toBeNull();
  expect(fillMount.suppressed).toBe(true);
  expect(fillMount.canvas.style.visibility).toBe("visible");
  const retainedFill = fillMount.simulation as unknown as {
    readIndex: number;
    completedStep: number;
  };
  const retainedFillTrail = fillMount.resourceTextures.get("trail");
  const retainedFillOutput = fillMount.outputTexture;
  const retainedFillCanvas = fillMount.canvas;
  const retainedFillProvenance = {
    sourceEpoch: fillMount.committedSourceEpoch,
    instancePayload: fillMount.committedInstancePayload,
    definitionHash: fillMount.committedDefinitionHash,
    localTime: fillMount.committedLocalTime,
    inputEpochs: new Map(fillMount.committedInputEpochs),
  };
  const retainedFillBank = retainedFill.readIndex;
  const retainedFillStep = retainedFill.completedStep;
  let releaseFillFence!: () => void;
  const fillFence = new Promise<void>((resolve) => {
    releaseFillFence = resolve;
  });
  device.queue.onSubmittedWorkDone = () => fillFence;
  const fillSubmitted = submittedFrames;
  const failedFill = runtime.renderInternal(1 / 120, true);
  await vi.waitFor(() => expect(submittedFrames).toBe(fillSubmitted + 1));
  fillEpoch = 1;
  releaseFillFence();
  const fillFailure = await failedFill;
  expect(fillFailure).toMatchObject({
    failures: [expect.objectContaining({ code: "source-epoch-stale" })],
  });
  expect(fillMount.simulation).toBe(retainedFill);
  expect(retainedFill.readIndex).toBe(retainedFillBank);
  expect(retainedFill.completedStep).toBe(retainedFillStep);
  expect(fillMount.resourceTextures.get("trail")).toBe(retainedFillTrail);
  expect(fillMount.outputTexture).toBe(retainedFillOutput);
  expect(fillMount.canvas).toBe(retainedFillCanvas);
  expect(fillMount).toMatchObject({
    committedSourceEpoch: retainedFillProvenance.sourceEpoch,
    committedInstancePayload: retainedFillProvenance.instancePayload,
    committedDefinitionHash: retainedFillProvenance.definitionHash,
    committedLocalTime: retainedFillProvenance.localTime,
    committedInputEpochs: retainedFillProvenance.inputEpochs,
  });
  expect(
    (fillMount as typeof fillMount & { retainedPresentationWitness: boolean })
      .retainedPresentationWitness,
  ).toBe(true);
  expect(fillMount.suppressed).toBe(true);
  expect(fillMount.canvas.style.visibility).toBe("visible");
  fillEpoch = 0;
  let releasePromotionGap!: () => void;
  const promotionGap = new Promise<void>((resolve) => {
    releasePromotionGap = resolve;
  });
  device.queue.onSubmittedWorkDone = () => promotionGap;
  const gapSubmitted = submittedFrames;
  const lateSourceChange = runtime.renderInternal(1 / 120, true);
  await vi.waitFor(() => expect(submittedFrames).toBe(gapSubmitted + 1));
  releasePromotionGap();
  queueMicrotask(() => {
    fillEpoch = 1;
  });
  expect(await lateSourceChange).toMatchObject({
    failures: [expect.objectContaining({ code: "source-epoch-stale" })],
  });
  expect(fillMount.simulation).toBe(retainedFill);
  expect(retainedFill.readIndex).toBe(retainedFillBank);
  expect(retainedFill.completedStep).toBe(retainedFillStep);
  expect(fillMount.resourceTextures.get("trail")).toBe(retainedFillTrail);
  expect(fillMount.outputTexture).toBe(retainedFillOutput);
  expect(fillMount.canvas).toBe(retainedFillCanvas);
  expect(fillMount).toMatchObject({
    committedSourceEpoch: retainedFillProvenance.sourceEpoch,
    committedInstancePayload: retainedFillProvenance.instancePayload,
    committedDefinitionHash: retainedFillProvenance.definitionHash,
    committedLocalTime: retainedFillProvenance.localTime,
    committedInputEpochs: retainedFillProvenance.inputEpochs,
  });
  device.queue.onSubmittedWorkDone = async () => {};
  fillEpoch = 0;
  const fillDraftDefinition: EffectDefinition = {
    ...fillDefinition,
    passes: fillDefinition.passes.map((pass, index) =>
      index === 0 ? { ...pass, wgsl: `${pass.wgsl}\n// fill candidate` } : pass,
    ),
  };
  const fillBaseHash = await hashEffectDefinition(fillDefinition);
  const fillDraftHash = await hashEffectDefinition(fillDraftDefinition);
  const draftMessages = vi.spyOn(
    draftRuntime as unknown as { postDraftResult(...args: unknown[]): void },
    "postDraftResult",
  );
  draftRuntime.draftGeneration = 204;
  await draftRuntime.previewDraft(
    {
      requestId: "fill-particle-candidate-preview",
      runtimeEpoch: draftRuntime.epoch,
      instanceId: fillInstance.id,
      nodeId: fillInstance.nodeId,
      baseExecutionHash: fillBaseHash,
      expectedExecutionHash: fillDraftHash,
      draftDefinition: fillDraftDefinition,
      params: fillInstance.params,
      seed: fillInstance.seed,
      time: 1 / 120,
    },
    204,
  );
  expect(
    draftMessages.mock.calls[draftMessages.mock.calls.length - 1]?.slice(2, 4),
  ).toEqual(["ready", []]);
  expect(draftRuntime.draft?.simulation).toBeDefined();
  expect(draftRuntime.draft?.showDraft).toBe(true);
  expect(fillMount.outputTexture).not.toBe(retainedFillOutput);
  expect(draftRuntime.draft?.publishedTexture).toBe(retainedFillOutput);
  const beforeFailedSeek = fillMount.outputTexture;
  const beforeFailedSeekStep = retainedFill.completedStep;
  const beforeFailedSeekSubmissions = submittedFrames;
  draftRuntime.draftGeneration = 205;
  await draftRuntime.controlDraft(
    {
      requestId: "fill-particle-candidate-over-limit",
      runtimeEpoch: draftRuntime.epoch,
      instanceId: fillInstance.id,
      baseExecutionHash: fillBaseHash,
      expectedExecutionHash: fillDraftHash,
      command: "set-time",
      time: 10,
    },
    205,
  );
  const seekResult =
    draftMessages.mock.calls[draftMessages.mock.calls.length - 1]!;
  expect(seekResult[2]).toBe("last-good");
  expect(seekResult[3]).toEqual([
    expect.objectContaining({ code: "simulation-seek-budget-exceeded" }),
  ]);
  expect(submittedFrames).toBe(beforeFailedSeekSubmissions);
  expect(draftRuntime.draft?.time).toBe(1 / 120);
  expect(fillMount.outputTexture).toBe(beforeFailedSeek);
  expect(fillMount.suppressed).toBe(true);
  expect(fillMount.canvas.style.visibility).toBe("visible");
  expect(fillMount.simulation).toBe(retainedFill);
  expect(retainedFill.completedStep).toBe(beforeFailedSeekStep);
  draftRuntime.draftGeneration = 206;
  await draftRuntime.controlDraft(
    {
      requestId: "fill-particle-candidate-clear",
      runtimeEpoch: draftRuntime.epoch,
      instanceId: fillInstance.id,
      baseExecutionHash: fillBaseHash,
      expectedExecutionHash: fillDraftHash,
      command: "clear",
    },
    206,
  );
  expect(draftRuntime.draft).toBeNull();
  expect(fillMount.outputTexture).toBe(retainedFillOutput);
  expect(fillMount.suppressed).toBe(true);
  let releaseRejectedPresentation!: () => void;
  const rejectedPresentationFence = new Promise<void>((resolve) => {
    releaseRejectedPresentation = resolve;
  });
  device.queue.onSubmittedWorkDone = () => rejectedPresentationFence;
  const originalPopErrorScope = device.popErrorScope;
  let errorScopePops = 0;
  device.popErrorScope = async () =>
    ++errorScopePops === 1 ? { message: "spare output rejected" } : null;
  const rejectedPresentationSubmissions = submittedFrames;
  const rejectedPresentation = runtime.renderInternal(1 / 120, true);
  await vi.waitFor(() =>
    expect(submittedFrames).toBe(rejectedPresentationSubmissions + 1),
  );
  releaseRejectedPresentation();
  const rejectedPresentationResult = await rejectedPresentation;
  expect(rejectedPresentationResult).toMatchObject({
    failures: [expect.objectContaining({ code: "gpu-validation" })],
  });
  expect(errorScopePops).toBe(1);
  expect(fillMount.outputTexture).toBe(retainedFillOutput);
  expect(fillMount.suppressed).toBe(true);
  expect(fillMount.canvas.style.visibility).toBe("visible");
  expect(fillTarget.getAttribute("data-an-native-status")).toBe("last-good");
  device.popErrorScope = originalPopErrorScope;
  device.queue.onSubmittedWorkDone = async () => {};
  fillEpoch = 0;
  const swapFailure = vi
    .spyOn(fillMount.canvas, "replaceWith")
    .mockImplementationOnce(() => {
      throw new Error("fill-swap-rejected");
    });
  const beforeSwapFailure = {
    bank: retainedFill.readIndex,
    step: retainedFill.completedStep,
    trail: fillMount.resourceTextures.get("trail"),
    output: fillMount.outputTexture,
    canvas: fillMount.canvas,
    provenance: fillMount.committedInstancePayload,
  };
  expect(await runtime.renderInternal(1 / 120, true)).toMatchObject({
    failures: [
      expect.objectContaining({
        code: "render-failed",
        message: "fill-swap-rejected",
      }),
    ],
  });
  swapFailure.mockRestore();
  expect(fillMount.canvas).toBe(beforeSwapFailure.canvas);
  expect(fillMount.outputTexture).toBe(beforeSwapFailure.output);
  expect(fillMount.resourceTextures.get("trail")).toBe(beforeSwapFailure.trail);
  expect(retainedFill.readIndex).toBe(beforeSwapFailure.bank);
  expect(retainedFill.completedStep).toBe(beforeSwapFailure.step);
  expect(fillMount.committedInstancePayload).toBe(beforeSwapFailure.provenance);
  expect(fillMount.suppressed).toBe(true);
  const firstTarget = document.createElement("div");
  firstTarget.style.overflowX = "visible";
  firstTarget.style.overflowY = "visible";
  const firstCanvas = document.createElement("canvas");
  firstTarget.append(firstCanvas);
  document.body.append(firstTarget);
  const firstFill = {
    ...fillMount,
    instance: { ...fillInstance, id: "flow-fill-no-frame" },
    target: firstTarget,
    canvas: firstCanvas,
    provider: {
      ...fillProvider,
      readFillBoxPhase: async () => {
        throw new Error("fill-capture-unreadable");
      },
    },
    simulation: null,
    simulationFrame: null,
    resourceTextures: new Map(),
    outputTexture: null,
    suppressed: false,
  };
  runtime.mounts = new Map([[firstFill.instance.id, firstFill]]);
  const missingFirstFrame = await runtime.renderInternal(0, true);
  expect(missingFirstFrame).toMatchObject({
    failures: [
      expect.objectContaining({
        code: "render-failed",
        message: "fill-capture-unreadable",
      }),
    ],
  });
  expect(firstFill.outputTexture).toBeNull();
  expect(firstFill.suppressed).toBe(false);
  expect(firstCanvas.style.visibility).toBe("hidden");
  expect(firstTarget.getAttribute("data-an-native-status")).toBe("error");

  const childPixels = runtime.texture(180, 64, "rgba8unorm");
  let clippedForeground = false;
  fillProvider.readFillForeground = async () => [
    {
      rect: { x: 110, y: 10, width: 70, height: 40 },
      clip: { x: 110, y: 10, width: 70, height: 40 },
    },
  ];
  (
    fillRuntime as typeof fillRuntime & {
      composeScene(...args: unknown[]): Promise<object>;
    }
  ).composeScene = async (surface) => {
    if (clippedForeground) {
      expect(surface).toMatchObject({
        width: 128,
        height: 64,
        outputExtent: { sourceWidth: 128, sourceHeight: 64, right: 0 },
      });
      return runtime.texture(128, 64, "rgba8unorm");
    }
    expect(surface).toMatchObject({
      width: 180,
      height: 64,
      outputExtent: { sourceWidth: 128, sourceHeight: 64, right: 52 },
    });
    return childPixels;
  };
  runtime.mounts = new Map([[fillInstance.id, fillMount]]);
  const expandedFill = await runtime.renderInternal(0, true);
  expect(expandedFill).toMatchObject({ failures: [] });
  expect(fillMount.outputTexture).toMatchObject({ width: 180, height: 64 });
  expect(await runtime.renderInternal(0, true)).toMatchObject({ failures: [] });
  expect(
    (
      runtime as typeof runtime & { textureBytes: Map<object, number> }
    ).textureBytes.has(fillMount.resourceTextures.get("trail")!),
  ).toBe(true);
  expect(fillMount.canvas.width).toBe(180);
  expect(fillMount.canvas.height).toBe(64);
  expect(fillMount).toMatchObject({
    width: 128,
    height: 64,
    fillPresentationExtent: { sourceWidth: 128, sourceHeight: 64, right: 52 },
  });
  const staticFillDefinition = GRAIN_GRADIENT_EFFECT;
  const staticFillInstance: EffectInstance = {
    ...fillInstance,
    id: "static-fill-overflow",
    definitionId: staticFillDefinition.id,
    definitionVersion: staticFillDefinition.version,
    params: {
      ...Object.fromEntries(
        Object.entries(staticFillDefinition.properties).map(
          ([name, property]) => [name, property.default],
        ),
      ),
      movement: 0,
    },
  };
  const staticFillMount = {
    ...fillMount,
    instance: staticFillInstance,
    definition: staticFillDefinition,
    definitionHash: await hashEffectDefinition(staticFillDefinition),
    canvas: fillMount.canvas,
    context: fillMount.context,
    simulation: null,
    simulationFrame: null,
    resourceTextures: new Map(),
    outputTexture: null,
    fillPresentationExtent: null,
    fillCommittedNativeChildren: new Set<string>(),
    frameCount: 0,
    suppressed: false,
  };
  runtime.mounts = new Map([[staticFillInstance.id, staticFillMount]]);
  await runtime.renderMount(staticFillMount, 0, true, new Set(), new Set());
  expect(staticFillMount.outputTexture).toMatchObject({
    width: 180,
    height: 64,
  });
  expect(staticFillMount.canvas.width).toBe(180);
  expect(staticFillMount.width).toBe(128);
  const frostTarget = document.createElement("div");
  fillTarget.append(frostTarget);
  const frostMount = {
    ...mount,
    instance: {
      ...fillInstance,
      id: "nested-frost",
      placement: "backdrop" as const,
    },
    target: frostTarget,
    outputTexture: runtime.texture(70, 40, "rgba8unorm"),
  };
  const nestedFillTarget = document.createElement("div");
  fillTarget.append(nestedFillTarget);
  nestedFillTarget.append(frostTarget);
  const nestedFillMount = {
    ...staticFillMount,
    instance: {
      ...staticFillInstance,
      id: "nested-fill",
    },
    target: nestedFillTarget,
    outputTexture: runtime.texture(70, 40, "rgba8unorm") as object | null,
    fillCommittedNativeChildren: new Set([frostMount.instance.id]),
  };
  fillProvider.readFillForeground = async () => [
    {
      rect: { x: 110, y: 10, width: 70, height: 40 },
      clip: { x: 110, y: 10, width: 70, height: 40 },
      nativeInstanceId: frostMount.instance.id,
    },
  ];
  const renderWithNestedBackdrop = runtime.renderMount.bind(runtime);
  runtime.renderMount = async (candidate, ...args) => {
    if (candidate === frostMount || candidate === nestedFillMount) return;
    return renderWithNestedBackdrop(candidate, ...args);
  };
  runtime.mounts = new Map<string, object>([
    [staticFillInstance.id, staticFillMount],
    [frostMount.instance.id, frostMount],
    [nestedFillMount.instance.id, nestedFillMount],
  ]);
  await runtime.renderMount(staticFillMount, 0, true, new Set(), new Set());
  expect(staticFillMount.fillCommittedNativeChildren).toEqual(
    new Set([frostMount.instance.id]),
  );
  const representedNativeInstances = (
    runtime as typeof runtime & {
      representedNativeInstances(ids: Set<string>): Set<string>;
    }
  ).representedNativeInstances.bind(runtime);
  expect(
    representedNativeInstances(new Set([staticFillInstance.id])),
  ).toContain(frostMount.instance.id);
  fillProvider.readFillForeground = async () => [
    {
      rect: { x: 110, y: 10, width: 70, height: 40 },
      clip: { x: 110, y: 10, width: 70, height: 40 },
      nativeInstanceId: nestedFillMount.instance.id,
    },
  ];
  await runtime.renderMount(staticFillMount, 0, true, new Set(), new Set());
  expect(staticFillMount.fillCommittedNativeChildren).toEqual(
    new Set([nestedFillMount.instance.id]),
  );
  expect(representedNativeInstances(new Set([staticFillInstance.id]))).toEqual(
    new Set([
      staticFillInstance.id,
      nestedFillMount.instance.id,
      frostMount.instance.id,
    ]),
  );
  const nestedOutput = nestedFillMount.outputTexture;
  nestedFillMount.outputTexture = null;
  expect(representedNativeInstances(new Set([staticFillInstance.id]))).toEqual(
    new Set([staticFillInstance.id]),
  );
  nestedFillMount.outputTexture = nestedOutput;
  fillProvider.readFillForeground = async () => [];
  let releaseNestedValidation!: () => void;
  const nestedValidation = new Promise<void>((resolve) => {
    releaseNestedValidation = resolve;
  });
  const popNestedValidation = device.popErrorScope;
  device.popErrorScope = async () => {
    await nestedValidation;
    return null;
  };
  const nestedSubmitted = submittedFrames;
  const staleNestedFrame = runtime.renderMount(
    staticFillMount,
    0,
    true,
    new Set(),
    new Set(),
  );
  await vi.waitFor(() => expect(submittedFrames).toBe(nestedSubmitted + 1));
  fillEpoch = 1;
  releaseNestedValidation();
  await expect(staleNestedFrame).rejects.toMatchObject({
    code: "source-epoch-stale",
  });
  expect(staticFillMount.fillCommittedNativeChildren).toEqual(
    new Set([nestedFillMount.instance.id]),
  );
  device.popErrorScope = popNestedValidation;
  fillEpoch = 0;
  clippedForeground = true;
  fillProvider.readFillForeground = async () => [
    {
      rect: { x: 110, y: 10, width: 70, height: 40 },
      clip: { x: 200, y: 10, width: 70, height: 40 },
      nativeInstanceId: frostMount.instance.id,
    },
  ];
  await runtime.renderMount(staticFillMount, 0, true, new Set(), new Set());
  expect(staticFillMount.fillCommittedNativeChildren.size).toBe(0);
  expect(
    representedNativeInstances(new Set([staticFillInstance.id])),
  ).not.toContain(frostMount.instance.id);
  staticFillMount.resourceTextures = new Map();
  staticFillMount.outputTexture = null;
  runtime.mounts = new Map([[staticFillInstance.id, staticFillMount]]);
  fillProvider.readFillForeground = async () => [];
  ownPaintScenes = {
    "inset-shadow": [
      {
        rect: { x: 0, y: 0, width: 128, height: 64 },
        clip: { x: 0, y: 0, width: 128, height: 64 },
      },
    ],
    "outer-shadow": [
      {
        rect: { x: -10, y: 0, width: 138, height: 64 },
        clip: { x: -10, y: 0, width: 138, height: 64 },
      },
    ],
    outline: [
      {
        rect: { x: 0, y: 0, width: 140, height: 64 },
        clip: { x: 0, y: 0, width: 140, height: 64 },
      },
    ],
  };
  const phaseTextures: string[] = [];
  const phaseRuntime = runtime as typeof runtime & {
    composeScene(...args: unknown[]): Promise<object>;
  };
  const composePhase = vi
    .spyOn(phaseRuntime, "composeScene")
    .mockImplementation(async (surface: unknown, _records, _encoder, key) => {
      phaseTextures.push(String(key));
      const size = surface as { width: number; height: number };
      return runtime.texture(size.width, size.height, "rgba8unorm");
    });
  expect(await runtime.renderInternal(0, true)).toMatchObject({ failures: [] });
  composePhase.mockRestore();
  expect(ownPaintCalls.slice(-3)).toEqual([
    "inset-shadow",
    "outer-shadow",
    "outline",
  ]);
  expect(phaseTextures).toEqual([
    "__native_fill_inset_shadow",
    "__native_fill_outer_shadow",
    "__native_fill_child",
  ]);
  expect(staticFillMount.fillPresentationExtent).toMatchObject({
    width: 150,
    height: 64,
    left: 10,
    right: 12,
  });
  expect(staticFillMount.outputTexture).toMatchObject({
    width: 150,
    height: 64,
  });
  ownPaintScenes = {};
  frostTarget.remove();
  fillTarget.append(frostTarget);
  const frostCanvas = document.createElement("canvas");
  frostCanvas.width = 70;
  frostCanvas.height = 40;
  frostTarget.append(frostCanvas);
  const frostSource = runtime.texture(70, 40, "rgba8unorm");
  const frostBefore = runtime.texture(70, 40, "rgba8unorm");
  const secondSource = runtime.texture(70, 40, "rgba8unorm");
  const prefixFlags: boolean[] = [];
  const frostProvider = {
    ...fillProvider,
    authoredSourceEpoch: () => fillEpoch,
    readScene: async (
      _metrics: unknown,
      _site: unknown,
      prefix: unknown,
    ): Promise<
      {
        kind: string;
        key: number;
        revision: number;
        sourceRole?: string;
        nativeInstanceId?: string;
      }[]
    > => {
      prefixFlags.push((prefix as { unpublished: boolean }).unpublished);
      expect(prefix).toMatchObject({
        ancestor: fillTarget,
        instanceId: staticFillInstance.id,
        width: 128,
      });
      return [
        { kind: "dom", key: 1, revision: 0 },
        {
          kind: "native",
          sourceRole: "ancestor-fill-prefix",
          nativeInstanceId: staticFillInstance.id,
          key: 2,
          revision: 0,
        },
      ];
    },
  };
  const liveFrost = {
    ...frostMount,
    definition: staticFillDefinition,
    provider: frostProvider,
    canvas: frostCanvas,
    width: 70,
    height: 40,
    outputTexture: frostBefore,
    outputExtent: {
      ...staticFillMount.outputExtent,
      width: 70,
      height: 40,
      sourceWidth: 70,
      sourceHeight: 40,
    },
    resourceTextures: new Map(),
    frameCount: 0,
  };
  let secondFrost: typeof liveFrost | null = null;
  fillProvider.readFillForeground = async () => [
    {
      rect: { x: 110, y: 10, width: 70, height: 40 },
      clip: { x: 110, y: 10, width: 70, height: 40 },
      nativeInstanceId: liveFrost.instance.id,
    },
  ];
  runtime.mounts = new Map<string, object>([
    [staticFillInstance.id, staticFillMount],
    [liveFrost.instance.id, liveFrost],
  ]);
  runtime.renderMount = renderWithNestedBackdrop;
  const nestedRuntime = runtime as typeof runtime & {
    effectPasses(...args: unknown[]): Promise<object>;
  };
  const originalEffectPasses = nestedRuntime.effectPasses.bind(nestedRuntime);
  const nestedEffectPasses = vi
    .spyOn(nestedRuntime, "effectPasses")
    .mockImplementation(async (candidate: unknown, ...args: unknown[]) =>
      candidate === liveFrost
        ? frostSource
        : candidate === secondFrost
          ? secondSource
          : originalEffectPasses(candidate, ...args),
    );
  const originalFinish = runtime.finish.bind(runtime);
  const nestedFinish = vi
    .spyOn(runtime, "finish")
    .mockImplementation(async (candidate, ...args) =>
      candidate === liveFrost
        ? frostSource
        : candidate === secondFrost
          ? secondSource
          : originalFinish(candidate, ...args),
    );
  const nestedCompose = vi
    .spyOn(phaseRuntime, "composeScene")
    .mockImplementation(
      async (surface, records, _encoder, _name, _mode, _nested, overrides) => {
        if (surface === liveFrost) {
          expect(records).toEqual([
            expect.objectContaining({ kind: "dom" }),
            expect.objectContaining({ sourceRole: "ancestor-fill-prefix" }),
          ]);
          expect(
            (overrides as Map<string, object>).get(staticFillInstance.id),
          ).toMatchObject({
            width: 128,
            height: 64,
          });
          return frostSource;
        }
        if (surface === secondFrost) {
          expect(records).toEqual([
            expect.objectContaining({ sourceRole: "ancestor-fill-prefix" }),
            expect.objectContaining({
              nativeInstanceId: liveFrost.instance.id,
            }),
          ]);
          expect(
            (overrides as Map<string, object>).get(liveFrost.instance.id),
          ).toBe(frostSource);
          return secondSource;
        }
        const size = surface as { width: number; height: number };
        return runtime.texture(size.width, size.height, "rgba8unorm");
      },
    );
  const childCanvasPresent = vi.spyOn(runtime, "present");
  staticFillMount.outputTexture = null;
  fillTarget.removeAttribute("data-an-native-fill-instance");
  await runtime.renderMount(staticFillMount, 0, true, new Set(), new Set());
  expect(prefixFlags).toEqual([true]);
  expect(liveFrost.outputTexture).toBe(frostSource);
  expect(staticFillMount.fillCommittedNativeChildren).toContain(
    liveFrost.instance.id,
  );
  expect(
    childCanvasPresent.mock.calls.every(
      ([candidate]) => candidate !== liveFrost,
    ),
  ).toBe(true);
  const publishedFill = staticFillMount.outputTexture;
  let releasePrefixValidation!: () => void;
  const prefixValidation = new Promise<void>((resolve) => {
    releasePrefixValidation = resolve;
  });
  const beforePrefixSubmission = submittedFrames;
  device.popErrorScope = async () => {
    await prefixValidation;
    return null;
  };
  const stalePrefix = runtime.renderMount(
    staticFillMount,
    0,
    true,
    new Set(),
    new Set(),
  );
  await vi.waitFor(() =>
    expect(submittedFrames).toBe(beforePrefixSubmission + 1),
  );
  fillEpoch = 1;
  releasePrefixValidation();
  await expect(stalePrefix).rejects.toMatchObject({
    code: "source-epoch-stale",
  });
  expect(prefixFlags).toEqual([true, false]);
  expect(staticFillMount.outputTexture).toBe(publishedFill);
  expect(liveFrost.outputTexture).toBe(frostSource);
  device.popErrorScope = popNestedValidation;
  fillEpoch = 0;
  fillTarget.removeAttribute("data-an-native-fill-instance");
  expect(staticFillMount.outputTexture).toBe(publishedFill);
  await runtime.renderMount(staticFillMount, 0, true, new Set(), new Set());
  expect(prefixFlags).toEqual([true, false, true]);
  expect(fillTarget.getAttribute("data-an-native-fill-instance")).toBe(
    staticFillInstance.id,
  );
  const secondTarget = document.createElement("div");
  const secondCanvas = document.createElement("canvas");
  secondCanvas.width = 70;
  secondCanvas.height = 40;
  secondTarget.append(secondCanvas);
  fillTarget.append(secondTarget);
  const nextFrost = {
    ...liveFrost,
    instance: { ...liveFrost.instance, id: "nested-frost-second" },
    target: secondTarget,
    canvas: secondCanvas,
    provider: {
      ...frostProvider,
      readScene: async () => [
        {
          kind: "native",
          sourceRole: "ancestor-fill-prefix",
          nativeInstanceId: staticFillInstance.id,
          key: 2,
          revision: 0,
        },
        {
          kind: "native",
          nativeInstanceId: liveFrost.instance.id,
          key: 3,
          revision: 0,
        },
      ],
    },
    outputTexture: frostBefore,
    resourceTextures: new Map(),
    frameCount: 0,
  };
  secondFrost = nextFrost;
  fillProvider.readFillForeground = async () => [
    {
      rect: { x: 110, y: 10, width: 70, height: 40 },
      clip: { x: 110, y: 10, width: 70, height: 40 },
      nativeInstanceId: liveFrost.instance.id,
    },
    {
      rect: { x: 120, y: 10, width: 70, height: 40 },
      clip: { x: 120, y: 10, width: 70, height: 40 },
      nativeInstanceId: nextFrost.instance.id,
    },
  ];
  runtime.mounts = new Map<string, object>([
    [staticFillInstance.id, staticFillMount],
    [nextFrost.instance.id, nextFrost],
    [liveFrost.instance.id, liveFrost],
  ]);
  await runtime.renderMount(staticFillMount, 0, true, new Set(), new Set());
  expect(nextFrost.outputTexture).toBe(secondSource);
  childCanvasPresent.mockRestore();
  nestedCompose.mockRestore();
  nestedFinish.mockRestore();
  nestedEffectPasses.mockRestore();
  runtime.mounts.clear();
  runtime.dispose();
});
