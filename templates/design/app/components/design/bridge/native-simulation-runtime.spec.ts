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
  const fillCanvas = document.createElement("canvas");
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
  const fillProvider = {
    needsContinuousFrames: () => false,
    captureCount: () => 0,
    setLayerTargetOpacityDeferred() {},
    setDensity() {},
    setGroupLocalBackdropSource() {},
    sourceEpoch: () => fillEpoch,
    readFillBoxPhase: async (_paint: object, phase: string) => [
      {
        source: fillSource,
        key: phase,
        revision: fillEpoch,
      },
    ],
    hasFillGlyph: () => false,
    readFillForeground: async () => [],
  };
  const fillMount = {
    ...mount,
    instance: fillInstance,
    definition: fillDefinition,
    target: fillTarget,
    canvas: fillCanvas,
    provider: fillProvider,
    authoredFillPaint: {},
    resourceTextures: new Map(),
    simulation: null,
    simulationFrame: null,
    outputTexture: null,
    suppressed: false,
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
  expect(fillCanvas.style.visibility).toBe("visible");
  const retainedFill = fillMount.simulation as unknown as {
    readIndex: number;
    completedStep: number;
  };
  const retainedFillTrail = fillMount.resourceTextures.get("trail");
  const retainedFillOutput = fillMount.outputTexture;
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
  expect(fillMount.suppressed).toBe(true);
  expect(fillCanvas.style.visibility).toBe("visible");
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
  expect(fillCanvas.style.visibility).toBe("visible");
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
  let releaseRejectedRestore!: () => void;
  const rejectedRestoreFence = new Promise<void>((resolve) => {
    releaseRejectedRestore = resolve;
  });
  device.queue.onSubmittedWorkDone = () => rejectedRestoreFence;
  const originalPopErrorScope = device.popErrorScope;
  let errorScopePops = 0;
  device.popErrorScope = async () =>
    ++errorScopePops === 2 ? { message: "restored output rejected" } : null;
  const rejectedRestoreSubmissions = submittedFrames;
  const rejectedRestore = runtime.renderInternal(1 / 120, true);
  await vi.waitFor(() =>
    expect(submittedFrames).toBe(rejectedRestoreSubmissions + 1),
  );
  fillEpoch = 1;
  releaseRejectedRestore();
  const rejectedRestoreResult = await rejectedRestore;
  expect(rejectedRestoreResult).toMatchObject({
    failures: [expect.objectContaining({ code: "simulation-restore-failed" })],
  });
  expect(errorScopePops).toBe(2);
  expect(fillMount.suppressed).toBe(false);
  expect(fillCanvas.style.visibility).toBe("hidden");
  expect(fillTarget.getAttribute("data-an-native-status")).toBe("error");
  device.popErrorScope = originalPopErrorScope;
  device.queue.onSubmittedWorkDone = async () => {};
  fillEpoch = 0;
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
  runtime.mounts.clear();
  runtime.dispose();
});
