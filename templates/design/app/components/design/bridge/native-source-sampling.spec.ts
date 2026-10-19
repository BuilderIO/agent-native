import { describe, expect, it } from "vitest";

import {
  planNativeImageSampling,
  planNativeImageUpload,
} from "./native-source-sampling";
import {
  cases,
  base,
  numericCases,
  materializedPixelatedReference,
  virtualPixelatedModel,
  physicalCases,
  physicalSamplingSites,
  referencePhysicalUv,
  modelPhysicalUv,
} from "./native-source-sampling-cases";

describe("authored image sampling at source composition", () => {
  it.each(cases)("$name", ({ input, expected }) => {
    expect(planNativeImageSampling(input)).toEqual(expected);
  });
  it("changes policy on every invocation without reusing previous style", () => {
    const input = { ...base, imageRendering: { value: "auto" } };
    expect(planNativeImageSampling(input)).toEqual({
      ok: true,
      filter: "linear",
    });
    input.imageRendering.value = "pixelated";
    expect(planNativeImageSampling(input)).toEqual({
      ok: true,
      filter: "nearest",
      pixelated: { x: 1, y: 1 },
    });
    input.imageRendering.value = "auto";
    expect(planNativeImageSampling(input)).toEqual({
      ok: true,
      filter: "linear",
    });
  });
  it("rejects loss of sharp source pixels before resource upload", () => {
    expect(
      planNativeImageUpload({ ...base, uploadedSize: { width: 2, height: 1 } }),
    ).toEqual({ ok: false, reason: "downsample" });
    expect(
      planNativeImageUpload({
        ...base,
        imageRendering: { value: "auto" },
        uploadedSize: { width: 2, height: 1 },
      }),
    ).toEqual({ ok: true, filter: "linear" });
  });
});

describe("two-stage pixelated color equations", () => {
  it.each(numericCases)("$name", (fixture) => {
    const plan = planNativeImageSampling(fixture.input);
    expect(plan.ok).toBe(true);
    if (!plan.ok || !plan.pixelated) throw new Error("Pixelated plan missing");
    expect(plan.pixelated).toEqual(fixture.referenceMultiple);
    for (const site of fixture.sites) {
      const expected = materializedPixelatedReference(fixture, site.uv);
      const actual = virtualPixelatedModel(fixture, site.uv, plan.pixelated);
      for (let channel = 0; channel < 4; channel++) {
        expect(Math.abs(actual[channel] - expected[channel])).toBeLessThan(
          0.000001,
        );
        if (site.expected)
          expect(expected[channel]).toBeCloseTo(site.expected[channel], 12);
      }
    }
  });
  it("1.6 colors differ from ordinary nearest and ordinary linear", () => {
    const fixture = numericCases[0];
    const reference = fixture.sites.map(
      (site) => materializedPixelatedReference(fixture, site.uv)[0],
    );
    expect(reference).toEqual([
      0, 0.09375, 0.25, 0.46875, 0.53125, 0.75, 0.90625, 1,
    ]);
    expect(reference).not.toEqual([0, 0, 0.25, 0.5, 0.5, 0.75, 1, 1]);
    expect(reference).not.toEqual([
      0, 0.109375, 0.265625, 0.421875, 0.578125, 0.734375, 0.890625, 1,
    ]);
  });
  it("reads density, crop and resize anew without retaining a plan", () => {
    const fixture = numericCases[0];
    const input = { ...fixture.input };
    const multiples: number[] = [];
    const colors: number[] = [];
    for (const density of [1, 1.6, 2, 410 / 256]) {
      input.physicalScale = { x: density, y: density };
      const plan = planNativeImageSampling(input);
      if (!plan.ok || !plan.pixelated)
        throw new Error("Pixelated plan missing");
      multiples.push(plan.pixelated.x);
      colors.push(
        virtualPixelatedModel(
          { ...fixture, input },
          [1.5 / (5 * density), 0.5],
          plan.pixelated,
        )[0],
      );
    }
    expect(multiples).toEqual([1, 2, 2, 2]);
    expect(colors[0]).toBe(0.25);
    expect(colors[1]).toBe(0.09375);
    expect(colors[2]).toBe(0);
    expect(colors[3]).not.toBe(colors[1]);
    input.localBox = { ...input.localBox, width: 10 };
    input.uv = { x: 0.25, y: 0, width: 0.5, height: 1 };
    expect(planNativeImageSampling(input)).toEqual({
      ok: true,
      filter: "nearest",
      pixelated: { x: 6, y: 2 },
    });
  });
});

describe("physical object placement and crop", () => {
  it.each(physicalCases)("$name", (fixture) => {
    const plan = planNativeImageSampling(fixture.input);
    if (!plan.ok || !plan.pixelated) throw new Error("Pixelated plan missing");
    for (const point of physicalSamplingSites(fixture.input)) {
      const expectedUv = referencePhysicalUv(fixture.input, point);
      const actualUv = modelPhysicalUv(fixture.input, point);
      if (!expectedUv || !actualUv) {
        expect(actualUv).toEqual(expectedUv);
        continue;
      }
      const expected = materializedPixelatedReference(fixture, expectedUv);
      const actual = virtualPixelatedModel(fixture, actualUv, plan.pixelated);
      for (let channel = 0; channel < 4; channel++)
        expect(Math.abs(actual[channel] - expected[channel])).toBeLessThan(
          0.000003,
        );
    }
  });
});
