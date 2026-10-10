import { describe, expect, it } from "vitest";

import { planNativeEffectTransform } from "./native-effect-transform";
import type { EffectTransform2D } from "./native-effects";

const geometry = {
  width: 800,
  height: 400,
  pixelRatio: 2,
  target: { x: 0, y: 0, width: 800, height: 400 },
};

function sampleAt(
  transform: EffectTransform2D | undefined,
  point: [number, number],
  dimensions = geometry,
): [number, number] {
  const plan = planNativeEffectTransform(transform, dimensions);
  if (!plan.ok) throw new Error(plan.detail);
  return plan.rows.map(
    (row) => row[0] * point[0] + row[1] * point[1] + row[2],
  ) as [number, number];
}

function expectPoint(actual: [number, number], expected: [number, number]) {
  expect(actual[0]).toBeCloseTo(expected[0], 8);
  expect(actual[1]).toBeCloseTo(expected[1], 8);
}

describe("native effect output transform", () => {
  it("keeps absent and identity transforms unchanged", () => {
    expectPoint(sampleAt(undefined, [0.1, 0.8]), [0.1, 0.8]);
    expectPoint(
      sampleAt({ translate: [0, 0], scale: [1, 1], rotate: 0 }, [0.1, 0.8]),
      [0.1, 0.8],
    );
  });

  it("moves output by CSS pixel offsets independently of render density", () => {
    expectPoint(sampleAt({ translate: [40, -20] }, [0.6, 0.4]), [0.5, 0.5]);
    expectPoint(
      sampleAt({ translate: [40, -20] }, [0.6, 0.4], {
        width: 400,
        height: 200,
        pixelRatio: 1,
        target: { x: 0, y: 0, width: 400, height: 200 },
      }),
      [0.5, 0.5],
    );
  });

  it("scales around the authored origin and preserves rectangular pixel geometry", () => {
    expectPoint(sampleAt({ scale: [2, 0.5] }, [0.75, 0.75]), [0.625, 1]);
    expectPoint(
      sampleAt({ scale: [2, 2], origin: [0, 0] }, [0.6, 0.8]),
      [0.3, 0.4],
    );
    expectPoint(sampleAt({ rotate: Math.PI / 2 }, [0.75, 0.5]), [0.5, 0]);
  });

  it("inverts translation, rotation and nonuniform scale in their defined order", () => {
    const transform: EffectTransform2D = {
      translate: [-30, 17],
      scale: [1.4, 0.7],
      rotate: -0.8,
      origin: [0.3, 0.8],
    };
    const source: [number, number] = [0.61, 0.23];
    const [ox, oy] = [240, 320];
    const [sx, sy] = [
      (source[0] * 800 - ox) * 1.4,
      (source[1] * 400 - oy) * 0.7,
    ];
    const output: [number, number] = [
      (ox - 60 + Math.cos(-0.8) * sx - Math.sin(-0.8) * sy) / 800,
      (oy + 34 + Math.sin(-0.8) * sx + Math.cos(-0.8) * sy) / 400,
    ];
    expectPoint(sampleAt(transform, output), source);
  });

  it("keeps the origin tied to the target when effect output has a halo", () => {
    const expanded = {
      width: 880,
      height: 480,
      pixelRatio: 2,
      target: { x: 40, y: 40, width: 800, height: 400 },
    };
    expectPoint(
      sampleAt({ scale: [2, 2], origin: [0, 0] }, [0.5, 0.5], expanded),
      [240 / 880, 140 / 480],
    );
  });

  it("allows large bounded transforms but reports invalid float uniforms explicitly", () => {
    expect(
      planNativeEffectTransform(
        { translate: [-100_000, 100_000], scale: [100, 0.0001] },
        geometry,
      ).ok,
    ).toBe(true);
    expect(
      planNativeEffectTransform({ scale: [1e-300, 1] }, geometry),
    ).toMatchObject({
      ok: false,
      code: "effect-transform-invalid",
    });
    for (const transform of [
      { scale: [0, 1] },
      { rotate: Infinity },
      { origin: [-1, 0] },
    ])
      expect(
        planNativeEffectTransform(transform as EffectTransform2D, geometry).ok,
      ).toBe(false);
    expect(
      planNativeEffectTransform(undefined, { ...geometry, width: 0 }).ok,
    ).toBe(false);
  });
});
