import { expect, it } from "vitest";

import {
  createLayerMovePlanner,
  createSiblingMoveTarget,
  indexLayers,
  resolveLayerMove,
  visibleLayers,
  type LayerRecord,
} from "./layer-tree-model.js";

const nodes: LayerRecord[] = [
  { id: "page", parentId: null, name: "Page", container: true, fixed: true },
  { id: "nav", parentId: "page", name: "Nav", container: true },
  { id: "logo", parentId: "nav", name: "Logo" },
  { id: "hero", parentId: "page", name: "Hero", container: true },
  { id: "cta", parentId: "hero", name: "Call to action" },
  {
    id: "legal",
    parentId: "page",
    name: "Legal",
    container: true,
    locked: true,
  },
  { id: "terms", parentId: "legal", name: "Terms" },
];
const index = indexLayers(nodes);
it("finds move targets at both ends of each selected sibling range", () => {
  const siblings = Array.from("abcdefg", (id) => ({
    id,
    name: id,
    parentId: null,
  }));
  const lookup = createSiblingMoveTarget(
    indexLayers(siblings),
    new Set(["a", "b", "d", "e", "g"]),
  );
  expect(siblings.map((item) => lookup(item, -1)?.id)).toEqual([
    undefined,
    undefined,
    "b",
    "c",
    "c",
    "e",
    "f",
  ]);
  expect(siblings.map((item) => lookup(item, 1)?.id)).toEqual([
    "c",
    "c",
    "d",
    "f",
    "f",
    "g",
    undefined,
  ]);
});

it("moves selected roots in document order and keeps selected descendants attached", () => {
  const next = resolveLayerMove(index, {
    ids: ["cta", "logo", "nav"],
    targetId: "hero",
    placement: "inside",
  });
  expect(next?.map((n) => [n.id, n.parentId])).toEqual([
    ["page", null],
    ["hero", "page"],
    ["nav", "hero"],
    ["logo", "nav"],
    ["cta", "hero"],
    ["legal", "page"],
    ["terms", "legal"],
  ]);
  expect(next?.find((n) => n.id === "logo")).toBe(nodes[2]);
  expect(nodes[1]?.parentId).toBe("page");
});
it.each([
  ["nav", "logo", "before"],
  ["legal", "nav", "inside"],
  ["terms", "hero", "inside"],
  ["cta", "terms", "before"],
  ["cta", "legal", "inside"],
  ["logo", "page", "after"],
  ["nav", "hero", "before"],
  ["nav", "logo", "inside"],
] as const)(
  "rejects invalid or unchanged moves: %s %s %s",
  (source, targetId, placement) => {
    expect(
      resolveLayerMove(index, { ids: [source], targetId, placement }),
    ).toBeNull();
  },
);
it("refuses cycles and missing parents before rendering a partial hierarchy", () => {
  expect(() =>
    indexLayers([{ id: "a", name: "A", parentId: "a", container: true }]),
  ).toThrow(/cycle/);
  expect(() =>
    indexLayers([{ id: "a", name: "A", parentId: "missing" }]),
  ).toThrow(/parent/);
});

it("keeps a deeply nested imported document navigable through a reparent", () => {
  const chain = Array.from({ length: 10000 }, (_, i) => ({
    id: String(i),
    name: String(i),
    parentId: i ? String(i - 1) : null,
    container: true,
  }));
  const indexed = indexLayers(chain);
  const visible = visibleLayers(
    indexed,
    new Set(indexed.byId.keys()),
    new Set(["0"]),
  );
  expect(visible.at(-1)).toMatchObject({ depth: 9999, selectedAncestor: true });
  const moved = resolveLayerMove(indexed, {
    ids: ["9999"],
    targetId: "0",
    placement: "before",
  });
  expect(moved?.[0]).toMatchObject({ id: "9999", parentId: null });
  expect(moved?.length).toBe(10000);
});

it("distinguishes unchanged sibling blocks from moves across gaps and across parents during a drag", () => {
  const flat = indexLayers(
    ["a", "b", "c", "d", "e"].map((id) => ({ id, name: id, parentId: null })),
  );
  const block = createLayerMovePlanner(flat, ["c", "b"]);
  expect(block("a", "after")).toBeNull();
  expect(block("d", "before")).toBeNull();
  expect(block("e", "before")?.offset).toBe(4);
  expect(createLayerMovePlanner(flat, ["a", "c"])("d", "before")?.offset).toBe(
    3,
  );
  const mixed = createLayerMovePlanner(index, ["logo", "cta"]);
  expect(mixed("terms", "before")).toBeNull();
  expect(mixed("hero", "inside")?.moving).toEqual(new Set(["logo", "cta"]));
});
