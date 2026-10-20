import { describe, expect, it } from "vitest";

import { collectAncestorIds, type LayersPanelNode } from "./LayersPanel";

function fullWalkAncestorIds(
  nodes: LayersPanelNode[],
  targetIds: ReadonlySet<string>,
): string[] {
  const ancestors = new Set<string>();
  function visit(node: LayersPanelNode, path: string[]): boolean {
    let containsSelectedChild = false;
    (node.children ?? []).forEach((child) => {
      if (visit(child, [...path, node.id])) containsSelectedChild = true;
    });
    const containsSelected = targetIds.has(node.id) || containsSelectedChild;
    if (containsSelected) path.forEach((id) => ancestors.add(id));
    return containsSelected;
  }
  nodes.forEach((node) => visit(node, []));
  return Array.from(ancestors);
}

function layer(id: string, children?: LayersPanelNode[]): LayersPanelNode {
  return { id, name: id, children };
}

function file(id: string, layers: LayersPanelNode[]): LayersPanelNode {
  return { id, name: id, type: "file", children: [...layers] };
}

function countChildReads(node: LayersPanelNode): { reads: number } {
  const counter = { reads: 0 };
  const children = node.children;
  Object.defineProperty(node, "children", {
    get() {
      counter.reads += 1;
      return children;
    },
  });
  return counter;
}

describe("collectAncestorIds", () => {
  const screenA = [
    layer("a-body", [
      layer("a-hero", [layer("a-title"), layer("a-cta")]),
      layer("a-footer", [layer("shared")]),
    ]),
    layer("a-overlay"),
  ];
  const screenB = [
    layer("b-body", [
      layer("b-card", [layer("shared"), layer("b-dup", [layer("b-dup")])]),
    ]),
  ];
  const roots = [
    layer("board-group", [layer("board-shape")]),
    file("file-a", screenA),
    file("file-b", screenB),
    layer("top-level"),
  ];

  it.each([
    ["one deep layer", ["a-cta"]],
    ["layers across screens", ["b-card", "a-title", "board-shape"]],
    ["an ancestor and its descendant", ["a-title", "a-body", "a-hero"]],
    ["an id present in two screens", ["shared"]],
    ["an id repeated along one path", ["b-dup"]],
    ["root-level and screen-level ids", ["file-b", "top-level", "a-overlay"]],
    ["an id missing from the tree", ["missing"]],
    ["nothing", []],
  ])("matches the full-tree walk for %s", (_label, selected) => {
    const targets = new Set(selected);
    expect(collectAncestorIds(roots, targets)).toEqual(
      fullWalkAncestorIds(roots, targets),
    );
  });

  it("reuses untouched screen subtrees across rebuilt roots and re-reads an edited one", () => {
    const hero = layer("hero", [layer("title")]);
    const untouchedBody = layer("body-1", [hero]);
    const heroReads = countChildReads(hero);
    const editedBefore = layer("body-2", [layer("card")]);

    expect(
      collectAncestorIds(
        [file("file-1", [untouchedBody]), file("file-2", [editedBefore])],
        new Set(["title", "card"]),
      ),
    ).toEqual(["file-1", "body-1", "hero", "file-2", "body-2"]);
    expect(heroReads.reads).toBe(1);

    const editedAfter = layer("body-2", [layer("group", [layer("card")])]);
    expect(
      collectAncestorIds(
        [file("file-1", [untouchedBody]), file("file-2", [editedAfter])],
        new Set(["title", "card"]),
      ),
    ).toEqual(["file-1", "body-1", "hero", "file-2", "body-2", "group"]);
    expect(heroReads.reads).toBe(1);
  });
});
