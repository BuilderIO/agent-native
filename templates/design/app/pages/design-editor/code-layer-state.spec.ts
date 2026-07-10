import type { CodeLayerNode } from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import {
  codeLayerNodeMatchesBridgeTarget,
  elementInfoFromCodeLayerNode,
  resolveCodeLayerNodeFromBridge,
} from "./code-layer-state";

function makeNode(overrides: Partial<CodeLayerNode> = {}): CodeLayerNode {
  const selector = overrides.selector ?? "div";
  return {
    id: overrides.id ?? "node-1",
    tag: overrides.tag ?? "div",
    layerName: overrides.layerName ?? "Div",
    layerNameSource: overrides.layerNameSource ?? "tag",
    selector,
    selectors: overrides.selectors ?? [selector],
    path: overrides.path ?? selector,
    attributes: overrides.attributes ?? {},
    dataAttributes: overrides.dataAttributes ?? {},
    classes: overrides.classes ?? [],
    textSnippet: overrides.textSnippet ?? null,
    style: overrides.style ?? {},
    styleTokens: overrides.styleTokens ?? [],
    parentId: overrides.parentId,
    children: overrides.children ?? [],
    layout: overrides.layout ?? {
      siblingIndex: 0,
      nthOfType: 1,
      isFlexContainer: false,
      isGridContainer: false,
    },
    capabilities: overrides.capabilities ?? [],
    confidence: overrides.confidence ?? 1,
    source: overrides.source ?? null,
    componentInstance: overrides.componentInstance,
  };
}

describe("elementInfoFromCodeLayerNode provenance", () => {
  it("preserves exact React source anchors from runtime projection attributes", () => {
    const info = elementInfoFromCodeLayerNode(
      makeNode({
        dataAttributes: {
          "data-source-file": " app/components/Card.tsx ",
          "data-source-line": "18",
          "data-source-column": "7",
          "data-component-name": " Card ",
        },
      }),
    );

    expect(info.provenance).toEqual({
      sourceFile: "app/components/Card.tsx",
      line: 18,
      column: 7,
      component: "Card",
    });
  });

  it.each(["0", "-1", "1.5", "1e2", "NaN", "9007199254740992"])(
    "omits non-positive or non-integer source coordinate %s",
    (coordinate) => {
      const info = elementInfoFromCodeLayerNode(
        makeNode({
          dataAttributes: {
            "data-source-file": "app/Card.tsx",
            "data-source-line": coordinate,
            "data-source-column": coordinate,
          },
        }),
      );

      expect(info.provenance).toEqual({ sourceFile: "app/Card.tsx" });
    },
  );

  it("accepts zero-padded positive integer source coordinates", () => {
    const info = elementInfoFromCodeLayerNode(
      makeNode({
        dataAttributes: {
          "data-source-line": "0012",
          "data-source-column": "0003",
        },
      }),
    );

    expect(info.provenance).toEqual({ line: 12, column: 3 });
  });

  it("omits provenance entirely when no source attribute has a usable value", () => {
    const info = elementInfoFromCodeLayerNode(
      makeNode({
        dataAttributes: {
          "data-source-file": "  ",
          "data-source-line": "0",
          "data-source-column": "not-a-number",
          "data-component-name": "  ",
        },
      }),
    );

    expect(info.provenance).toBeUndefined();
  });
});

describe("resolveCodeLayerNodeFromBridge", () => {
  it("resolves a unique sourceId match regardless of selector", () => {
    const target = makeNode({
      id: "target",
      dataAttributes: { "data-agent-native-node-id": "target" },
    });
    const other = makeNode({ id: "other" });
    const projection = { nodes: [other, target] };

    const resolved = resolveCodeLayerNodeFromBridge(
      projection,
      "body > div",
      "target",
    );

    expect(resolved).toBe(target);
  });

  it("finds the sourceId match even when an unrelated earlier node matches the selector first", () => {
    // Regression: the old implementation was a single combined `.find()`
    // over (selector OR sourceId), so a selector-only match earlier in the
    // array could win over the correct sourceId match later in the array.
    const selectorMatchButWrongNode = makeNode({
      id: "decoy",
      selector: "body > div",
      selectors: ["body > div"],
      path: "body > div",
    });
    const realTarget = makeNode({
      id: "target",
      selector: "body > div",
      selectors: ["body > div"],
      path: "body > div",
      dataAttributes: { "data-agent-native-node-id": "target" },
    });
    const projection = { nodes: [selectorMatchButWrongNode, realTarget] };

    const resolved = resolveCodeLayerNodeFromBridge(
      projection,
      "body > div",
      "target",
    );

    expect(resolved).toBe(realTarget);
  });

  it("resolves a selector when it matches exactly one node", () => {
    const target = makeNode({
      id: "only-match",
      selector: "ul > li:nth-of-type(3)",
      selectors: ["ul > li:nth-of-type(3)"],
      path: "ul > li:nth-of-type(3)",
    });
    const projection = { nodes: [target] };

    const resolved = resolveCodeLayerNodeFromBridge(
      projection,
      "ul > li:nth-of-type(3)",
    );

    expect(resolved).toBe(target);
  });

  it("refuses to resolve (returns null) when a selector matches multiple nodes and no sourceId disambiguates", () => {
    // Two repeated card instances share the same generic suffix selector —
    // exactly the shape a bridge target for a not-yet-stamped repeated
    // list/card item emits. Silently picking the first would risk mutating
    // the wrong sibling; the resolver must fail closed instead, mirroring
    // the server-side resolveTarget's ambiguity-conflict discipline.
    const cardA = makeNode({
      id: "card-a",
      selector: "div > p",
      selectors: ["div > p"],
      path: "div > p",
    });
    const cardB = makeNode({
      id: "card-b",
      selector: "div > p",
      selectors: ["div > p"],
      path: "div > p",
    });
    const projection = { nodes: [cardA, cardB] };

    const resolved = resolveCodeLayerNodeFromBridge(projection, "div > p");

    expect(resolved).toBeNull();
  });

  it("returns null when neither sourceId nor selector matches anything", () => {
    const projection = { nodes: [makeNode({ id: "unrelated" })] };

    const resolved = resolveCodeLayerNodeFromBridge(
      projection,
      "section > article",
      "missing-id",
    );

    expect(resolved).toBeNull();
  });

  it("falls back to the selector when sourceId is present but matches no node", () => {
    const target = makeNode({
      id: "only-match",
      selector: "main > h1",
      selectors: ["main > h1"],
      path: "main > h1",
    });
    const projection = { nodes: [target] };

    const resolved = resolveCodeLayerNodeFromBridge(
      projection,
      "main > h1",
      "stale-pending-id-not-in-projection",
    );

    expect(resolved).toBe(target);
  });
});

describe("codeLayerNodeMatchesBridgeTarget", () => {
  it("matches by sourceId even when the selector does not match", () => {
    const node = makeNode({
      id: "target",
      dataAttributes: { "data-agent-native-node-id": "target" },
      selector: "div",
      selectors: ["div"],
      path: "div",
    });

    expect(
      codeLayerNodeMatchesBridgeTarget(
        node,
        "completely > unrelated",
        "target",
      ),
    ).toBe(true);
  });

  it("falls back to selector matching when sourceId does not match", () => {
    const node = makeNode({
      id: "node-a",
      selector: "ul > li:nth-of-type(2)",
      selectors: ["ul > li:nth-of-type(2)"],
      path: "ul > li:nth-of-type(2)",
    });

    expect(
      codeLayerNodeMatchesBridgeTarget(
        node,
        "ul > li:nth-of-type(2)",
        "unrelated-id",
      ),
    ).toBe(true);
  });

  it("returns false when neither sourceId nor selector matches", () => {
    const node = makeNode({
      id: "node-a",
      selector: "div",
      selectors: ["div"],
    });

    expect(
      codeLayerNodeMatchesBridgeTarget(node, "section > p", "unrelated-id"),
    ).toBe(false);
  });
});
