// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

import { nativeShaderRuntimeBridgeScript } from "../../../../.generated/bridge/native-shader-runtime.generated";
import type {
  EffectDefinition,
  EffectInstance,
} from "../../../../shared/native-effects";

type Texture = {
  width: number;
  height: number;
  format: string;
  createView(): object;
  destroy: ReturnType<typeof vi.fn>;
};

type ResourceRuntime = {
  device: object;
  deviceEpoch: number;
  sampler: object;
  white: object;
  textureBytes: Map<Texture, number>;
  ensureDevice(): Promise<object>;
  texture(width: number, height: number, format?: string): Texture;
  destroyTexture(texture: Texture): void;
  releaseSimulation(mount: object): void;
  simulationPasses(
    mount: object,
    source: object,
    time: number,
    encoder: object,
    definition: EffectDefinition,
    instance: EffectInstance,
    deterministic: boolean,
  ): Promise<Texture>;
  dispose(): void;
};

const originalScript = Object.getOwnPropertyDescriptor(
  document,
  "currentScript",
);
const originalReady = Object.getOwnPropertyDescriptor(document, "readyState");
let runtime: ResourceRuntime | undefined;
let mount: { resourceTextures: Map<string, Texture> } | undefined;

afterEach(() => {
  if (runtime && mount) {
    runtime.releaseSimulation(mount);
    for (const texture of mount.resourceTextures.values())
      runtime.destroyTexture(texture);
    mount.resourceTextures.clear();
  }
  runtime?.dispose();
  runtime = undefined;
  mount = undefined;
  document.body.replaceChildren();
  for (const [name, descriptor] of [
    ["currentScript", originalScript],
    ["readyState", originalReady],
  ] as const) {
    if (descriptor) Object.defineProperty(document, name, descriptor);
    else Reflect.deleteProperty(document, name);
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each(["color", "trail", "__native_trail_back"])(
  "detaches particle resource %s before a refused replacement and retries cleanly",
  async (key) => {
    vi.stubGlobal("GPUBufferUsage", {
      COPY_SRC: 4,
      COPY_DST: 8,
      STORAGE: 128,
      UNIFORM: 64,
    });
    vi.stubGlobal("GPUTextureUsage", {
      COPY_SRC: 1,
      COPY_DST: 2,
      TEXTURE_BINDING: 4,
      RENDER_ATTACHMENT: 16,
    });
    vi.stubGlobal("GPUShaderStage", { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });
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
    new Function(nativeShaderRuntimeBridgeScript)();
    runtime = (window as Window & { __anNativeShaders?: ResourceRuntime })
      .__anNativeShaders;
    if (!runtime) throw new Error("Resource runtime fixture unavailable.");
    const active = runtime;
    const device = {
      limits: {
        maxComputeWorkgroupsPerDimension: 65535,
        maxStorageBufferBindingSize: 134_217_728,
      },
      queue: { writeBuffer() {} },
      createBuffer: () => ({ destroy() {} }),
      createTexture: ({
        size,
        format,
      }: {
        size: number[];
        format: string;
      }): Texture => ({
        width: size[0]!,
        height: size[1]!,
        format,
        createView: () => ({}),
        destroy: vi.fn(),
      }),
      createShaderModule: () => ({
        getCompilationInfo: async () => ({ messages: [] }),
      }),
      createBindGroupLayout: () => ({}),
      createPipelineLayout: () => ({}),
      createComputePipelineAsync: async () => ({}),
      createRenderPipelineAsync: async () => ({
        getBindGroupLayout: () => ({}),
      }),
      createBindGroup: () => ({}),
    };
    active.device = device;
    active.deviceEpoch = 1;
    active.sampler = {};
    active.white = { createView: () => ({}), destroy() {} };
    active.ensureDevice = async () => device;
    const definition: EffectDefinition = {
      id: "resource-ownership-fixture",
      name: "Resource ownership fixture",
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
      id: "resource-owner",
      nodeId: "resource-target",
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
    const surface = {
      instance,
      target,
      width: 2,
      height: 2,
      pixelRatio: 1,
      resourceTextures: new Map<string, Texture>(),
      drawBindings: new Map(),
      sourceTextures: new Map(),
      isolationTextures: new Map(),
      assetTextures: new Map(),
      simulation: null,
      feedback: null,
      simulationCaughtUp: true,
      clock: { global: 0, local: 0, speed: 1, paused: false },
      definition,
      outputTexture: null,
      provider: { needsContinuousFrames: () => false },
      animationCapability: "animated",
    };
    mount = surface;
    const encoder = {
      beginComputePass: () => ({
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups() {},
        end() {},
      }),
      beginRenderPass: () => ({
        setPipeline() {},
        setBindGroup() {},
        draw() {},
        end() {},
      }),
    };
    const source = { createView: () => ({}) };
    await active.simulationPasses(
      surface,
      source,
      0,
      encoder,
      definition,
      instance,
      true,
    );
    const previous = surface.resourceTextures.get(key);
    if (!previous) throw new Error("Particle cache fixture unavailable.");
    const incompatible = active.texture(1, 2, previous.format);
    surface.resourceTextures.set(key, incompatible);
    active.destroyTexture(previous);
    const refusal = new Error("Test particle allocation refused.");
    const allocation = vi
      .spyOn(active, "texture")
      .mockImplementation((width, height, format) => {
        expect(surface.resourceTextures.has(key)).toBe(false);
        expect(active.textureBytes.has(incompatible)).toBe(false);
        throw refusal;
      });
    await expect(
      active.simulationPasses(
        surface,
        source,
        1 / 120,
        encoder,
        definition,
        instance,
        true,
      ),
    ).rejects.toBe(refusal);
    expect(allocation).toHaveBeenCalledOnce();
    expect(surface.resourceTextures.has(key)).toBe(false);
    expect(incompatible.destroy).toHaveBeenCalledOnce();
    allocation.mockRestore();
    await active.simulationPasses(
      surface,
      source,
      2 / 120,
      encoder,
      definition,
      instance,
      true,
    );
    const replacement = surface.resourceTextures.get(key);
    expect(replacement).toMatchObject({ width: 2, height: 2 });
    expect(replacement).not.toBe(incompatible);
    expect(active.textureBytes.has(replacement!)).toBe(true);
    expect(incompatible.destroy).toHaveBeenCalledOnce();
    expect(previous.destroy).toHaveBeenCalledOnce();
  },
);
