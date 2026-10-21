import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FOLDED_MESH_EFFECT } from "../../../../shared/native-effect-folded-mesh";
import type {
  EffectDefinition,
  EffectInstance,
} from "../../../../shared/native-effects";
import { planNativePropertyLayout } from "../../../../shared/native-effects";
import { NativeWorkerGpu, NativeWorkerGpuError } from "./native-worker-gpu";
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
  vi.stubGlobal("GPUBufferUsage", { UNIFORM: 1, COPY_DST: 2, INDEX: 4 });
  vi.stubGlobal("GPUShaderStage", { VERTEX: 1, FRAGMENT: 2 });
  vi.stubGlobal("navigator", {
    gpu: { getPreferredCanvasFormat: () => "rgba8unorm" },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("worker GPU resource lifetime", () => {
  it("isolates two flight banks, uniforms, and pending finals while bounding admission", async () => {
    const { gpu: pending, device } = harness();
    const gpu = await pending;
    const current = scene(1);
    const first = gpu.tryAcquireFlight(current, "same-scene");
    expect(first.status).toBe("acquired");
    if (first.status !== "acquired")
      throw new Error("first flight unavailable");

    expect(gpu.tryAcquireFlight(scene(2, 24, 12), "same-scene")).toEqual({
      status: "capacity",
      reason: "incompatible-scene",
    });
    const second = gpu.tryAcquireFlight(current, "same-scene");
    expect(second.status).toBe("acquired");
    if (second.status !== "acquired")
      throw new Error("second flight unavailable");
    expect(second.lease.bank).not.toBe(first.lease.bank);
    expect(gpu.tryAcquireFlight(current, "same-scene")).toEqual({
      status: "capacity",
      reason: "flight-limit",
    });

    const pipeline = await gpu.pipeline(
      "flight-uniforms",
      "rgba16float",
      false,
      0,
    );
    for (const lease of [first.lease, second.lease]) {
      gpu.beginFrame(lease);
      gpu.bind(lease.bank, "draw", pipeline, null, null, new Float32Array([1]));
      gpu.uploadFrame(lease);
      gpu.finishFrame(lease);
    }
    const buffers = device.createBindGroup.mock.calls.map(
      ([descriptor]) =>
        (descriptor.entries[0] as { resource: { buffer: GPUBuffer } }).resource
          .buffer,
    );
    expect(buffers).toHaveLength(2);
    expect(buffers[0]).not.toBe(buffers[1]);

    const encoder = {
      copyTextureToTexture: vi.fn(),
    } as unknown as GPUCommandEncoder;
    const firstRoot = gpu.texture(first.lease.bank, "root", 1, 1);
    const secondRoot = gpu.texture(second.lease.bank, "root", 1, 1);
    const firstFinal = gpu.stageFinal(first.lease, current, firstRoot, encoder);
    const secondFinal = gpu.stageFinal(
      second.lease,
      current,
      secondRoot,
      encoder,
    );
    expect(secondFinal).not.toBe(firstFinal);
    gpu.markFlightSubmitted(first.lease);
    gpu.markFlightSubmitted(second.lease);
    gpu.validatePublication(first.lease, firstFinal);
    gpu.publish(first.lease, firstFinal, current);
    expect(gpu.frontTexture()).toBe(firstFinal);
    gpu.validatePublication(second.lease, secondFinal);
    gpu.publish(second.lease, secondFinal, current);
    expect(gpu.frontTexture()).toBe(secondFinal);
    gpu.releaseFlight(first.lease);
    gpu.releaseFlight(second.lease);
    expect(gpu.tryAcquireFlight(current, "same-scene").status).toBe("acquired");
    gpu.dispose();
  });

  it("returns typed second-flight capacity without changing the first reservation", async () => {
    const { gpu: pending } = harness();
    const gpu = await pending;
    let reservations = 0;
    gpu.setSharedBudget((_bytes, key) => {
      if (key !== "flight:reserve") return;
      reservations++;
      if (reservations === 2)
        throw new NativeWorkerGpuError(
          "gpu-shared-budget-exceeded",
          "shared budget reached",
        );
    });
    const first = gpu.tryAcquireFlight(scene(1), "same-scene");
    expect(first.status).toBe("acquired");
    if (first.status !== "acquired")
      throw new Error("first flight unavailable");
    const beforeSecond = gpu.resourceBytes();
    expect(gpu.tryAcquireFlight(scene(1), "same-scene")).toEqual({
      status: "capacity",
      reason: "memory-budget",
    });
    expect(gpu.resourceBytes()).toBe(beforeSecond);
    gpu.releaseFlight(first.lease);
    gpu.dispose();
  });

  it("rotates three finals across repeated A/B/C publication without replacing the visible front", async () => {
    const { gpu: pending } = harness();
    const gpu = await pending;
    const current = scene(1);
    const encoder = {
      copyTextureToTexture: vi.fn(),
    } as unknown as GPUCommandEncoder;
    const finalHistory = new Set<GPUTexture>();
    let steadyResourceBytes = 0;

    for (let frame = 0; frame < 16; frame++) {
      const first = gpu.tryAcquireFlight(current, "same-scene");
      const second = gpu.tryAcquireFlight(current, "same-scene");
      expect(first.status).toBe("acquired");
      expect(second.status).toBe("acquired");
      if (first.status !== "acquired" || second.status !== "acquired")
        throw new Error("two-flight rotation unavailable");

      const firstRoot = gpu.texture(first.lease.bank, "root", 1, 1);
      const secondRoot = gpu.texture(second.lease.bank, "root", 1, 1);
      const firstFinal = gpu.stageFinal(
        first.lease,
        current,
        firstRoot,
        encoder,
      );
      const secondFinal = gpu.stageFinal(
        second.lease,
        current,
        secondRoot,
        encoder,
      );
      expect(firstFinal).not.toBe(secondFinal);

      gpu.markFlightSubmitted(first.lease);
      gpu.markFlightSubmitted(second.lease);
      gpu.validatePublication(first.lease, firstFinal);
      gpu.publish(first.lease, firstFinal, current);
      expect(gpu.frontTexture()).toBe(firstFinal);
      gpu.releaseFlight(first.lease);

      const third = gpu.tryAcquireFlight(current, "same-scene");
      expect(third.status).toBe("acquired");
      if (third.status !== "acquired")
        throw new Error("third-flight rotation unavailable");
      const thirdRoot = gpu.texture(third.lease.bank, "root", 1, 1);
      const thirdFinal = gpu.stageFinal(
        third.lease,
        current,
        thirdRoot,
        encoder,
      );
      expect(thirdFinal).not.toBe(firstFinal);
      expect(thirdFinal).not.toBe(secondFinal);
      expect(gpu.frontTexture()).toBe(firstFinal);
      expect(firstFinal.destroy).not.toHaveBeenCalled();

      gpu.markFlightSubmitted(third.lease);
      gpu.validatePublication(second.lease, secondFinal);
      gpu.publish(second.lease, secondFinal, current);
      gpu.releaseFlight(second.lease);
      gpu.validatePublication(third.lease, thirdFinal);
      gpu.publish(third.lease, thirdFinal, current);
      gpu.releaseFlight(third.lease);

      finalHistory.add(firstFinal);
      finalHistory.add(secondFinal);
      finalHistory.add(thirdFinal);
      expect(gpu.frontTexture()).toBe(thirdFinal);
      expect(firstFinal.destroy).not.toHaveBeenCalled();
      if (frame === 1) steadyResourceBytes = gpu.resourceBytes();
      if (frame > 1) expect(gpu.resourceBytes()).toBe(steadyResourceBytes);
    }

    expect(finalHistory.size).toBe(3);
    const visible = gpu.frontTexture();
    const bank = gpu.spareBank(current, "same-scene");
    const legacyRoot = gpu.texture(bank, "root", 1, 1);
    const legacyFinal = gpu.stageFinal(current, legacyRoot, encoder);
    expect(legacyFinal).not.toBe(visible);
    expect(gpu.frontTexture()).toBe(visible);
    expect(visible?.destroy).not.toHaveBeenCalled();
    gpu.endLegacyFlight();
    gpu.dispose();
  });

  it("keeps a finished exclusive operation leased until its fence owner releases it", async () => {
    const { gpu: pending } = harness();
    const gpu = await pending;
    const bank = gpu.spareBank(scene(1));
    gpu.beginFrame();
    gpu.finishFrame();
    expect(() => gpu.spareBank(scene(2))).toThrow("has not released its lease");
    expect(gpu.tryAcquireFlight(scene(1), null)).toEqual({
      status: "capacity",
      reason: "flight-limit",
    });
    gpu.endLegacyFlight();
    expect(gpu.spareBank(scene(2))).toBe(bank);
    gpu.endLegacyFlight();
    gpu.dispose();
  });

  it("keeps distinct arena bindings when one effect switches between legacy and extended uniforms", async () => {
    const { gpu: pending, device } = harness();
    const gpu = await pending;
    const bank = gpu.spareBank(scene(1));
    const pipeline = await gpu.pipeline(
      "sized-uniforms",
      "rgba16float",
      false,
      0,
    );
    for (const length of [136, 264, 136]) {
      gpu.beginFrame();
      gpu.bind(
        bank,
        "effect:same-instance:draw",
        pipeline,
        null,
        null,
        new Float32Array(length),
      );
      gpu.uploadFrame();
      gpu.finishFrame();
    }
    gpu.endLegacyFlight();
    const uniformSizes = device.createBindGroup.mock.calls.map(
      ([descriptor]) =>
        (descriptor.entries[0] as { resource: { size: number } }).resource.size,
    );
    expect(uniformSizes).toEqual([544, 1056]);
    expect(bank.bindings.size).toBe(2);
    gpu.dispose();
  });
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
    gpu.endLegacyFlight();
    const secondBank = gpu.spareBank(scene(2));
    expect(secondBank).toBe(firstBank);
    expect(gpu.texture(secondBank, "root", 20, 10)).toBe(texture);
    expect(texture.destroy).not.toHaveBeenCalled();

    gpu.endLegacyFlight();
    const resized = gpu.spareBank(scene(3, 24, 12));
    expect(resized).toBe(firstBank);
    expect([resized.width, resized.height, resized.pixelRatio]).toEqual([
      24, 12, 2,
    ]);
    expect(texture.destroy).toHaveBeenCalledTimes(1);
    expect(gpu.texture(resized, "root", 24, 12)).not.toBe(texture);
    gpu.endLegacyFlight();
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
      gpu.endLegacyFlight();
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

    gpu.endLegacyFlight();
    gpu.spareBank({ ...scene(2), pixelRatio: 3 }, "same-composition");
    expect(target.destroy).toHaveBeenCalledOnce();
    expect(bank.textures.size).toBe(0);
    expect((gpu as unknown as { uniformArena: unknown }).uniformArena).not.toBe(
      arena,
    );
    gpu.endLegacyFlight();
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
    gpu.endLegacyFlight();

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
    gpu.endLegacyFlight();
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
      gpu.endLegacyFlight();
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
    gpu.endLegacyFlight();
    bank.bindings.get("draw:uniform4:0")!.buffer = {} as GPUBuffer;
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
    gpu.endLegacyFlight();
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
    gpu.endLegacyFlight();
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
    const pipeline = await gpu.pipeline("source-only", "rgba16float", false, 1);
    const record = (
      generation: number,
      effectKey: string,
      exportWidth: number,
    ) => {
      const bank = gpu.spareBank(scene(generation));
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
      gpu.endLegacyFlight();
      return { bank, root, effect, exportTexture };
    };
    const first = record(1, "deleted", 8);
    const bank = first.bank;
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

  it("retires completed export intermediates while preserving the composed source and visible final", async () => {
    const { gpu: pending } = harness();
    const gpu = await pending;
    const current = scene(1);
    const bank = gpu.spareBank(current);
    const preview = gpu.texture(bank, "composition:preview", 20, 10);
    const encoder = { copyTextureToTexture: vi.fn() };
    const final = gpu.stageFinal(
      current,
      preview,
      encoder as unknown as GPUCommandEncoder,
    );
    gpu.publish(bank, final, current);

    gpu.endLegacyFlight();
    gpu.spareBank(scene(2));
    gpu.beginFrame();
    const intermediate = gpu.texture(bank, "composition:intermediate", 20, 10);
    const composed = gpu.texture(bank, "composition:export", 20, 10);
    gpu.finishFrame();
    gpu.trimWorkExcept(bank, composed);
    expect(preview.destroy).toHaveBeenCalledOnce();
    expect(intermediate.destroy).toHaveBeenCalledOnce();
    expect(composed.destroy).not.toHaveBeenCalled();
    expect(bank.textures.size).toBe(1);
    expect(gpu.frontTexture()).toBe(final);
    expect(final.destroy).not.toHaveBeenCalled();

    gpu.beginFrame();
    const output = gpu.texture(bank, "export:output", 20, 10, "rgba8unorm");
    gpu.finishFrame();
    gpu.trimWorkExcept(bank, null);
    expect(composed.destroy).toHaveBeenCalledOnce();
    expect(output.destroy).toHaveBeenCalledOnce();
    expect(bank.textures.size).toBe(0);
    expect(gpu.frontTexture()).toBe(final);
    gpu.endLegacyFlight();
    gpu.dispose();
  });

  it("frees fenced idle work before a source upload exceeds the scene budget", async () => {
    const { gpu: pending } = harness();
    const gpu = await pending;
    const current = scene(1);
    const bank = gpu.spareBank(current);
    const preview = gpu.texture(bank, "composition:preview", 20, 10);
    const final = gpu.stageFinal(current, preview, {
      copyTextureToTexture: vi.fn(),
    } as unknown as GPUCommandEncoder);
    gpu.publish(bank, final, current);

    gpu.endLegacyFlight();
    gpu.spareBank(scene(2));
    for (let index = 0; index < 5; index++)
      gpu.texture(bank, `composition:old-density:${index}`, 4_096, 2_048);
    const idle = gpu.texture(
      bank,
      "composition:old-density:tail",
      2_500,
      2_000,
    );
    const bitmap = { width: 4_096, height: 2_048, close: vi.fn() };
    const asset = {
      kind: "bitmap" as const,
      sceneId: "scene-a",
      generation: 2,
      assetId: "source",
      revision: 2,
      bitmap: bitmap as unknown as ImageBitmap,
    };

    gpu.retireIdleWorkForAssetUpload(asset);
    expect(idle.destroy).toHaveBeenCalledOnce();
    expect(preview.destroy).toHaveBeenCalledOnce();
    expect(gpu.frontTexture()).toBe(final);
    expect(final.destroy).not.toHaveBeenCalled();
    gpu.uploadAsset(asset);
    expect(gpu.hasAsset("source", 2, 2)).toBe(true);
    expect(bitmap.close).toHaveBeenCalledOnce();
    gpu.endLegacyFlight();
    gpu.dispose();
  });

  it("does not retire an explicit flight bank after its uniform frame closes", async () => {
    const { gpu: pending } = harness();
    const gpu = await pending;
    const current = scene(1);
    const acquired = gpu.tryAcquireFlight(current, "same-scene");
    expect(acquired.status).toBe("acquired");
    if (acquired.status !== "acquired") throw new Error("flight unavailable");

    gpu.beginFrame(acquired.lease);
    const work = gpu.texture(acquired.lease.bank, "root", 20, 10);
    gpu.finishFrame(acquired.lease);
    gpu.markFlightSubmitted(acquired.lease);

    expect(() => gpu.trimWorkExcept(acquired.lease.bank, null)).toThrow(
      "explicit worker flight owns the bank",
    );
    expect(() => gpu.trimWorkExcept(acquired.lease, null)).toThrow(
      "explicit worker flight owns",
    );
    expect(() =>
      gpu.retireIdleWorkForAssetUpload({
        kind: "rgba16float",
        sceneId: "scene-a",
        generation: 1,
        assetId: "source",
        revision: 1,
        width: 1,
        height: 1,
        data: new ArrayBuffer(8),
      }),
    ).toThrow("explicit worker flight is active");
    expect(work.destroy).not.toHaveBeenCalled();
    gpu.releaseFlight(acquired.lease);
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

  it("draws a native mesh with depth and reuses its indexed buffer across frames", async () => {
    const { gpu: pending, device } = harness();
    const gpu = await pending;
    const bank = gpu.spareBank(scene(1));
    const target = {
      width: 20,
      height: 10,
      pixelRatio: 2,
    } as NativeWorkerEffectTarget;
    const instance = {
      id: "mesh-1",
      placement: "fill",
      params: {},
      seed: 1,
      timing: { time: 0, paused: false, speed: 1 },
    } as EffectInstance;
    const render = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      setIndexBuffer: vi.fn(),
      drawIndexed: vi.fn(),
      draw: vi.fn(),
      end: vi.fn(),
    };
    const encoder = {
      beginRenderPass: vi.fn(() => render),
    } as unknown as GPUCommandEncoder;
    for (let frame = 0; frame < 2; frame++) {
      gpu.beginFrame();
      await gpu.effect(
        bank,
        target,
        FOLDED_MESH_EFFECT,
        instance,
        gpu.transparentTexture(),
        frame / 60,
        encoder,
        new Map(),
      );
      gpu.finishFrame();
    }
    const pass = vi.mocked(encoder.beginRenderPass).mock.calls[0]?.[0];
    expect(pass?.depthStencilAttachment?.depthClearValue).toBe(1);
    expect(pass?.depthStencilAttachment?.depthStoreOp).toBe("discard");
    expect(render.setIndexBuffer).toHaveBeenCalledTimes(2);
    expect(render.drawIndexed).toHaveBeenCalledWith(128 * 96 * 6);
    expect(render.draw).not.toHaveBeenCalled();
    const indexBufferCalls = device.createBuffer.mock.calls.filter((call) => {
      const [descriptor] = call as unknown as [{ usage: number }];
      return (descriptor.usage & 4) !== 0;
    });
    expect(indexBufferCalls).toHaveLength(1);
    expect(
      device.createTexture.mock.calls.filter(
        ([descriptor]) => descriptor.format === "depth24plus",
      ),
    ).toHaveLength(1);
    gpu.dispose();
  });

  it("shares cleared mesh depth by dimensions within a bank", async () => {
    const { gpu: pending, device } = harness();
    const gpu = await pending;
    const bank = gpu.spareBank(scene(1));
    const render = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      setIndexBuffer: vi.fn(),
      drawIndexed: vi.fn(),
      end: vi.fn(),
    };
    const encoder = {
      beginRenderPass: vi.fn(() => render),
    } as unknown as GPUCommandEncoder;
    const drawMesh = async (id: string, width: number, height: number) =>
      gpu.effect(
        bank,
        { width, height, pixelRatio: 2 } as NativeWorkerEffectTarget,
        FOLDED_MESH_EFFECT,
        {
          id,
          placement: "fill",
          params: {},
          seed: 1,
          timing: { time: 0, paused: false, speed: 1 },
        } as EffectInstance,
        gpu.transparentTexture(),
        0,
        encoder,
        new Map(),
      );
    const depthAllocations = () =>
      device.createTexture.mock.calls.filter(
        ([descriptor]) => descriptor.format === "depth24plus",
      );

    gpu.beginFrame();
    for (let index = 0; index < 12; index++)
      await drawMesh(`mesh-${index}`, 20, 10);
    expect(depthAllocations()).toHaveLength(1);
    expect(bank.depths.size).toBe(1);
    await drawMesh("mesh-other-size", 24, 12);
    expect(depthAllocations()).toHaveLength(2);
    expect(bank.depths.size).toBe(2);
    for (const [pass] of vi.mocked(encoder.beginRenderPass).mock.calls) {
      expect(pass.depthStencilAttachment?.depthLoadOp).toBe("clear");
      expect(pass.depthStencilAttachment?.depthStoreOp).toBe("discard");
    }
    expect(encoder.beginRenderPass).toHaveBeenCalledTimes(13);
    gpu.finishFrame();
    gpu.dispose();
  });

  it("keeps matching mesh depth separate across concurrent flight banks", async () => {
    const { gpu: pending, device } = harness();
    const gpu = await pending;
    const current = scene(1);
    const first = gpu.tryAcquireFlight(current, "same-scene");
    const second = gpu.tryAcquireFlight(current, "same-scene");
    expect(first.status).toBe("acquired");
    expect(second.status).toBe("acquired");
    if (first.status !== "acquired" || second.status !== "acquired")
      throw new Error("two flights unavailable");
    const render = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      setIndexBuffer: vi.fn(),
      drawIndexed: vi.fn(),
      end: vi.fn(),
    };
    const encoder = {
      beginRenderPass: vi.fn(() => render),
    } as unknown as GPUCommandEncoder;
    const instance = {
      id: "mesh-1",
      placement: "fill",
      params: {},
      seed: 1,
      timing: { time: 0, paused: false, speed: 1 },
    } as EffectInstance;
    for (const lease of [first.lease, second.lease]) {
      gpu.beginFrame(lease);
      await gpu.effect(
        lease.bank,
        { width: 20, height: 10, pixelRatio: 2 } as NativeWorkerEffectTarget,
        FOLDED_MESH_EFFECT,
        instance,
        gpu.transparentTexture(),
        0,
        encoder,
        new Map(),
      );
      gpu.finishFrame(lease);
    }
    const firstDepth = [...first.lease.bank.depths.values()][0]?.texture;
    const secondDepth = [...second.lease.bank.depths.values()][0]?.texture;
    expect(firstDepth).toBeDefined();
    expect(secondDepth).toBeDefined();
    expect(secondDepth).not.toBe(firstDepth);
    expect(
      device.createTexture.mock.calls.filter(
        ([descriptor]) => descriptor.format === "depth24plus",
      ),
    ).toHaveLength(2);
    gpu.releaseFlight(first.lease);
    gpu.releaseFlight(second.lease);
    gpu.dispose();
  });

  it("reuses immutable static uniforms while content and animation advance", async () => {
    const { gpu: pending } = harness();
    const gpu = await pending;
    const bank = gpu.spareBank(scene(1));
    const target = {
      width: 20,
      height: 10,
      pixelRatio: 2,
    } as NativeWorkerEffectTarget;
    const renderPass = {
      setPipeline() {},
      setBindGroup() {},
      setIndexBuffer() {},
      drawIndexed() {},
      end() {},
    };
    const encoder = {
      beginRenderPass: () => renderPass,
    } as unknown as GPUCommandEncoder;
    const bind = vi.spyOn(gpu, "bind");
    const offset =
      8 +
      planNativePropertyLayout(FOLDED_MESH_EFFECT).offsets.displacementAmount!;
    const render = async (
      instance: EffectInstance,
      time: number,
      definition = FOLDED_MESH_EFFECT,
    ) => {
      gpu.beginFrame();
      try {
        await gpu.effect(
          bank,
          target,
          definition,
          instance,
          gpu.transparentTexture(),
          time,
          encoder,
          new Map(),
        );
        return bind.mock.lastCall![5][offset];
      } finally {
        gpu.finishFrame();
      }
    };
    let reads = 0;
    const params = new Proxy(
      { displacementAmount: 0.2 },
      {
        get(target, key, receiver) {
          if (key === "displacementAmount") reads++;
          return Reflect.get(target, key, receiver);
        },
      },
    );
    const instance = {
      id: "mesh-1",
      nodeId: "root",
      definitionId: FOLDED_MESH_EFFECT.id,
      definitionVersion: FOLDED_MESH_EFFECT.version,
      placement: "fill",
      params,
      enabled: true,
      opacity: 1,
      seed: 1,
      clip: "bounds",
      blend: "normal",
      timing: { time: 0, paused: false, speed: 1 },
    } satisfies EffectInstance;
    expect(await render(instance, 0)).toBeCloseTo(0.2);
    const firstReads = reads;
    expect(firstReads).toBeGreaterThan(0);
    expect(await render(instance, 1 / 60)).toBeCloseTo(0.2);
    expect(reads).toBe(firstReads);
    expect(await render(instance, 2 / 60)).toBeCloseTo(0.2);
    expect(reads).toBe(firstReads);
    const refreshedDefinition = { ...FOLDED_MESH_EFFECT };
    expect(await render(instance, 0, refreshedDefinition)).toBeCloseTo(0.2);
    expect(reads).toBeGreaterThan(firstReads);

    const revised = {
      ...instance,
      params: { displacementAmount: 0.8 },
    } as EffectInstance;
    expect(await render(revised, 0)).toBeCloseTo(0.8);
    const animated = {
      ...instance,
      params: {},
      animation: {
        duration: 1,
        loop: false,
        tracks: {
          displacementAmount: {
            keys: [
              { time: 0, value: 0.1 },
              { time: 1, value: 0.9 },
            ],
          },
        },
      },
    } as EffectInstance;
    expect(await render(animated, 0)).toBeCloseTo(0.1);
    expect(await render(animated, 1)).toBeCloseTo(0.9);

    const invalid = {
      ...FOLDED_MESH_EFFECT,
      properties: {
        ...FOLDED_MESH_EFFECT.properties,
        displacementAmount: {
          ...FOLDED_MESH_EFFECT.properties.displacementAmount,
          max: -1,
        },
      },
    } as EffectDefinition;
    await expect(render(revised, 0, invalid)).rejects.toThrow();
    expect(await render(revised, 0)).toBeCloseTo(0.8);
    gpu.dispose();
  });
});
