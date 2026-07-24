import type { CodeLayerNode, LayoutContext } from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import {
  nearestMeaningfulParentId,
  partitionSelectionForAlignment,
} from "./selection-topology";

interface NodeOpts {
  parentId?: string;
  children?: string[];
  isFlexContainer?: boolean;
  isGridContainer?: boolean;
}

function makeNode(id: string, opts: NodeOpts = {}): CodeLayerNode {
  const layout: LayoutContext = {
    parentId: opts.parentId,
    siblingIndex: 0,
    nthOfType: 0,
    isFlexContainer: opts.isFlexContainer ?? false,
    isGridContainer: opts.isGridContainer ?? false,
  };
  return {
    id,
    tag: "div",
    layerName: id,
    layerNameSource: "tag",
    selector: `#${id}`,
    selectors: [`#${id}`],
    path: id,
    attributes: {},
    dataAttributes: {},
    classes: [],
    textSnippet: null,
    style: {},
    styleTokens: [],
    parentId: opts.parentId,
    children: opts.children ?? [],
    layout,
    capabilities: [],
    confidence: 1,
    source: null,
  };
}

function mapOf(nodes: CodeLayerNode[]): Map<string, CodeLayerNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

/**
 * Golden fixture: a root container holding three cards, each card holding a
 * title + body. Used across the sibling / titles / mixed-ancestry cases.
 */
function nestedCardsFixture(): CodeLayerNode[] {
  return [
    makeNode("root", { children: ["cardA", "cardB", "cardC"] }),
    makeNode("cardA", { parentId: "root", children: ["titleA", "bodyA"] }),
    makeNode("titleA", { parentId: "cardA" }),
    makeNode("bodyA", { parentId: "cardA" }),
    makeNode("cardB", { parentId: "root", children: ["titleB", "bodyB"] }),
    makeNode("titleB", { parentId: "cardB" }),
    makeNode("bodyB", { parentId: "cardB" }),
    makeNode("cardC", { parentId: "root", children: ["titleC", "bodyC"] }),
    makeNode("titleC", { parentId: "cardC" }),
    makeNode("bodyC", { parentId: "cardC" }),
  ];
}

describe("nearestMeaningfulParentId", () => {
  it("returns null when the node has no parent", () => {
    const nodes = mapOf([makeNode("root", { children: [] })]);
    expect(nearestMeaningfulParentId(nodes, "root")).toBeNull();
  });

  it("returns the raw parent when it is multi-child", () => {
    const nodes = mapOf(nestedCardsFixture());
    expect(nearestMeaningfulParentId(nodes, "titleA")).toBe("cardA");
  });

  it("keeps a flex container parent (not collapsed even with one child)", () => {
    const nodes = mapOf([
      makeNode("root", { children: ["flex"] }),
      makeNode("flex", {
        parentId: "root",
        children: ["only"],
        isFlexContainer: true,
      }),
      makeNode("only", { parentId: "flex" }),
    ]);
    expect(nearestMeaningfulParentId(nodes, "only")).toBe("flex");
  });

  it("keeps a grid container parent", () => {
    const nodes = mapOf([
      makeNode("root", { children: ["grid"] }),
      makeNode("grid", {
        parentId: "root",
        children: ["only"],
        isGridContainer: true,
      }),
      makeNode("only", { parentId: "grid" }),
    ]);
    expect(nearestMeaningfulParentId(nodes, "only")).toBe("grid");
  });

  it("collapses single-child pass-through wrappers up to the real parent", () => {
    const nodes = mapOf([
      makeNode("real", { children: ["wrapper1", "wrapper2"] }),
      makeNode("wrapper1", { parentId: "real", children: ["node1"] }),
      makeNode("node1", { parentId: "wrapper1" }),
      makeNode("wrapper2", { parentId: "real", children: ["node2"] }),
      makeNode("node2", { parentId: "wrapper2" }),
    ]);
    expect(nearestMeaningfulParentId(nodes, "node1")).toBe("real");
    expect(nearestMeaningfulParentId(nodes, "node2")).toBe("real");
  });

  it("collapses a chain of stacked pass-through wrappers", () => {
    const nodes = mapOf([
      makeNode("real", { children: ["w1", "sibling"] }),
      makeNode("sibling", { parentId: "real" }),
      makeNode("w1", { parentId: "real", children: ["w2"] }),
      makeNode("w2", { parentId: "w1", children: ["leaf"] }),
      makeNode("leaf", { parentId: "w2" }),
    ]);
    expect(nearestMeaningfulParentId(nodes, "leaf")).toBe("real");
  });

  it("returns null when pass-through wrappers climb off the top", () => {
    const nodes = mapOf([
      makeNode("wrapper", { children: ["leaf"] }),
      makeNode("leaf", { parentId: "wrapper" }),
    ]);
    expect(nearestMeaningfulParentId(nodes, "leaf")).toBeNull();
  });

  it("returns null for an unknown node id", () => {
    const nodes = mapOf(nestedCardsFixture());
    expect(nearestMeaningfulParentId(nodes, "ghost")).toBeNull();
  });

  it("treats an unresolvable parent id as an opaque boundary", () => {
    const nodes = mapOf([makeNode("child", { parentId: "detached" })]);
    expect(nearestMeaningfulParentId(nodes, "child")).toBe("detached");
  });
});

describe("partitionSelectionForAlignment — sibling cards", () => {
  it("groups three sibling cards under their shared parent", () => {
    const groups = partitionSelectionForAlignment(nestedCardsFixture(), [
      "cardA",
      "cardB",
      "cardC",
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.parentId).toBe("root");
    expect(groups[0]!.nodeIds).toEqual(["cardA", "cardB", "cardC"]);
  });
});

describe("partitionSelectionForAlignment — titles in different cards", () => {
  it("splits three titles into three single-member groups by parent", () => {
    const groups = partitionSelectionForAlignment(nestedCardsFixture(), [
      "titleA",
      "titleB",
      "titleC",
    ]);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.parentId)).toEqual(["cardA", "cardB", "cardC"]);
    expect(groups.map((g) => g.nodeIds)).toEqual([
      ["titleA"],
      ["titleB"],
      ["titleC"],
    ]);
  });
});

describe("partitionSelectionForAlignment — mixed ancestry drops descendant", () => {
  it("drops a child whose ancestor is also selected", () => {
    const groups = partitionSelectionForAlignment(nestedCardsFixture(), [
      "cardA",
      "titleA",
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.parentId).toBe("root");
    expect(groups[0]!.nodeIds).toEqual(["cardA"]);
  });

  it("drops multiple deep descendants of one selected ancestor", () => {
    const groups = partitionSelectionForAlignment(nestedCardsFixture(), [
      "cardA",
      "titleA",
      "bodyA",
      "cardB",
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.parentId).toBe("root");
    expect(groups[0]!.nodeIds).toEqual(["cardA", "cardB"]);
  });
});

describe("partitionSelectionForAlignment — pass-through wrapper collapse", () => {
  it("groups nodes under distinct wrappers by their shared real parent", () => {
    const nodes = [
      makeNode("real", { children: ["wrapper1", "wrapper2"] }),
      makeNode("wrapper1", { parentId: "real", children: ["node1"] }),
      makeNode("node1", { parentId: "wrapper1" }),
      makeNode("wrapper2", { parentId: "real", children: ["node2"] }),
      makeNode("node2", { parentId: "wrapper2" }),
    ];
    const groups = partitionSelectionForAlignment(nodes, ["node1", "node2"]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.parentId).toBe("real");
    expect(groups[0]!.nodeIds).toEqual(["node1", "node2"]);
  });
});

describe("partitionSelectionForAlignment — flex container parent", () => {
  it("groups flow children by their flex parent id (not collapsed)", () => {
    const nodes = [
      makeNode("root", { children: ["flex"] }),
      makeNode("flex", {
        parentId: "root",
        children: ["fc1", "fc2"],
        isFlexContainer: true,
      }),
      makeNode("fc1", { parentId: "flex" }),
      makeNode("fc2", { parentId: "flex" }),
    ];
    const groups = partitionSelectionForAlignment(nodes, ["fc1", "fc2"]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.parentId).toBe("flex");
    expect(groups[0]!.nodeIds).toEqual(["fc1", "fc2"]);
  });
});

describe("partitionSelectionForAlignment — top-level nodes", () => {
  it("groups top-level nodes under the null parent key", () => {
    const nodes = [
      makeNode("screenA", { children: [] }),
      makeNode("screenB", { children: [] }),
    ];
    const groups = partitionSelectionForAlignment(nodes, [
      "screenA",
      "screenB",
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.parentId).toBeNull();
    expect(groups[0]!.nodeIds).toEqual(["screenA", "screenB"]);
  });
});

describe("partitionSelectionForAlignment — golden mixed scene", () => {
  it("keeps first-appearance ordering across parents and within a group", () => {
    // titleC appears first (key cardC), then two siblings that both key to root
    // preserving their input order.
    const groups = partitionSelectionForAlignment(nestedCardsFixture(), [
      "titleC",
      "cardA",
      "cardB",
    ]);
    expect(groups.map((g) => g.parentId)).toEqual(["cardC", "root"]);
    expect(groups.map((g) => g.nodeIds)).toEqual([
      ["titleC"],
      ["cardA", "cardB"],
    ]);
  });
});

describe("partitionSelectionForAlignment — degenerate inputs", () => {
  it("ignores unknown selected ids", () => {
    const groups = partitionSelectionForAlignment(nestedCardsFixture(), [
      "cardA",
      "ghost",
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.parentId).toBe("root");
    expect(groups[0]!.nodeIds).toEqual(["cardA"]);
  });

  it("returns an empty array for an empty selection", () => {
    expect(partitionSelectionForAlignment(nestedCardsFixture(), [])).toEqual(
      [],
    );
  });

  it("de-duplicates repeated selected ids", () => {
    const groups = partitionSelectionForAlignment(nestedCardsFixture(), [
      "cardA",
      "cardA",
      "cardB",
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.nodeIds).toEqual(["cardA", "cardB"]);
  });
});
