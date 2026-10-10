import { describe, expect, it } from "vitest";

import {
  MAX_NATIVE_SOURCE_GROUP_DEPTH,
  MAX_NATIVE_SOURCE_PAINT_NODES,
  planNativeSourceComposition,
  type NativeSourcePaintInput,
  type NativeSourcePaintNode,
} from "./native-source-composition-tree";

const box = { x: 0, y: 0, width: 100, height: 100 };

function paint(
  id: string,
  isolationPath: NativeSourcePaintInput["isolationPath"] = [],
): NativeSourcePaintInput {
  return { id, box, isolationPath, opacity: 1 };
}

function compositedAlpha(
  node: NativeSourcePaintNode,
  sourceAlpha = 1,
  clipCoverage = 1,
): number {
  if (node.kind === "leaf") return sourceAlpha * node.opacity;
  const inside = node.children.reduce((behind, child) => {
    const foreground = compositedAlpha(child, sourceAlpha, clipCoverage);
    return foreground + behind * (1 - foreground);
  }, 0);
  return (
    inside * node.opacity * (node.isolationKind === "clip" ? clipCoverage : 1)
  );
}

describe("native source composition tree", () => {
  it("isolates overlapping opaque children before applying a fractional ancestor", () => {
    const result = planNativeSourceComposition([
      paint("first", [{ id: "glass", kind: "opacity", opacity: 0.5 }]),
      paint("second", [{ id: "glass", kind: "opacity", opacity: 0.5 }]),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.children).toHaveLength(1);
    expect(result.root.children[0]).toMatchObject({
      kind: "group",
      id: "glass",
      isolate: true,
      opacity: 0.5,
      children: [{ id: "first" }, { id: "second" }],
    });
    expect(compositedAlpha(result.root)).toBe(0.5);
    expect(0.5 + 0.5 * (1 - 0.5)).toBe(0.75);
  });

  it("nests fractional groups and keeps native output atomic with baked own opacity", () => {
    const result = planNativeSourceComposition([
      {
        ...paint("native", [
          { id: "outer", kind: "opacity", opacity: 0.5 },
          { id: "inner", kind: "opacity", opacity: 0.4 },
        ]),
        ownOpacityBaked: true,
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.children[0]).toMatchObject({
      kind: "group",
      id: "outer",
      children: [
        {
          kind: "group",
          id: "inner",
          children: [
            { kind: "leaf", id: "native", opacity: 1, ownOpacityBaked: true },
          ],
        },
      ],
    });
    expect(compositedAlpha(result.root, 0.5)).toBeCloseTo(0.1);
    expect(
      planNativeSourceComposition([
        { ...paint("native"), opacity: 0.5, ownOpacityBaked: true },
      ]),
    ).toMatchObject({ ok: false, reason: "invalid-input" });
  });

  it("flattens identity opacity while retaining clip isolation and paint order", () => {
    const result = planNativeSourceComposition([
      paint("a", [{ id: "plain", kind: "opacity", opacity: 1 }]),
      paint("b", [
        { id: "plain", kind: "opacity", opacity: 1 },
        { id: "clip", kind: "clip", clipId: "rounded-one" },
      ]),
      paint("c", [{ id: "plain", kind: "opacity", opacity: 1 }]),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.children.map((child) => child.id)).toEqual([
      "a",
      "clip",
      "c",
    ]);
    expect(result.root.children[1]).toMatchObject({
      kind: "group",
      isolate: true,
      clipId: "rounded-one",
      children: [{ id: "b" }],
    });
  });

  it("applies fractional corner-clip coverage once after overlapping children", () => {
    const result = planNativeSourceComposition([
      paint("first", [{ id: "rounded", kind: "clip", clipId: "rounded-clip" }]),
      paint("second", [
        { id: "rounded", kind: "clip", clipId: "rounded-clip" },
      ]),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.children[0]).toMatchObject({
      isolationKind: "clip",
      isolate: true,
      children: [{ id: "first" }, { id: "second" }],
    });
    expect(compositedAlpha(result.root, 1, 0.5)).toBe(0.5);
    expect(0.5 + 0.5 * (1 - 0.5)).toBe(0.75);
  });

  it("puts a group's own paint inside opacity but outside its descendant overflow clip", () => {
    const opacity = { id: "rounded", kind: "opacity" as const, opacity: 0.5 };
    const clip = { id: "rounded", kind: "clip" as const, clipId: "inner" };
    const result = planNativeSourceComposition([
      paint("own-background", [opacity]),
      paint("child", [opacity, clip]),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.children[0]).toMatchObject({
      isolationKind: "opacity",
      children: [
        { kind: "leaf", id: "own-background" },
        { isolationKind: "clip", children: [{ id: "child" }] },
      ],
    });
  });

  it("rejects noncontiguous groups, duplicate leaves, and changed group metadata", () => {
    expect(
      planNativeSourceComposition([
        paint("a", [{ id: "group", kind: "opacity", opacity: 0.5 }]),
        paint("b"),
        paint("c", [{ id: "group", kind: "opacity", opacity: 0.5 }]),
      ]),
    ).toMatchObject({ ok: false, reason: "invalid-hierarchy" });
    expect(
      planNativeSourceComposition([
        paint("a", [{ id: "group", kind: "opacity", opacity: 0.5 }]),
        paint("b", [{ id: "group", kind: "opacity", opacity: 0.6 }]),
      ]),
    ).toMatchObject({ ok: false, reason: "invalid-hierarchy" });
    expect(planNativeSourceComposition([paint("a"), paint("a")])).toMatchObject(
      {
        ok: false,
        reason: "invalid-input",
      },
    );
    expect(
      planNativeSourceComposition([
        paint("same", [{ id: "same", kind: "opacity", opacity: 0.5 }]),
      ]),
    ).toMatchObject({ ok: false, reason: "invalid-input" });
    expect(
      planNativeSourceComposition([
        paint("same"),
        paint("other", [{ id: "same", kind: "opacity", opacity: 0.5 }]),
      ]),
    ).toMatchObject({ ok: false, reason: "invalid-input" });
  });

  it("rejects nonfinite geometry and bounded depth or node counts", () => {
    expect(
      planNativeSourceComposition([
        { ...paint("a"), box: { ...box, width: Number.NaN } },
      ]),
    ).toMatchObject({ ok: false, reason: "invalid-input" });
    expect(
      planNativeSourceComposition([
        paint(
          "deep",
          Array.from(
            { length: MAX_NATIVE_SOURCE_GROUP_DEPTH + 1 },
            (_, index) => ({
              id: `group-${index}`,
              kind: "opacity" as const,
              opacity: 0.5,
            }),
          ),
        ),
      ]),
    ).toMatchObject({ ok: false, reason: "limit-exceeded" });
    expect(
      planNativeSourceComposition([
        { ...paint("left"), box: { x: -1e308, y: 0, width: 1, height: 1 } },
        { ...paint("right"), box: { x: 1e308, y: 0, width: 1, height: 1 } },
      ]),
    ).toMatchObject({ ok: false, reason: "invalid-input" });
    expect(
      planNativeSourceComposition(
        Array.from({ length: MAX_NATIVE_SOURCE_PAINT_NODES }, (_, index) =>
          paint(`leaf-${index}`),
        ),
      ),
    ).toMatchObject({ ok: false, reason: "limit-exceeded" });
  });
});
