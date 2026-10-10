import { describe, expect, it } from "vitest";

import {
  MAX_NATIVE_SVG_PATTERN_WORK,
  planNativeSvgPatternWork,
} from "./native-svg-pattern-work";

const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const plan = (
  width: number,
  height: number,
  tileWidth: number,
  tileHeight: number,
  matrix = identity,
  nodes = 1,
) =>
  planNativeSvgPatternWork({
    viewport: { width, height },
    tile: { width: tileWidth, height: tileHeight },
    localToScreen: matrix,
    resourceNodes: nodes,
  });

describe("native SVG pattern repeat work", () => {
  it("ceil-bounds two extra edge tiles and charges content nodes per paint reference", () => {
    expect(plan(240, 160, 1, 1, identity, 4)).toEqual({
      ok: true,
      repeatsX: 242,
      repeatsY: 162,
      workUnits: 156816,
    });
    expect(plan(10.25, 5.5, 2, 3)).toEqual({
      ok: true,
      repeatsX: 8,
      repeatsY: 4,
      workUnits: 32,
    });
  });

  it.each([1, 1.6, 2])(
    "retains half-unit coverage under matched viewport/affine scaling (%s)",
    (scale) => {
      const result = plan(240 * scale, 160 * scale, 0.5, 0.5, {
        ...identity,
        a: scale,
        d: scale,
      });
      expect(result).toEqual({
        ok: true,
        repeatsX: 482,
        repeatsY: 322,
        workUnits: 155204,
      });
    },
  );

  it("inverse-bounds root viewBox magnification and local contraction", () => {
    expect(plan(240, 160, 1, 1, { ...identity, a: 2, d: 2 })).toEqual({
      ok: true,
      repeatsX: 122,
      repeatsY: 82,
      workUnits: 10004,
    });
    expect(plan(240, 160, 1, 1, { ...identity, a: 0.5, d: 0.5 })).toEqual({
      ok: true,
      repeatsX: 482,
      repeatsY: 322,
      workUnits: 155204,
    });
  });

  it("covers reflected, rotated, and sheared local viewport spans", () => {
    expect(plan(240, 160, 1, 1, { ...identity, a: -1 })).toEqual({
      ok: true,
      repeatsX: 242,
      repeatsY: 162,
      workUnits: 39204,
    });
    expect(
      plan(160, 240, 1, 1, { ...identity, a: 0, b: 1, c: -1, d: 0 }),
    ).toEqual({ ok: true, repeatsX: 242, repeatsY: 162, workUnits: 39204 });
    expect(plan(240, 160, 1, 1, { ...identity, c: 1 })).toEqual({
      ok: true,
      repeatsX: 402,
      repeatsY: 162,
      workUnits: 65124,
    });
  });

  it("does not lose a viewport span to a large screen translation", () => {
    expect(plan(240, 160, 1, 1, { ...identity, e: 1e300, f: -1e300 })).toEqual(
      plan(240, 160, 1, 1),
    );
  });

  it("bounds small finite tiles by work rather than an arbitrary minimum dimension", () => {
    expect(plan(1, 1, 0.001, 0.001)).toEqual({
      ok: true,
      repeatsX: 1002,
      repeatsY: 1002,
      workUnits: 1004004,
    });
    expect(plan(240, 160, 0.001, 0.001)).toEqual({
      ok: false,
      reason: "work-limit",
    });
  });

  it.each([1e-300, 1e-320, Number.MIN_VALUE])(
    "refuses tiny positive tile dimensions without quotient overflow (%s)",
    (width) => {
      expect(plan(240, 160, width, 1)).toEqual({
        ok: false,
        reason: "work-limit",
      });
      expect(plan(240, 160, width, width)).toEqual({
        ok: false,
        reason: "work-limit",
      });
    },
  );

  it("refuses near-singular affine work without treating a rounded determinant as a safe scale", () => {
    expect(
      plan(240, 160, 1, 1, { ...identity, b: 1, c: 1, d: 1 + Number.EPSILON }),
    ).toEqual({ ok: false, reason: "work-limit" });
    expect(plan(240, 160, 1, 1, { ...identity, a: 1e-300, d: 1e-300 })).toEqual(
      { ok: false, reason: "work-limit" },
    );
    expect(plan(240, 160, 1, 1, { ...identity, b: 1, c: 1 })).toEqual({
      ok: false,
      reason: "singular",
    });
  });

  it("honors an exact inclusive work ceiling and rejects one extra resource-node charge", () => {
    expect(
      plan(2, 2, 1, 1, identity, MAX_NATIVE_SVG_PATTERN_WORK / 16),
    ).toEqual({
      ok: true,
      repeatsX: 4,
      repeatsY: 4,
      workUnits: MAX_NATIVE_SVG_PATTERN_WORK,
    });
    expect(
      plan(2, 2, 1, 1, identity, MAX_NATIVE_SVG_PATTERN_WORK / 16 + 1),
    ).toEqual({ ok: false, reason: "work-limit" });
  });

  it.each([NaN, Infinity, -Infinity, 0, -1])(
    "refuses invalid viewport and tile input (%s)",
    (value) => {
      expect(plan(value, 160, 1, 1)).toEqual({
        ok: false,
        reason: "invalid-input",
      });
      expect(plan(240, 160, value, 1)).toEqual({
        ok: false,
        reason: "invalid-input",
      });
    },
  );

  it("refuses nonfinite matrix components and invalid content multiplicity", () => {
    for (const component of ["a", "b", "c", "d", "e", "f"] as const)
      expect(
        plan(240, 160, 1, 1, { ...identity, [component]: Infinity }),
      ).toEqual({ ok: false, reason: "invalid-input" });
    for (const nodes of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])
      expect(plan(240, 160, 1, 1, identity, nodes)).toEqual({
        ok: false,
        reason: "invalid-input",
      });
  });
});
