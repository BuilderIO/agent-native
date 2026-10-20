import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EffectDefinition,
  EffectInstance,
} from "../../../../shared/native-effects";
import { NativeWorkerGpu } from "./native-worker-gpu";
import type { NativeWorkerEffectTarget } from "./native-worker-protocol";
import type { NativeWorkerScene } from "./native-worker-protocol";

type MockTexture = GPUTexture & { destroy: ReturnType<typeof vi.fn> };

function scene(generation: number, width = 20, height = 10): NativeWorkerScene {
  return {
    sceneId: "scene-a",
    generation,
    width,
    height,
    pixelRatio: 2,
    viewport: { x: -3, y: 5, width: width / 2, height: height / 2 },
    colorSpace: "srgb",
  } as NativeWorkerScene;
}

function harness() {
  const textures: MockTexture[] = [];
  const context = {
    configure: vi.fn(),
    unconfigure: vi.fn(),
  };
  const device = {
    limits: {
      minUniformBufferOffsetAlignment: 256,
      maxSampledTexturesPerShaderStage: 16,
    },
    queue: {
      writeBuffer: vi.fn(),
      writeTexture: vi.fn(),
      copyExternalImageToTexture: vi.fn(),
    },
    createSampler: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    createBindGroup: vi.fn((_descriptor: { entries: unknown[] }) => ({})),
    createBindGroupLayout: vi.fn(
      (descriptor: { entries: unknown[] }) => descriptor,
    ),
    createPipelineLayout: vi.fn(
      (descriptor: { bindGroupLayouts: unknown[] }) => descriptor,
    ),
    createShaderModule: vi.fn(() => ({
      getCompilationInfo: async () => ({ messages: [] }),
    })),
    createRenderPipelineAsync: vi.fn(
      async (descriptor: { layout: { bindGroupLayouts: unknown[] } }) => ({
        getBindGroupLayout: () => descriptor.layout.bindGroupLayouts[0],
      }),
    ),
    createTexture: vi.fn(
      (descriptor: {
        size: readonly [number, number];
        format?: GPUTextureFormat;
        usage?: number;
      }) => {
        const texture = {
          width: descriptor.size[0],
          height: descriptor.size[1],
          createView: vi.fn(() => ({})),
          destroy: vi.fn(),
        } as unknown as MockTexture;
        textures.push(texture);
        return texture;
      },
    ),
  };
  const canvas = {
    width: 1,
    height: 1,
    getContext: vi.fn(() => context),
  };
  return {
    textures,
    context,
    device,
    canvas,
    gpu: NativeWorkerGpu.create(
      "scene-a",
      canvas as unknown as OffscreenCanvas,
      device as unknown as GPUDevice,
    ),
  };
}

beforeEach(() => {
  vi.stubGlobal("GPUTextureUsage", {
    COPY_SRC: 1,
    COPY_DST: 2,
    TEXTURE_BINDING: 4,
    RENDER_ATTACHMENT: 8,
  });
  vi.stubGlobal("GPUBufferUsage", { UNIFORM: 1, COPY_DST: 2 });
  vi.stubGlobal("GPUShaderStage", { VERTEX: 1, FRAGMENT: 2 });
  vi.stubGlobal("navigator", {
    gpu: { getPreferredCanvasFormat: () => "rgba8unorm" },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("worker GPU resource lifetime", () => {
  it("charges shared texture and transient readback reservations before allocation", async () => {
    const { gpu: pending, device } = harness();
    const gpu = await pending;
    const initialBytes = gpu.resourceBytes();
    const shared = vi.fn((bytes: number) => {
      if (bytes > 512) throw new Error("shared budget reached");
    });
    gpu.setSharedBudget(shared);
    const bank = gpu.spareBank(scene(1));
    const textureCount = device.createTexture.mock.calls.length;
    expect(() => gpu.texture(bank, "oversized", 20, 10)).toThrow(
      "shared budget reached",
    );
    expect(device.createTexture).toHaveBeenCalledTimes(textureCount);
    expect(gpu.resourceBytes()).toBe(initialBytes);

    gpu.reserveTransient(256, "export:readback");
    expect(shared).toHaveBeenCalledWith(256, "export:readback");
    expect(gpu.resourceBytes()).toBe(initialBytes + 256);
    gpu.releaseTransient(256);
    expect(gpu.resourceBytes()).toBe(initialBytes);
    gpu.dispose();
  });

  it("keeps immutable asset revisions until each revision retires", async () => {
    const { gpu: pending, device } = harness();
    const gpu = await pending;
    const data = new ArrayBuffer(2 * 2 * 8);
    const initialWrites = device.queue.writeTexture.mock.calls.length;
    const asset = (revision: number) => ({
      kind: "rgba16float" as const,
      sceneId: "scene-a",
      generation: revision,
      assetId: "paint",
      revision,
      width: 2,
      height: 2,
      data,
    });
    gpu.uploadAsset(asset(1));
    const first = gpu.asset("paint", 1, 1);
    gpu.uploadAsset(asset(2));
    const second = gpu.asset("paint", 2, 2);
    expect(second).not.toBe(first);
    expect(gpu.asset("paint", 1, 2)).toBe(first);
    gpu.uploadAsset(asset(1));
    expect(device.queue.writeTexture).toHaveBeenCalledTimes(initialWrites + 2);

    gpu.retireAssets(new Set([NativeWorkerGpu.assetKey("paint", 2)]));
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(second.destroy).not.toHaveBeenCalled();
    expect(gpu.hasAsset("paint", 1, 3)).toBe(false);
    expect(gpu.asset("paint", 2, 3)).toBe(second);
    gpu.dispose();
    expect(second.destroy).toHaveBeenCalledTimes(1);
  });

  it("closes transferred bitmaps after upload, duplicate, and rejected assets", async () => {
    const { gpu: pending, device, textures } = harness();
    const gpu = await pending;
    const bitmap = () => ({ width: 2, height: 3, close: vi.fn() });
    const first = bitmap();
    const asset = (value: ReturnType<typeof bitmap>, sceneId = "scene-a") => ({
      kind: "bitmap" as const,
      sceneId,
      generation: 1,
      assetId: "image",
      revision: 1,
      bitmap: value as unknown as ImageBitmap,
    });
    gpu.uploadAsset(asset(first));
    expect(first.close).toHaveBeenCalledTimes(1);
    const uploaded = device.createTexture.mock.calls.find(
      ([descriptor]) => descriptor.format === "rgba8unorm-srgb",
    )?.[0];
    expect(uploaded?.usage).toBe(15);
    const duplicate = bitmap();
    gpu.uploadAsset(asset(duplicate));
    expect(duplicate.close).toHaveBeenCalledTimes(1);
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(1);

    const wrongScene = bitmap();
    expect(() => gpu.uploadAsset(asset(wrongScene, "scene-b"))).toThrow(
      "another worker scene",
    );
    expect(wrongScene.close).toHaveBeenCalledTimes(1);
    const invalid = { width: 0, height: 2, close: vi.fn() };
    expect(() => gpu.uploadAsset({ ...asset(invalid), revision: 2 })).toThrow(
      "texture limits",
    );
    expect(invalid.close).toHaveBeenCalledTimes(1);
    const failing = bitmap();
    device.queue.copyExternalImageToTexture.mockImplementationOnce(() => {
      throw new Error("copy failed");
    });
    expect(() => gpu.uploadAsset({ ...asset(failing), revision: 3 })).toThrow(
      "copy failed",
    );
    expect(failing.close).toHaveBeenCalledTimes(1);
    expect(textures[textures.length - 1]?.destroy).toHaveBeenCalledTimes(1);
    expect(gpu.hasAsset("image", 3, 1)).toBe(false);
    gpu.dispose();
  });

  it("reuses the working bank at full display DPR and replaces it only when geometry changes", async () => {
    const { gpu: pending } = harness();
    const gpu = await pending;
    const firstScene = scene(1);
    const firstBank = gpu.spareBank(firstScene);
    expect([firstBank.width, firstBank.height, firstBank.pixelRatio]).toEqual([
      20, 10, 2,
    ]);
    const texture = gpu.texture(
      firstBank,
      "root",
      firstScene.width,
      firstScene.height,
    );
    const secondBank = gpu.spareBank(scene(2));
    expect(secondBank).toBe(firstBank);
    expect(gpu.texture(secondBank, "root", 20, 10)).toBe(texture);
    expect(texture.destroy).not.toHaveBeenCalled();

    const resized = gpu.spareBank(scene(3, 24, 12));
    expect(resized).toBe(firstBank);
    expect([resized.width, resized.height, resized.pixelRatio]).toEqual([
      24, 12, 2,
    ]);
    expect(texture.destroy).toHaveBeenCalledTimes(1);
    expect(gpu.texture(resized, "root", 24, 12)).not.toBe(texture);
    gpu.dispose();
  });

  it("keeps fixed target resources across a compatible root resize and retires changed keys", async () => {
    const { gpu: pending, device } = harness();
    const gpu = await pending;
    const pipeline = await gpu.pipeline("source-only", "rgba16float", false, 1);
    const draw = (
      generation: number,
      width: number,
      height: number,
      targetWidth: number,
      drawTarget = true,
    ) => {
      const bank = gpu.spareBank(
        scene(generation, width, height),
        "same-composition",
      );
      gpu.beginFrame();
      const root = gpu.texture(bank, "composition:root", width, height);
      const rootGroup = gpu.bind(
        bank,
        "root-draw",
        pipeline,
        root,
        null,
        new Float32Array([generation]),
      );
      const target = drawTarget
        ? gpu.texture(bank, "effect:fixed", targetWidth, 6)
        : null;
      const targetGroup = target
        ? gpu.bind(
            bank,
            "target-draw",
            pipeline,
            target,
            null,
            new Float32Array([generation]),
          )
        : null;
      gpu.uploadFrame();
      gpu.finishFrame();
      gpu.trimWork(bank);
      return { bank, root, rootGroup, target, targetGroup };
    };
    const first = draw(1, 20, 10, 8);
    const arena = (
      gpu as unknown as { uniformArena: { slots: Map<string, unknown> } }
    ).uniformArena;
    const firstBytes = gpu.resourceBytes();
    const resized = draw(2, 24, 12, 8);
    expect(resized.bank).toBe(first.bank);
    expect(resized.root).not.toBe(first.root);
    expect(first.root.destroy).toHaveBeenCalledOnce();
    expect(resized.target).toBe(first.target);
    expect(resized.targetGroup).toBe(first.targetGroup);
    expect(resized.rootGroup).not.toBe(first.rootGroup);
    expect((gpu as unknown as { uniformArena: unknown }).uniformArena).toBe(
      arena,
    );
    expect(device.createBindGroup).toHaveBeenCalledTimes(3);
    expect(gpu.resourceBytes()).toBe(firstBytes + (24 * 12 - 20 * 10) * 8);

    const changedTarget = draw(3, 24, 12, 9);
    expect(changedTarget.root).toBe(resized.root);
    expect(changedTarget.rootGroup).toBe(resized.rootGroup);
    expect(changedTarget.target).not.toBe(resized.target);
    expect(resized.target?.destroy).toHaveBeenCalledOnce();
    expect(changedTarget.targetGroup).not.toBe(resized.targetGroup);
    expect(gpu.resourceBytes()).toBe(
      firstBytes + (24 * 12 - 20 * 10) * 8 + 6 * 8,
    );

    const withoutTarget = draw(4, 24, 12, 9, false);
    expect(withoutTarget.root).toBe(resized.root);
    expect(changedTarget.target?.destroy).toHaveBeenCalledOnce();
    expect(withoutTarget.bank.textures.size).toBe(1);
    expect(withoutTarget.bank.bindings.size).toBe(1);
    expect(gpu.resourceBytes()).toBe(
      firstBytes + (24 * 12 - 20 * 10) * 8 - 8 * 6 * 8,
    );
    for (let generation = 5; generation <= 16; generation++) {
      const width = generation % 2 ? 20 : 24;
      const height = generation % 2 ? 10 : 12;
      const next = draw(generation, width, height, 9, false);
      expect(next.bank.textures.size).toBe(1);
      expect(next.bank.bindings.size).toBe(1);
      expect(gpu.resourceBytes()).toBe(
        firstBytes + (width * height - 20 * 10) * 8 - 8 * 6 * 8,
      );
    }
    gpu.dispose();
  });

  it("resets working resources when density changes despite a matching signature", async () => {
    const { gpu: pending } = harness();
    const gpu = await pending;
    const bank = gpu.spareBank(scene(1), "same-composition");
    const target = gpu.texture(bank, "effect:fixed", 8, 6);
    const arena = (gpu as unknown as { uniformArena: unknown }).uniformArena;

    gpu.spareBank({ ...scene(2), pixelRatio: 3 }, "same-composition");
    expect(target.destroy).toHaveBeenCalledOnce();
    expect(bank.textures.size).toBe(0);
    expect((gpu as unknown as { uniformArena: unknown }).uniformArena).not.toBe(
      arena,
    );
    gpu.dispose();
  });

  it("keeps the validated final while a compatible viewport resize replaces only its spare", async () => {
    const { gpu: pending } = harness();
    const gpu = await pending;
    const encoder = {
      copyTextureToTexture: vi.fn(),
    } as unknown as GPUCommandEncoder;
    const firstScene = scene(1);
    const bank = gpu.spareBank(firstScene, "same-composition");
    const firstRoot = gpu.texture(bank, "composition:root", 20, 10);
    const firstFinal = gpu.stageFinal(firstScene, firstRoot, encoder);
    gpu.publish(bank, firstFinal, firstScene);

    const resizedScene = scene(2, 24, 12);
    gpu.spareBank(resizedScene, "same-composition");
    const nextRoot = gpu.texture(bank, "composition:root", 24, 12);
    const nextFinal = gpu.stageFinal(resizedScene, nextRoot, encoder);
    expect(gpu.frontTexture()).toBe(firstFinal);
    expect(firstFinal.destroy).not.toHaveBeenCalled();
    expect(nextFinal).not.toBe(firstFinal);
    gpu.publish(bank, nextFinal, resizedScene);
    expect(gpu.frontTexture()).toBe(nextFinal);
    gpu.trimWork(bank);
    gpu.dispose();
  });

  it("retains camera bind groups across reordered draws and resets them for changed content or geometry", async () => {
    const { gpu: pending, device } = harness();
    const gpu = await pending;
    const pipeline = await gpu.pipeline("source-only", "rgba16float", false, 1);
    const draw = (
      generation: number,
      signature: string,
      keys: readonly string[],
      width = 20,
      height = 10,
    ) => {
      const bank = gpu.spareBank(scene(generation, width, height), signature);
      gpu.beginFrame();
      const source = gpu.texture(bank, "root", width, height);
      const groups = new Map(
        keys.map((key) => [
          key,
          gpu.bind(
            bank,
            key,
            pipeline,
            source,
            null,
            new Float32Array([generation]),
          ),
        ]),
      );
      gpu.uploadFrame();
      gpu.finishFrame();
      gpu.trimWork(bank);
      return { bank, source, groups };
    };
    const first = draw(1, "camera-source", ["a", "b"]);
    for (let generation = 2; generation <= 12; generation++) {
      const next = draw(generation, "camera-source", ["b", "a"]);
      expect(next.source).toBe(first.source);
      expect(next.groups.get("a")).toBe(first.groups.get("a"));
      expect(next.groups.get("b")).toBe(first.groups.get("b"));
    }
    expect(device.createBindGroup).toHaveBeenCalledTimes(2);
    expect(first.bank.bindings.size).toBe(2);
    expect(
      (
        gpu as unknown as {
          uniformArena: { slots: Map<string, unknown> };
        }
      ).uniformArena.slots.size,
    ).toBe(2);

    const changed = draw(13, "new-content", ["a", "b"]);
    expect(changed.source).toBe(first.source);
    expect(changed.groups.get("a")).not.toBe(first.groups.get("a"));
    expect(device.createBindGroup).toHaveBeenCalledTimes(4);

    const resized = draw(14, "new-content", ["a", "b"], 24, 12);
    expect(resized.source).not.toBe(first.source);
    expect(first.source.destroy).toHaveBeenCalledTimes(1);
    expect(resized.groups.get("a")).not.toBe(changed.groups.get("a"));
    expect(device.createBindGroup).toHaveBeenCalledTimes(6);
    gpu.dispose();
  });

  it("rebuilds a retained bind group if its uniform buffer changes", async () => {
    const { gpu: pending, device } = harness();
    const gpu = await pending;
    const pipeline = await gpu.pipeline("source-only", "rgba16float", false, 1);
    const bank = gpu.spareBank(scene(1), "camera-source");
    gpu.beginFrame();
    const source = gpu.texture(bank, "root", 20, 10);
    const first = gpu.bind(
      bank,
      "draw",
      pipeline,
      source,
      null,
      new Float32Array([1]),
    );
    gpu.uploadFrame();
    gpu.finishFrame();
    bank.bindings.get("draw:0")!.buffer = {} as GPUBuffer;
    gpu.spareBank(scene(2), "camera-source");
    gpu.beginFrame();
    const second = gpu.bind(
      bank,
      "draw",
      pipeline,
      source,
      null,
      new Float32Array([2]),
    );
    expect(second).not.toBe(first);
    expect(device.createBindGroup).toHaveBeenCalledTimes(2);
    gpu.uploadFrame();
    gpu.finishFrame();
    gpu.dispose();
  });

  it("resets packed uniform slots after a rejected scene", async () => {
    const { gpu: pending } = harness();
    const gpu = await pending;
    const pipeline = await gpu.pipeline(
      "uniform-only",
      "rgba16float",
      false,
      0,
    );
    const bank = gpu.spareBank(scene(1), "first-content");
    gpu.beginFrame();
    gpu.bind(bank, "draw", pipeline, null, null, new Float32Array([1]));
    gpu.uploadFrame();
    gpu.finishFrame();
    gpu.reject(bank);

    gpu.spareBank(scene(2), "next-content");
    gpu.beginFrame();
    expect(() =>
      gpu.bind(
        bank,
        "draw",
        pipeline,
        null,
        null,
        new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]),
      ),
    ).not.toThrow();
    gpu.uploadFrame();
    gpu.finishFrame();
    gpu.dispose();
  });

  it("keeps the published final alive when a staged frame is rejected", async () => {
    const { gpu: pending } = harness();
    const gpu = await pending;
    const firstScene = scene(1);
    const bank = gpu.spareBank(firstScene);
    const source = gpu.texture(bank, "root", 20, 10);
    const copies: Array<[GPUTexture, GPUTexture]> = [];
    const encoder = {
      copyTextureToTexture: vi.fn(
        (from: { texture: GPUTexture }, to: { texture: GPUTexture }) => {
          copies.push([from.texture, to.texture]);
        },
      ),
    } as unknown as GPUCommandEncoder;
    const firstFinal = gpu.stageFinal(firstScene, source, encoder);
    gpu.publish(bank, firstFinal, firstScene);
    expect(gpu.frontTexture()).toBe(firstFinal);
    const secondScene = scene(2);
    const sameBank = gpu.spareBank(secondScene);
    const secondFinal = gpu.stageFinal(secondScene, source, encoder);
    expect(secondFinal).not.toBe(firstFinal);
    expect(copies).toEqual([
      [source, firstFinal],
      [source, secondFinal],
    ]);
    gpu.reject(sameBank);
    expect(gpu.frontTexture()).toBe(firstFinal);
    expect(firstFinal.destroy).not.toHaveBeenCalled();
    expect(secondFinal.destroy).not.toHaveBeenCalled();
    gpu.dispose();
  });

  it("retires work from deleted effects and changing export sizes after completed frames", async () => {
    const { gpu: pending, device } = harness();
    const gpu = await pending;
    const bank = gpu.spareBank(scene(1));
    const pipeline = await gpu.pipeline("source-only", "rgba16float", false, 1);
    const record = (
      generation: number,
      effectKey: string,
      exportWidth: number,
    ) => {
      gpu.spareBank(scene(generation));
      gpu.beginFrame();
      const root = gpu.texture(bank, "composition:root", 20, 10);
      const effect = gpu.texture(bank, `effect:${effectKey}`, 20, 10);
      const exportTexture = gpu.texture(
        bank,
        "export:output",
        exportWidth,
        10,
        "rgba8unorm",
      );
      gpu.bind(
        bank,
        `draw:${generation}`,
        pipeline,
        root,
        null,
        new Float32Array([generation]),
      );
      gpu.uploadFrame();
      gpu.finishFrame();
      gpu.trimWork(bank);
      return { root, effect, exportTexture };
    };
    const first = record(1, "deleted", 8);
    expect(
      device.createBindGroupLayout.mock.calls[0]?.[0].entries,
    ).toHaveLength(3);
    expect(device.createBindGroup.mock.calls[0]?.[0].entries).toHaveLength(3);
    const second = record(2, "survivor", 12);
    expect(first.root).toBe(second.root);
    expect(first.effect.destroy).toHaveBeenCalledTimes(1);
    expect(first.exportTexture.destroy).toHaveBeenCalledTimes(1);
    for (let generation = 3; generation <= 12; generation++)
      record(generation, `temporary-${generation}`, 8 + generation);
    expect(bank.textures.size).toBe(3);
    expect(bank.bindings.size).toBeLessThanOrEqual(3);
    expect(gpu.resourceBytes()).toBeLessThan(2_200_000);
    gpu.dispose();
  });

  it("binds a uniform-only effect without sampler or image entries", async () => {
    const { gpu: pending, device } = harness();
    const gpu = await pending;
    const bank = gpu.spareBank(scene(1));
    const definition = {
      id: "uniform-only",
      name: "Uniform only",
      version: 1,
      kind: "generator",
      placements: ["fill"],
      properties: {},
      passes: [
        {
          id: "draw",
          kind: "render",
          wgsl: `struct Uniforms { values: array<vec4f, 34> };\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n@vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f { return vec4f(f32(index), 0.0, 0.0, 1.0); }\n@fragment fn fs() -> @location(0) vec4f { return uniforms.values[0]; }`,
          reads: [],
          output: "output",
        },
      ],
      resources: [
        {
          name: "output",
          kind: "texture-2d",
          format: "rgba8unorm",
          size: "viewport",
          usage: ["render", "sampled"],
        },
      ],
      output: "output",
      provenance: { origin: "user-authored" },
    } as EffectDefinition;
    const instance = {
      id: "fill-1",
      placement: "fill",
      params: {},
      seed: 1,
      timing: { time: 0, paused: false, speed: 1 },
    } as EffectInstance;
    const target = {
      width: 20,
      height: 10,
      pixelRatio: 2,
    } as NativeWorkerEffectTarget;
    const encoder = {
      beginRenderPass: () => ({
        setPipeline() {},
        setBindGroup() {},
        draw() {},
        end() {},
      }),
    } as unknown as GPUCommandEncoder;
    gpu.beginFrame();
    await gpu.effect(
      bank,
      target,
      definition,
      instance,
      gpu.transparentTexture(),
      0,
      encoder,
      new Map(),
    );
    expect(
      device.createBindGroupLayout.mock.calls[0]?.[0].entries,
    ).toHaveLength(1);
    expect(device.createBindGroup.mock.calls[0]?.[0].entries).toHaveLength(1);
    gpu.finishFrame();
    gpu.dispose();
  });
});
