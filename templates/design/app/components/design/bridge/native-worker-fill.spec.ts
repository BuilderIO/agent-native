import { describe, expect, it } from "vitest";

import type { EffectInstance } from "../../../../shared/native-effects";
import { renderNativeWorkerFill } from "./native-worker-fill";
import type {
  NativeWorkerGpuBank,
  NativeWorkerGpuFacade,
} from "./native-worker-gpu";
import type {
  NativeWorkerEffectTarget,
  NativeWorkerScene,
  NativeWorkerSourceRecord,
} from "./native-worker-protocol";

function texture(width = 10, height = 10): GPUTexture {
  return { width, height, createView: () => ({}) } as unknown as GPUTexture;
}
function record(
  assetId: string,
  rect = { x: 0, y: 0, width: 10, height: 10 },
): NativeWorkerSourceRecord {
  return { assetId, rect, clip: rect } as NativeWorkerSourceRecord;
}
function target(
  phases: NonNullable<NativeWorkerEffectTarget["fillPhases"]>,
): NativeWorkerEffectTarget {
  return {
    width: 10,
    height: 10,
    pixelRatio: 1,
    outputExtent: {
      pixelRatio: 1,
      width: 10,
      height: 10,
      sourceWidth: 10,
      sourceHeight: 10,
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      expanded: false,
    },
    rect: { x: 0, y: 0, width: 10, height: 10 },
    fillPhases: phases,
  } as NativeWorkerEffectTarget;
}
function phases(): NonNullable<NativeWorkerEffectTarget["fillPhases"]> {
  return {
    backgroundRecords: [record("background")],
    borderRecords: [record("border")],
    outerCoverageRecords: [record("outer")],
    innerCoverageRecords: [record("inner")],
    glyphRecords: [],
    insetShadowRecords: [],
    outerShadowRecords: [],
    outlineRecords: [],
    foregroundRecords: [],
  };
}
function harness() {
  const pipelineTextureCounts: number[] = [];
  const calls: Array<{
    key: string;
    front: GPUTexture;
    back: GPUTexture | null;
    data: Float32Array;
    extras?: readonly GPUTexture[];
  }> = [];
  const outputs = new Map<string, GPUTexture>();
  const bank = {
    textures: new Map(),
    bindings: new Map(),
    sceneTexture: null,
    generation: 1,
    width: 10,
    height: 10,
    pixelRatio: 1,
  } as NativeWorkerGpuBank;
  const gpu = {
    texture(
      _bank: NativeWorkerGpuBank,
      key: string,
      width: number,
      height: number,
    ) {
      const previous = outputs.get(key);
      if (previous) return previous;
      const next = texture(width, height);
      outputs.set(key, next);
      return next;
    },
    sampler: {} as GPUSampler,
    async pipeline(
      _wgsl: string,
      _format: GPUTextureFormat,
      _blend: boolean,
      textureCount: number,
    ) {
      pipelineTextureCounts.push(textureCount);
      return {} as GPURenderPipeline;
    },
    bind(
      _bank: NativeWorkerGpuBank,
      key: string,
      _pipeline: GPURenderPipeline,
      front: GPUTexture,
      back: GPUTexture | null,
      data: Float32Array,
      extras?: readonly GPUTexture[],
    ) {
      calls.push({ key, front, back, data, extras });
      return {} as GPUBindGroup;
    },
  } as NativeWorkerGpuFacade;
  const encoder = {
    beginRenderPass() {
      return { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} };
    },
  } as unknown as GPUCommandEncoder;
  return { calls, pipelineTextureCounts, outputs, bank, gpu, encoder };
}
const instance = (
  clip: "bounds" | "text",
  opacity: number,
  id = "fill-1",
): EffectInstance =>
  ({ id, placement: "fill", clip, opacity }) as EffectInstance;
const scene = (instances: EffectInstance[] = []): NativeWorkerScene =>
  ({ colorSpace: "srgb", instances }) as unknown as NativeWorkerScene;

it("carries first Fill underlay and mixes the next text slot at its own opacity", async () => {
  const h = harness();
  const basePhases = phases();
  const assets = new Map(
    ["background", "border", "outer", "inner"].map((name) => [name, texture()]),
  );
  const transparent = texture(1, 1);
  const first = await renderNativeWorkerFill({
    scene: scene(),
    target: target(basePhases),
    instance: instance("bounds", 0.7),
    encoder: h.encoder,
    bank: h.bank,
    gpu: h.gpu,
    format: "rgba16float",
    transparent,
    foreground: texture(),
    isTopFill: false,
    asset: (value) => assets.get(value.assetId!)!,
    composeRecords: async () => {
      throw new Error("No composed phase expected");
    },
  });
  expect(first.texture).toBe(first.carry.underlay);
  expect(h.calls[0]?.key).toBe("fill:fill-1:underlay:bind");
  expect(h.calls[0]?.data[2]).toBe(1);
  expect(h.calls[0]?.data[4]).toBe(1);
  const text = await renderNativeWorkerFill({
    scene: scene(),
    target: target(basePhases),
    instance: instance("text", 0.4, "fill-2"),
    encoder: h.encoder,
    bank: h.bank,
    gpu: h.gpu,
    format: "rgba16float",
    transparent,
    foreground: texture(),
    previousFill: first.carry,
    isTopFill: true,
    asset: () => {
      throw new Error("Second Fill must reuse first box phases");
    },
    composeRecords: async () => {
      throw new Error("No composed phase expected");
    },
  });
  expect(h.calls.map((call) => call.key)).toEqual([
    "fill:fill-1:underlay:bind",
    "fill:fill-2:underlay:bind",
    "fill:fill-2:text:bind",
    "fill:fill-2:box:bind",
    "fill:fill-2:phase:bind",
  ]);
  expect(h.pipelineTextureCounts).toEqual([4, 4, 2, 3, 2]);
  expect(h.calls[1]?.data[2]).toBe(0);
  expect(h.calls[1]?.front).toBe(transparent);
  expect(h.calls[2]?.data[2]).toBeCloseTo(0.4);
  expect(text.carry.border).toBe(first.carry.border);
  expect(text.carry.underlay).not.toBe(first.carry.underlay);
});

it("expands top Fill for outer paint and stages nested Glass before foreground composition", async () => {
  const h = harness();
  const p = phases();
  p.outerShadowRecords = [
    record("shadow", { x: -2, y: 0, width: 10, height: 10 }),
  ];
  p.foregroundRecords = [
    {
      ...record("child", { x: 8, y: 0, width: 4, height: 10 }),
      nativeInstanceId: "glass",
    },
  ];
  p.outlineRecords = [record("outline")];
  const assets = new Map(
    ["background", "border", "outer", "inner"].map((name) => [name, texture()]),
  );
  const steps: string[] = [];
  let stagedBase: GPUTexture | undefined;
  const stagedGlass = texture();
  const result = await renderNativeWorkerFill({
    scene: scene([{ id: "glass", placement: "backdrop" } as EffectInstance]),
    target: target(p),
    instance: instance("bounds", 0.8),
    encoder: h.encoder,
    bank: h.bank,
    gpu: h.gpu,
    format: "rgba16float",
    transparent: texture(1, 1),
    foreground: texture(),
    isTopFill: true,
    asset: (value) => assets.get(value.assetId!)!,
    composeRecords: async (_records, key, surface, _mode, staged) => {
      steps.push(key);
      expect(surface.outputExtent?.width).toBe(14);
      if (key.endsWith(":child"))
        expect(staged?.get("glass")).toBe(stagedGlass);
      return texture(surface.width, surface.height);
    },
    stageFillBackdrops: async (records, base, extent) => {
      steps.push("stage");
      expect(records).toHaveLength(1);
      expect(extent).toMatchObject({
        left: 2,
        right: 2,
        width: 14,
        height: 10,
      });
      stagedBase = base;
      return new Map([["glass", stagedGlass]]);
    },
  });
  expect(steps).toEqual([
    "fill:fill-1:outer-shadow",
    "stage",
    "fill:fill-1:child",
  ]);
  expect(stagedBase).toBe(h.outputs.get("fill:fill-1:expanded-base"));
  expect(result.presentationExtent).toMatchObject({
    left: 2,
    right: 2,
    width: 14,
    height: 10,
  });
  expect(result.texture).toBe(h.outputs.get("fill:fill-1:final"));
  expect(h.calls[h.calls.length - 1]?.front.width).toBe(14);
  expect(h.calls[h.calls.length - 1]?.back?.width).toBe(14);
});
