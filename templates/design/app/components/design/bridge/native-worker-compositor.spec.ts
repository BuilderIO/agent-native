import { describe, expect, it } from "vitest";

import {
  composeNativeWorkerScene,
  NativeWorkerCompositionError,
  packNativeWorkerCompositeDraw,
  type NativeWorkerCompositionBank,
  type NativeWorkerCompositionGpu,
} from "./native-worker-compositor";
import type {
  NativeWorkerScene,
  NativeWorkerSourceRecord,
} from "./native-worker-protocol";

const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const radii = {
  topLeft: { x: 2, y: 3 },
  topRight: { x: 4, y: 5 },
  bottomRight: { x: 6, y: 7 },
  bottomLeft: { x: 8, y: 9 },
};
const box = { x: -5, y: 3, width: 20, height: 20 };
const clip = { rect: box, localBox: box, localToTarget: identity, radii };

function record(key: number): NativeWorkerSourceRecord {
  return {
    key,
    nodeId: `node-${key}`,
    kind: "dom",
    width: 20,
    height: 20,
    revision: 1,
    coordinateSpace: "target-local",
    rect: box,
    localBox: box,
    localToTarget: identity,
    clip: box,
    clips: [clip],
    groupClips: [],
    isolationPath: [],
    opacity: 1,
  };
}

function texture(width = 20, height = 20): GPUTexture {
  return { width, height, createView: () => ({}) } as unknown as GPUTexture;
}

it("packs signed physical origins and all eight affine rounded clips without dropping fields", () => {
  const clips = Array.from({ length: 8 }, (_, index) => ({
    ...clip,
    localBox: { x: index, y: index + 1, width: 20, height: 20 },
    localToTarget: { ...identity, e: index * 2, f: -index },
  }));
  const item = {
    id: "paint",
    rect: box,
    localBox: box,
    localToTarget: identity,
    clips,
    opacity: 0.75,
    premultiplied: true,
    encodedScene: false,
  };
  const packed = packNativeWorkerCompositeDraw({
    item,
    physicalScale: { x: 2, y: 3 },
    origin: { x: -10, y: 9 },
    viewport: { width: 40, height: 60 },
    pixelated: { x: 2, y: 3 },
    blendMode: "srgb-css-linear",
  });
  expect(packed).toHaveLength(36 + 8 * 20);
  expect(Array.from(packed.slice(0, 28))).toEqual([
    -10, 9, 40, 60, 40, 60, 2, 3, 0.75, 1, 1, 0, 0, 0, 1, 1, 8, 0, 0, 0, -10, 9,
    0, 0, -5, 3, 20, 20,
  ]);
  expect(Array.from(packed.slice(36, 48))).toEqual([
    0, 1, 20, 20, 2, 3, 4, 5, 6, 7, 8, 9,
  ]);
  expect(Array.from(packed.slice(36 + 7 * 20, 36 + 7 * 20 + 12))).toEqual([
    7, 8, 20, 20, 2, 3, 4, 5, 6, 7, 8, 9,
  ]);
  expect(() =>
    packNativeWorkerCompositeDraw({
      item: { ...item, clips: [...clips, clip] },
      physicalScale: { x: 1, y: 1 },
      origin: { x: 0, y: 0 },
      viewport: { width: 20, height: 20 },
      blendMode: "linear",
    }),
  ).toThrowError(NativeWorkerCompositionError);
});

it("replaces the prior scene under receiver coverage after ordered source draws", async () => {
  const events: Array<{ kind: string; value?: unknown }> = [];
  const bindings: Array<{
    key: string;
    source: GPUTexture;
    mask: GPUTexture | null;
    data: Float32Array;
    extra?: readonly GPUTexture[];
  }> = [];
  const textures = new Map<string, GPUTexture>();
  const bank: NativeWorkerCompositionBank = {
    texture(key, width, height) {
      const existing = textures.get(key);
      if (existing) return existing;
      const created = texture(width, height);
      textures.set(key, created);
      return created;
    },
  };
  const gpu: NativeWorkerCompositionGpu = {
    async pipeline(wgsl, _format, blend, textureCount) {
      events.push({
        kind: "pipeline",
        value: {
          replace: wgsl.includes("processedBackdrop"),
          receiver: wgsl.includes("receiverCoverageTexture"),
          blend,
          textureCount,
        },
      });
      return {} as GPURenderPipeline;
    },
    bind(key, _pipeline, source, mask, data, _sampler, extra) {
      bindings.push({ key, source, mask, data, extra });
      return {} as GPUBindGroup;
    },
    sampler() {
      return {} as GPUSampler;
    },
  };
  const encoder = {
    beginRenderPass() {
      events.push({ kind: "pass" });
      return {
        setPipeline() {},
        setBindGroup() {},
        setScissorRect() {},
        draw(count: number) {
          events.push({ kind: "draw", value: count });
        },
        end() {
          events.push({ kind: "end" });
        },
      };
    },
  } as unknown as GPUCommandEncoder;
  const first = record(1);
  const second = { ...record(2), nativeInstanceId: "glass", opacity: 1 };
  const paint = texture();
  const glass = texture();
  const coverage = texture();
  const scene = {
    width: 20,
    height: 20,
    pixelRatio: 1,
    viewport: box,
  } as NativeWorkerScene;
  const output = await composeNativeWorkerScene({
    scene,
    records: [first, second],
    encoder,
    bank,
    gpu,
    format: "rgba16float",
    resolveRecord: async (value, context) => {
      if (value.key === 1) return { texture: paint };
      if (!context.currentScene)
        return {
          backdropReplacement: true,
          receiverCoverage: coverage,
          opacity: 0.6,
          premultiplied: true,
        };
      expect(context.currentScene).toBe(textures.get("source"));
      expect(context.incoming).toEqual({ x: -5, y: 3, width: 20, height: 20 });
      return {
        texture: glass,
        backdropReplacement: true,
        receiverCoverage: coverage,
      };
    },
  });
  expect(
    events.filter((event) => event.kind === "draw").map((event) => event.value),
  ).toEqual([6, 3]);
  const ordinary = bindings.find((binding) => binding.key === "scene:leaf:1");
  const replacement = bindings.find(
    (binding) => binding.key === "scene:leaf:2:replace",
  );
  expect(ordinary?.data[20]).toBe(-5);
  expect(ordinary?.data[21]).toBe(3);
  expect(replacement?.source).toBe(textures.get("source"));
  expect(replacement?.mask).toBe(glass);
  expect(replacement?.extra).toEqual([coverage]);
  expect(
    events.find(
      (event) =>
        event.kind === "pipeline" &&
        (event.value as { receiver?: boolean }).receiver,
    )?.value,
  ).toMatchObject({ textureCount: 3 });
  expect(replacement?.data[8]).toBeCloseTo(0.6);
  expect(output).toBe(textures.get("backdrop-replacement:source"));
});

it("stages nested Glass against the SVG opacity group's current scene and resolves the group once", async () => {
  const calls: string[] = [];
  const bound: Array<{
    key: string;
    source: GPUTexture;
    mask: GPUTexture | null;
    data: Float32Array;
    extra?: readonly GPUTexture[];
  }> = [];
  const allocated = new Map<string, GPUTexture>();
  const bank: NativeWorkerCompositionBank = {
    texture(key, width, height) {
      const prior = allocated.get(key);
      if (prior) return prior;
      const next = texture(width, height);
      allocated.set(key, next);
      return next;
    },
  };
  const gpu: NativeWorkerCompositionGpu = {
    async pipeline(wgsl) {
      return {
        replacement: wgsl.includes("processedBackdrop"),
      } as unknown as GPURenderPipeline;
    },
    bind(key, _pipeline, source, mask, data, _sampler, extra) {
      calls.push(`bind:${key}`);
      bound.push({ key, source, mask, data, extra });
      return {} as GPUBindGroup;
    },
    sampler() {
      return {} as GPUSampler;
    },
  };
  const encoder = {
    beginRenderPass() {
      return {
        setPipeline() {},
        setBindGroup() {},
        setScissorRect() {},
        draw(count: number) {
          calls.push(`draw:${count}`);
        },
        end() {},
      };
    },
  } as unknown as GPUCommandEncoder;
  const isolationPath = [
    { id: "svg-opacity", kind: "opacity" as const, opacity: 0.5 },
  ];
  const background = record(1);
  const svg = { ...record(2), isolationPath };
  const glass = {
    ...record(3),
    nativeInstanceId: "nested-glass",
    isolationPath,
  };
  const backgroundTexture = texture();
  const svgTexture = texture();
  const glassTexture = texture();
  const coverage = texture();
  const extent = {
    pixelRatio: 1,
    width: 20,
    height: 20,
    sourceWidth: 20,
    sourceHeight: 20,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    expanded: false,
  };
  let stageCount = 0;
  await composeNativeWorkerScene({
    scene: {
      width: 20,
      height: 20,
      pixelRatio: 1,
      viewport: box,
    } as NativeWorkerScene,
    records: [background, svg, glass],
    encoder,
    bank,
    gpu,
    format: "rgba16float",
    resolveRecord: async (value, context) => {
      if (value.key === 1) return { texture: backgroundTexture };
      if (value.key === 2) return { texture: svgTexture };
      if (!context.currentScene)
        return {
          backdropReplacement: true,
          nestedBackdrop: { output: { width: 20, height: 20 }, extent },
          receiverCoverage: coverage,
          premultiplied: true,
        };
      stageCount += 1;
      expect(context.incoming).toEqual({ x: -5, y: 3, width: 20, height: 20 });
      expect(context.window?.packet).toEqual([20, 20, 0, 1, 0, 0, 20, 20]);
      expect(context.currentScene).toBe(
        allocated.get("source:deferred:opacity:svg-opacity:working"),
      );
      return { texture: glassTexture, receiverCoverage: coverage };
    },
  });
  expect(stageCount).toBe(1);
  expect(calls).toEqual([
    "bind:scene:leaf:1",
    "draw:6",
    "bind:scene:source:deferred:opacity:svg-opacity:incoming",
    "bind:scene:leaf:2",
    "draw:6",
    "draw:6",
    "bind:scene:leaf:3:replace",
    "draw:3",
    "bind:scene:source:deferred:opacity:svg-opacity:resolve:replace",
    "draw:3",
  ]);
  const replacement = bound.find(
    (entry) => entry.key === "scene:leaf:3:replace",
  );
  expect(replacement?.extra).toEqual([coverage]);
  const groupResolve = bound.find(
    (entry) =>
      entry.key === "scene:source:deferred:opacity:svg-opacity:resolve:replace",
  );
  expect(groupResolve?.data[8]).toBe(0.5);
  expect(groupResolve?.source).toBe(allocated.get("source"));
});

it("composes CSS colors on the encoded plane and decodes into a separate linear texture", async () => {
  const textures = new Map<string, GPUTexture>();
  const bank: NativeWorkerCompositionBank = {
    texture(key, width, height) {
      const prior = textures.get(key);
      if (prior) return prior;
      const next = texture(width, height);
      textures.set(key, next);
      return next;
    },
  };
  const passes: Array<{ load: string; draws: number[] }> = [];
  const binds: Array<{ key: string; source: GPUTexture; data: Float32Array }> =
    [];
  const gpu: NativeWorkerCompositionGpu = {
    async pipeline() {
      return {} as GPURenderPipeline;
    },
    bind(key, _pipeline, source, _mask, data) {
      binds.push({ key, source, data });
      return {} as GPUBindGroup;
    },
    sampler() {
      return {} as GPUSampler;
    },
  };
  const encoder = {
    beginRenderPass(descriptor: GPURenderPassDescriptor) {
      const pass = {
        load: descriptor.colorAttachments[0]!.loadOp,
        draws: [] as number[],
      };
      passes.push(pass);
      return {
        setPipeline() {},
        setBindGroup() {},
        setScissorRect() {},
        draw(count: number) {
          pass.draws.push(count);
        },
        end() {},
      };
    },
  } as unknown as GPUCommandEncoder;
  const paint = texture();
  const linear = await composeNativeWorkerScene({
    scene: {
      width: 20,
      height: 20,
      pixelRatio: 1,
      viewport: box,
    } as NativeWorkerScene,
    records: [record(1)],
    encoder,
    bank,
    gpu,
    format: "rgba16float",
    blendMode: "srgb-css-linear",
    resolveRecord: async () => ({ texture: paint }),
  });
  expect(passes.map((pass) => [pass.load, pass.draws])).toEqual([
    ["clear", [6]],
    ["clear", [6]],
  ]);
  expect(binds[0]?.data[10]).toBe(1);
  expect(binds[1]?.key).toBe("scene:source:decode-srgb");
  expect(binds[1]?.source).toBe(textures.get("css-intermediate:source"));
  expect(linear).toBe(textures.get("source"));
});
