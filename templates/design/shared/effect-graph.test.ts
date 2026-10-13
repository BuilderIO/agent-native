import { describe, expect, it } from "vitest";

import {
  dirtyEffectPasses,
  planEffectGraph,
  planEffectPasses,
  resizeInvalidatedResources,
  type EffectPass,
} from "./effect-graph";
import {
  hashEffectDefinition,
  nativeEffectExecutionPayload,
} from "./native-effect-trust";
import {
  validateEffectDocument,
  type EffectDefinition,
} from "./native-effects";

const pass = (
  id: string,
  reads: string[],
  output: string,
  extra: Partial<EffectPass> = {},
): EffectPass => ({
  id,
  kind: "render",
  wgsl: "test",
  reads,
  output,
  ...extra,
});

describe("native effect pass planner", () => {
  it("keeps stateful history ordered, bounded, and covered by the execution hash", async () => {
    const definition: EffectDefinition = {
      id: "stateful-contract-test",
      name: "Stateful Contract Test",
      version: 1,
      kind: "processor",
      placements: ["layer"],
      properties: {
        count: { type: "int", label: "Count", default: 128, min: 1, max: 128 },
      },
      resourceGraph: {
        abi: "stateful-resource-v1",
        timing: { fixedDt: 1 / 60, maxStepsPerCall: 8, maxStepIndex: 3600 },
        stateResources: ["particles", "trail"],
        sourceHistory: "sequential-captures",
        resetProperties: ["count"],
      },
      resources: [
        {
          name: "source",
          kind: "texture-2d",
          external: true,
          usage: ["sampled"],
        },
        {
          name: "particles",
          kind: "buffer",
          size: "fixed",
          byteLength: 2048,
          usage: ["storage"],
          persistent: true,
        },
        {
          name: "dots",
          kind: "texture-2d",
          size: "fixed",
          width: 32,
          height: 32,
          format: "rgba16float",
          usage: ["sampled", "render"],
        },
        {
          name: "trail",
          kind: "texture-2d",
          size: "fixed",
          width: 32,
          height: 32,
          format: "rgba16float",
          usage: ["sampled", "render"],
          persistent: true,
        },
        {
          name: "color",
          kind: "texture-2d",
          size: "viewport",
          format: "rgba16float",
          usage: ["sampled", "render"],
        },
      ],
      passes: [
        {
          id: "step",
          kind: "compute",
          reads: ["source"],
          previousFrameReads: ["particles"],
          output: "particles",
          dispatch: { elements: "output-buffer", workgroupSize: [64, 1, 1] },
          wgsl: "@compute @workgroup_size(64, 1, 1) fn cs() {}",
        },
        {
          id: "dots",
          kind: "render",
          reads: ["particles"],
          output: "dots",
          draw: { vertices: 6, instances: { property: "count", max: 4096 } },
          wgsl: "@vertex fn vs() {} @fragment fn fs() {}",
        },
        {
          id: "trail",
          kind: "render",
          reads: ["dots"],
          previousFrameReads: ["trail"],
          output: "trail",
          wgsl: "@vertex fn vs() {} @fragment fn fs() {}",
        },
        {
          id: "finish",
          kind: "render",
          reads: ["source", "trail"],
          output: "color",
          wgsl: "@vertex fn vs() {} @fragment fn fs() {}",
        },
      ],
      output: "color",
      provenance: { origin: "design-original" },
    };
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: [definition],
        instances: [],
      }).errors,
    ).toEqual([]);
    expect(planEffectGraph(definition).passes.map((pass) => pass.id)).toEqual([
      "step",
      "dots",
      "trail",
      "finish",
    ]);
    const graph = definition.resourceGraph;
    if (graph?.abi !== "stateful-resource-v1")
      throw new Error("Stateful graph contract is missing");
    const hash = await hashEffectDefinition(definition);
    expect(
      await hashEffectDefinition({
        ...definition,
        resourceGraph: {
          ...graph,
          timing: { ...graph.timing, maxStepsPerCall: 7 },
        },
      }),
    ).not.toBe(hash);
    expect(
      await hashEffectDefinition({
        ...definition,
        passes: definition.passes.map((pass) =>
          pass.id === "dots"
            ? {
                ...pass,
                draw: {
                  vertices: 6,
                  instances: { property: "count", max: 2048 },
                },
              }
            : pass,
        ),
      }),
    ).not.toBe(hash);
    const forward = structuredClone(definition);
    forward.passes[0]!.reads = ["dots"];
    expect(planEffectGraph(forward).errors).toContain(
      "stateful pass step has a missing or forward read dots",
    );
    const missingHistory = structuredClone(definition);
    missingHistory.passes[0]!.previousFrameReads = [];
    expect(planEffectGraph(missingHistory).errors).toContain(
      "stateful resource particles needs a previous-frame read",
    );
    const noSource = structuredClone(definition);
    noSource.resources!.shift();
    expect(planEffectGraph(noSource).errors).toContain(
      "stateful graph needs exactly one external source texture",
    );
    const multipleSources = structuredClone(definition);
    multipleSources.resources!.push({
      name: "image",
      kind: "texture-2d",
      external: true,
      usage: ["sampled"],
    });
    expect(planEffectGraph(multipleSources).errors).toContain(
      "stateful graph needs exactly one external source texture",
    );
    const renamedSource = structuredClone(definition);
    renamedSource.resources![0]!.name = "image";
    expect(planEffectGraph(renamedSource).errors).toContain(
      "stateful graph needs exactly one external source texture",
    );
    const unbounded = structuredClone(definition);
    unbounded.properties.count = {
      type: "int",
      label: "Count",
      default: 128,
      min: 1,
      max: 5000,
    };
    expect(planEffectGraph(unbounded).errors).toContain(
      "stateful pass dots needs bounded buffer-backed draw",
    );
    const oversizedState = structuredClone(definition);
    oversizedState.resources![1]!.byteLength = 16 * 1024 * 1024;
    expect(planEffectGraph(oversizedState).errors).toContain(
      "stateful graph exceeds fixed GPU resource budget",
    );
  });

  it("plans ordered mixed-resource linear graphs and binds the opt-in ABI to trust", () => {
    const resources = [
      {
        name: "source",
        kind: "texture-2d" as const,
        external: true,
        usage: ["sampled" as const],
      },
      {
        name: "cells",
        kind: "buffer" as const,
        size: "fixed" as const,
        byteLength: 64,
        usage: ["storage" as const],
      },
      {
        name: "color",
        kind: "texture-2d" as const,
        size: "viewport" as const,
        format: "rgba16float",
        usage: ["render" as const, "sampled" as const],
      },
    ];
    const compute: EffectPass = {
      id: "cells-pass",
      kind: "compute",
      reads: ["source"],
      output: "cells",
      wgsl: "// @compute @workgroup_size(1,1,1) fn cs() {}\n@compute @workgroup_size(4,1,1) fn cs() {}",
      dispatch: { elements: "output-buffer", workgroupSize: [4, 1, 1] },
    };
    const resolve = pass("resolve", ["source", "cells"], "color");
    const plan = planEffectPasses(
      [resolve, compute],
      resources,
      "color",
      undefined,
      undefined,
      { abi: "linear-resource-v1" },
    );
    expect(plan.errors).toEqual([]);
    expect(plan.passes.map((item) => item.id)).toEqual([
      "cells-pass",
      "resolve",
    ]);
    expect(
      planEffectPasses([resolve, compute], resources, "color").errors,
    ).toContain("linear-resource-definition-invalid");
    expect(
      planEffectPasses(
        [
          resolve,
          {
            ...compute,
            dispatch: { elements: "output-buffer", workgroupSize: [8, 1, 1] },
          },
        ],
        resources,
        "color",
        undefined,
        undefined,
        { abi: "linear-resource-v1" },
      ).errors,
    ).toContain(
      "linear compute pass cells-pass has mismatched WGSL workgroup metadata",
    );
    const definition = {
      id: "linear-test",
      version: 1,
      kind: "processor",
      placements: ["layer"],
      properties: {},
      resourceGraph: { abi: "linear-resource-v1" },
      resources,
      passes: [compute, resolve],
      output: "color",
    } as EffectDefinition;
    expect(nativeEffectExecutionPayload(definition).resourceGraph).toEqual({
      abi: "linear-resource-v1",
    });
    expect(
      "resourceGraph" in
        nativeEffectExecutionPayload({
          ...definition,
          resourceGraph: undefined,
        }),
    ).toBe(false);
  });
  it("sorts same-frame dependencies and computes transient lifetimes", () => {
    const plan = planEffectPasses([
      pass("finish", ["blurred"], "color"),
      pass("blur", ["source"], "blurred"),
    ]);
    expect(plan.errors).toEqual([]);
    expect(plan.passes.map((item) => item.id)).toEqual(["blur", "finish"]);
    expect(
      plan.resources.find((item) => item.name === "blurred"),
    ).toMatchObject({
      producer: "blur",
      firstUse: 0,
      lastUse: 1,
      persistent: false,
    });
    expect(dirtyEffectPasses(plan, ["source"])).toEqual(["blur", "finish"]);
    expect(dirtyEffectPasses(plan, ["params"])).toEqual(["blur", "finish"]);
    expect(resizeInvalidatedResources(plan)).toEqual(["blurred", "color"]);
  });

  it("rejects same-frame cycles and read/write aliasing", () => {
    expect(
      planEffectPasses([
        pass("a", ["bTexture"], "aTexture"),
        pass("b", ["aTexture"], "bTexture"),
      ]).errors,
    ).toContain("same-frame pass graph contains a cycle");
    expect(planEffectPasses([pass("a", ["color"], "color")]).errors).toContain(
      'pass "a" reads and writes "color" in one frame',
    );
  });

  it("accepts explicit previous-frame feedback only from persistent output", () => {
    const valid = planEffectPasses([
      pass("feedback", ["source"], "history", {
        persistent: true,
        previousFrameReads: ["history"],
      }),
    ]);
    expect(valid.errors).toEqual([]);
    expect(
      valid.resources.find((item) => item.name === "history")?.persistent,
    ).toBe(true);
    expect(
      planEffectPasses([
        pass("feedback", ["source"], "history", {
          previousFrameReads: ["history"],
        }),
      ]).errors,
    ).toContain(
      'pass "feedback" previous-frame read "history" requires a persistent producer',
    );
  });

  it("returns a typed error for malformed untrusted pass input", () => {
    expect(planEffectPasses([null] as unknown as EffectPass[]).errors).toEqual([
      "pass[0] is malformed",
    ]);
    expect(
      planEffectPasses([pass("a", ["source", "source"], "color")]).errors,
    ).toEqual(["pass[0] is malformed"]);
  });

  it("validates typed resources and explicit graph output", () => {
    const specs = [
      { name: "source", kind: "texture-2d" as const, external: true },
      { name: "color", kind: "texture-2d" as const, size: "viewport" as const },
      {
        name: "state",
        kind: "buffer" as const,
        size: "fixed" as const,
        byteLength: 1024,
      },
    ];
    const valid = planEffectPasses(
      [pass("paint", ["source"], "color")],
      specs,
      "color",
    );
    expect(valid.errors).toEqual([]);
    expect(resizeInvalidatedResources(valid)).toEqual(["color"]);
    expect(
      planEffectPasses([pass("paint", ["source"], "state")], specs, "state")
        .errors,
    ).toEqual(
      expect.arrayContaining([
        'render pass "paint" must output a texture-2d resource',
        'final output "state" must be texture-2d',
      ]),
    );
    expect(
      planEffectPasses([pass("paint", ["source"], "color")], specs, "missing")
        .errors,
    ).toContain('final output "missing" has no producing pass');
    expect(
      planEffectPasses(
        [pass("paint", ["source"], "color")],
        [
          { name: "color", kind: "texture-2d" },
          { name: "state", kind: "buffer" },
        ],
        "color",
      ).errors,
    ).toContain("resource[1] is malformed");
  });

  it("keeps raw data sampling explicit and limited to externally sampled textures", () => {
    const passes = [pass("paint", ["noise"], "color")];
    const output = { name: "color", kind: "texture-2d" as const };
    const external = {
      name: "noise",
      kind: "texture-2d" as const,
      external: true,
      usage: ["sampled" as const],
      sampleEncoding: "linear-data" as const,
    };
    expect(
      planEffectPasses(passes, [external, output], "color").errors,
    ).toEqual([]);
    expect(
      planEffectPasses(
        passes,
        [{ ...external, sampleEncoding: "srgb-color-premultiplied" }, output],
        "color",
      ).errors,
    ).toEqual([]);
    for (const invalid of [
      { ...external, sampleEncoding: "gamma-unknown" },
      { ...external, kind: "buffer", byteLength: 256 },
      { ...external, external: false },
      { ...external, usage: ["render"] },
      { ...external, usage: {} },
    ]) {
      expect(
        planEffectPasses(passes, [invalid, output] as never, "color").errors,
      ).toContain("resource[0] is malformed");
    }
  });

  it("keeps retired preprocessing readable but refuses its execution plan", () => {
    const passes = [pass("paint", ["maskData"], "color")];
    const output = { name: "color", kind: "texture-2d" as const };
    const processed = {
      name: "maskData",
      kind: "texture-2d" as const,
      external: true,
      usage: ["sampled" as const],
      sampleEncoding: "linear-data" as const,
      preprocess: "paper-liquid-mask" as const,
      mipmap: "generated" as const,
    };
    expect(
      planEffectPasses(passes, [processed, output], "color").errors,
    ).toContain("retired source preprocessing is unsupported");
    const generic = { ...processed, preprocess: undefined };
    expect(planEffectPasses(passes, [generic, output], "color").errors).toEqual(
      [],
    );
  });

  it("refuses a saved retired pass before planning any GPU resources", () => {
    const legacy = {
      ...pass("legacy", [], "color"),
      original: { saved: true },
    };
    expect(
      planEffectPasses(
        [legacy],
        [{ name: "color", kind: "texture-2d" }],
        "color",
      ),
    ).toMatchObject({
      passes: [],
      resources: [],
      errors: ["retired original-pass execution is unsupported"],
    });
  });

  it("uses declared persistence for frame feedback and retains final output through presentation", () => {
    const resources = [
      {
        name: "source",
        kind: "texture-2d" as const,
        external: true,
        usage: ["sampled" as const],
      },
      {
        name: "history",
        kind: "texture-2d" as const,
        persistent: true,
        usage: ["render" as const, "sampled" as const],
      },
    ];
    const plan = planEffectPasses(
      [
        pass("feedback", ["source"], "history", {
          previousFrameReads: ["history"],
        }),
      ],
      resources,
      "history",
    );
    expect(plan.errors).toEqual([]);
    expect(
      plan.resources.find((resource) => resource.name === "history"),
    ).toMatchObject({
      persistent: true,
      firstUse: 0,
      lastUse: 1,
    });
    expect(
      planEffectPasses(
        [pass("feedback", ["source"], "history", { persistent: false })],
        resources,
        "history",
      ).errors,
    ).toContain(
      'pass "feedback" persistence disagrees with resource "history"',
    );
  });

  it("rejects incompatible declared read, render, and presentation usages", () => {
    const source = {
      name: "source",
      kind: "texture-2d" as const,
      external: true,
      usage: ["copy-src" as const],
    };
    const output = {
      name: "color",
      kind: "texture-2d" as const,
      usage: ["render" as const],
    };
    const plan = planEffectPasses(
      [pass("paint", ["source"], "color")],
      [source, output],
      "color",
    );
    expect(plan.errors).toEqual(
      expect.arrayContaining([
        'pass "paint" read "source" lacks sampled usage',
        'final output "color" lacks sampled usage for presentation',
      ]),
    );
    expect(
      planEffectPasses(
        [pass("paint", ["source"], "color")],
        [
          { ...source, usage: ["sampled" as const] },
          { ...output, usage: ["sampled" as const] },
        ],
        "color",
      ).errors,
    ).toContain('pass "paint" output "color" lacks render usage');
  });
});
