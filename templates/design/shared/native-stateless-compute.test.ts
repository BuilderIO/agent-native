import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { nativeEffectExecutionPayload } from "./native-effect-trust";
import { validateEffectDocument } from "./native-effects";
import {
  NativeStatelessComputeError,
  planStatelessCompute,
  statelessRowBoundary,
} from "./native-stateless-compute";
import { STATELESS_SORT_TEST_DEFINITION as fixture } from "./native-stateless-sort.test-fixture";

const limits = {
  maxStorageBufferBindingSize: 134217728,
  maxBufferSize: 268435456,
  maxComputeWorkgroupsPerDimension: 65535,
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupSizeX: 256,
  maxComputeWorkgroupSizeY: 256,
  maxComputeWorkgroupSizeZ: 64,
  maxComputeWorkgroupStorageSize: 16384,
};
const input = {
  dispatch: {
    elements: "source-row-blocks",
    workgroupSize: [64, 1, 1],
    blockProperty: "blockLength",
  } as const,
  sourceWidth: 607,
  sourceHeight: 17,
  sourceBytesPerPixel: 1,
  sharedBytes: 512,
  pixelRatio: 1.010942816734314,
  params: { blockLength: 11 },
  subpixelBlocks: "source-identity" as const,
  limits,
};
const valid = (definition: unknown) =>
  validateEffectDocument({
    schemaVersion: 2,
    definitions: [definition],
    instances: [],
  }).valid;

describe("stateless source compute contract", () => {
  it("accepts the private source processor and preserves source/buffer graph order", () => {
    expect(valid(fixture)).toBe(true);
    expect(planEffectGraph(fixture).passes.map((pass) => pass.id)).toEqual([
      "rank",
      "resolve",
    ]);
    expect(nativeEffectExecutionPayload(fixture).statelessCompute).toEqual(
      fixture.statelessCompute,
    );
  });
  it.each([
    (d: any) => {
      delete d.statelessCompute;
    },
    (d: any) => {
      d.statelessCompute = null;
    },
    (d: any) => {
      d.statelessCompute = false;
    },
    (d: any) => {
      d.statelessCompute = 0;
    },
    (d: any) => {
      d.statelessCompute = "";
    },
    (d: any) => {
      d.statelessCompute.extra = true;
    },
    (d: any) => {
      d.statelessCompute.sharedBytes = -1;
    },
    (d: any) => {
      d.feedback = {};
    },
    (d: any) => {
      d.kind = "generator";
    },
    (d: any) => {
      d.resources[1].byteLength = 64;
    },
    (d: any) => {
      d.resources[1].sourceBytesPerPixel = 0;
    },
    (d: any) => {
      d.resources[1].persistent = true;
    },
    (d: any) => {
      d.resources[1].usage = ["storage"];
    },
    (d: any) => {
      d.passes[0].dispatch.workgroupSize = [32, 1, 1];
    },
    (d: any) => {
      d.passes[0].previousFrameReads = ["indices"];
    },
    (d: any) => {
      d.passes[1].reads = ["indices", "source"];
    },
    (d: any) => {
      d.properties.blockLength.max = 17;
    },
    (d: any) => {
      d.output = "source";
    },
    (d: any) => {
      d.resources[0].preprocess = "paper-liquid-mask";
      d.resources[0].sampleEncoding = "linear-data";
      d.resources[0].mipmap = "generated";
    },
    (d: any) => {
      d.passes[0].original = {};
    },
    (d: any) => {
      d.statelessCompute.subpixelBlocks = "auto";
    },
    (d: any) => {
      d.passes[0].dispatch = {
        elements: "source-grid",
        workgroupSize: [64, 1, 1],
      };
    },
  ])("rejects mismatched or unbounded declared behavior %$", (mutate) => {
    const definition = structuredClone(fixture);
    mutate(definition);
    expect(valid(definition)).toBe(false);
  });
  it("uses actual source dimensions, aligned packed bytes and source rows", () => {
    const plan = planStatelessCompute(input);
    expect(plan.sourceWidth).toBe(607);
    expect(plan.sourceHeight).toBe(17);
    expect(plan.byteLength).toBe(10320);
    expect(plan.workgroups).toEqual([55, 17, 1]);
  });
  it.each([
    [0.500381588935852, 13, 4096, 3278],
    [1.010942816734314, 11, 607, 600],
    [1.1302083730697632, 10, 679, 542],
    [1.6, 16, 512, 26],
  ])(
    "uses one contiguous exact dyadic boundary across fractional cases %$",
    (density, run, width, pixel) => {
      const plan = planStatelessCompute({
        ...input,
        sourceWidth: width,
        sourceHeight: 1,
        pixelRatio: density,
        params: { blockLength: run },
      });
      const b = new DataView(new ArrayBuffer(4));
      b.setFloat32(0, density, true);
      const bits = b.getUint32(0, true),
        scale = ((bits & 8388607) | 8388608) * run,
        shift = 150 - ((bits >>> 23) & 255);
      let prior = 0;
      const coverage = new Uint8Array(width);
      for (let k = 0; k < plan.workgroups[0]; k++) {
        const start = statelessRowBoundary(k, scale, shift, width),
          end = statelessRowBoundary(k + 1, scale, shift, width);
        expect(start).toBe(prior);
        expect(end - start).toBeLessThanOrEqual(64);
        for (let x = start; x < end; x++) coverage[x]++;
        prior = end;
      }
      expect(prior).toBe(width);
      expect(coverage.every((count) => count === 1)).toBe(true);
      expect(coverage[pixel]).toBe(1);
      expect(coverage[Math.min(width - 1, pixel + 1)]).toBe(1);
    },
  );
  it("preserves subpixel partition identity without an invalid shift or dispatch", () => {
    expect(planStatelessCompute({ ...input, pixelRatio: 0.01 }).mode).toBe(
      "identity",
    );
  });
  it("never silently drops a generic singleton-row processor", () => {
    expect(() =>
      planStatelessCompute({
        ...input,
        pixelRatio: 0.5,
        params: { blockLength: 1 },
        subpixelBlocks: undefined,
      }),
    ).toThrow("stateless-compute-device-limit");
    expect(() =>
      planStatelessCompute({
        ...input,
        pixelRatio: 0.01,
        limits: { ...limits, maxBufferSize: undefined },
      } as any),
    ).toThrow("stateless-compute-limits-unavailable");
  });
  it("also plans independent source-grid compute", () => {
    const plan = planStatelessCompute({
      ...input,
      dispatch: { elements: "source-grid", workgroupSize: [8, 8, 1] },
      subpixelBlocks: undefined,
      sourceWidth: 257,
      sourceHeight: 129,
      sourceBytesPerPixel: 4,
    });
    expect(plan.workgroups).toEqual([33, 17, 1]);
    expect(plan.byteLength).toBe(257 * 129 * 4);
  });
  it.each([
    { sourceWidth: 4097 },
    { sourceHeight: 0 },
    { sourceWidth: 4096, sourceHeight: 4096 },
    { pixelRatio: NaN },
    { pixelRatio: 4.1 },
    { params: { blockLength: 16.1 } },
    { limits: { ...limits, maxComputeWorkgroupsPerDimension: 2 } },
    { limits: { ...limits, maxComputeWorkgroupStorageSize: 511 } },
    { limits: { ...limits, maxStorageBufferBindingSize: 4 } },
    { limits: { ...limits, maxComputeWorkgroupSizeY: undefined } },
    { sourceBytesPerPixel: 16, sourceWidth: 4096, sourceHeight: 2048 },
  ])(
    "fails unavailable, malformed or device-exceeding geometry %$",
    (change) => {
      expect(() =>
        planStatelessCompute({ ...input, ...change } as any),
      ).toThrow(NativeStatelessComputeError);
    },
  );
});
