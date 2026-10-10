import { describe, expect, it } from "vitest";

import {
  dirtyEffectPasses,
  planEffectPasses,
  resizeInvalidatedResources,
  type EffectPass,
} from "./effect-graph";

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
