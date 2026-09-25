import {
  buildCodeLayerTree,
  buildCodeLayerProjection,
  type CodeLayerNode,
} from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import { gridValueForElement } from "@/components/design/edit-panel/layout-properties";
import {
  MIXED_VALUE,
  mixedElementFromSelection,
} from "@/components/design/edit-panel/selection-helpers";
import type { ElementInfo } from "@/components/design/types";

import {
  canonicalElementInfoForCodeLayerNode,
  canonicalizeElementInfoFromProjection,
  codeLayerNodeLooksLikeComponent,
  codeLayerPatchMessage,
  layerTypeForCodeLayer,
  codeLayerNodeMatchesBridgeTarget,
  resolveCodeLayerTargetFromBridge,
  resolveCodeLayerTargetFromElementInfo,
  cssStyleAliases,
  elementInfoFromCodeLayerNode,
  elementInfoForOwnedCodeLayerNode,
  isClientRenderedMountShell,
  codeLayerSourceNodeIdAttrs,
  codeLayerTreeToPanelNodes,
  isCodeLayerNodeRuntimeOnly,
  liveDeleteSelectorGroups,
  refreshedBoundingRectSize,
  refreshedComputedStyles,
  resolveCodeLayerNodeFromBridge,
  resolveCodeLayerNodeFromElementInfo,
  runtimeLayerStateHandoffMode,
  previewCodeLayerTreeMove,
} from "./code-layer-state";

describe("codeLayerPatchMessage", () => {
  it("hides internal target-resolution details behind the caller fallback", () => {
    expect(
      codeLayerPatchMessage(
        'Node with data-agent-native-node-id="layer-1" not found in sourceHtml.',
        "Could not move that layer",
      ),
    ).toBe("Could not move that layer");
    expect(
      codeLayerPatchMessage(
        'Selector ".card" did not match a code layer node.',
        "Could not move that layer",
      ),
    ).toBe("Could not move that layer");
  });

  it("preserves an actionable user-facing message", () => {
    expect(
      codeLayerPatchMessage(
        "This screen is backed by a live route URL.",
        "Could not move that layer",
      ),
    ).toBe("This screen is backed by a live route URL.");
  });
});

describe("previewCodeLayerTreeMove", () => {
  it("rejects a stale anchor instead of hiding the source", () => {
    const tree = previewCodeLayerTreeMove(
      buildCodeLayerTree(
        buildCodeLayerProjection(
          '<div data-agent-native-node-id="source">Source</div>',
        ),
      ),
      {
        sourceId: "source",
        anchorId: "stale-anchor",
        placement: "after",
        insert: false,
      },
    );

    expect(tree).toBeNull();
  });
});

describe("cssStyleAliases", () => {
  it("maps WebKit text truncation declarations to the inspector style keys", () => {
    expect(
      cssStyleAliases({
        "-webkit-box-orient": "vertical",
        "-webkit-line-clamp": "2",
      }),
    ).toMatchObject({
      webkitBoxOrient: "vertical",
      webkitLineClamp: "2",
    });
  });
});

function makeElementInfo(overrides: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tagName: "div",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    isFlexChild: false,
    isFlexContainer: false,
    ...overrides,
  };
}

function makeNode(overrides: Partial<CodeLayerNode> = {}): CodeLayerNode {
  const selector = overrides.selector ?? "div";
  return {
    id: overrides.id ?? "node-1",
    tag: overrides.tag ?? "div",
    layerName: overrides.layerName ?? "Div",
    layerNameSource: overrides.layerNameSource ?? "tag",
    paintsOwnText: overrides.paintsOwnText ?? false,
    repeatXFor: overrides.repeatXFor ?? null,
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
  it("preserves explicit group identity from the source projection", () => {
    const info = elementInfoFromCodeLayerNode(
      makeNode({
        dataAttributes: { "data-agent-native-group": "true" },
      }),
    );

    expect(info.isGroup).toBe(true);
  });

  it("preserves authored constraints and sizing alongside paint in layer selections", () => {
    const styles = {
      position: "absolute",
      left: "auto",
      right: "12px",
      top: "auto",
      bottom: "12px",
      width: "20px",
      height: "20px",
      whiteSpace: "nowrap",
      backgroundColor: "blue",
    };
    const info = elementInfoFromCodeLayerNode(makeNode({ style: styles }));

    expect(info.inlineStyles).toEqual(styles);
    expect(info.inlineStyles).not.toBe(info.computedStyles);
  });

  it("preserves complete React source anchors from runtime projection attributes", () => {
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
      method: "data-attribute",
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

      expect(info.provenance).toEqual({
        sourceFile: "app/Card.tsx",
        method: "data-attribute",
      });
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

  it("keeps the owner instantiation site and React key the bridge stamped for .map() siblings", () => {
    const info = elementInfoFromCodeLayerNode(
      makeNode({
        dataAttributes: {
          "data-source-file": "src/components/Card.jsx",
          "data-source-line": "25",
          "data-source-column": "32",
          "data-component-name": "Card",
          "data-source-owner-file": "src/App.jsx",
          "data-source-owner-line": "55",
          "data-source-owner-column": "51",
          "data-source-owner-component": "Card",
          "data-source-owner-key": "b",
        },
      }),
    );

    expect(info.provenance).toEqual({
      sourceFile: "src/components/Card.jsx",
      line: 25,
      column: 32,
      component: "Card",
      ownerSourceFile: "src/App.jsx",
      ownerLine: 55,
      ownerColumn: 51,
      ownerComponentName: "Card",
      ownerKey: "b",
      method: "data-attribute",
    });
  });

  it("labels the owner position with its own tier, which can differ from the element's", () => {
    const info = elementInfoFromCodeLayerNode(
      makeNode({
        dataAttributes: {
          "data-source-file": "src/components/Card.jsx",
          "data-source-line": "7",
          "data-source-column": "9",
          "data-source-owner-file": "src/App.jsx",
          "data-source-owner-line": "55",
          "data-source-owner-method": "debug-stack",
        },
      }),
    );

    // The element's attribute position is authored; the owner line came from a
    // transformed React 19 owner stack. One shared tier would misreport one.
    expect(info.provenance).toMatchObject({
      method: "data-attribute",
      ownerMethod: "debug-stack",
    });
  });

  it("keeps a stack-derived position labelled transformed instead of laundering it through data-source-*", () => {
    // The bridge writes the projection's data-source-* from React 19's owner
    // stack. Without the tier attribute those coordinates would read back as a
    // build-time transform's authored ones.
    const info = elementInfoFromCodeLayerNode(
      makeNode({
        dataAttributes: {
          "data-source-file": "src/App.jsx",
          "data-source-line": "26",
          "data-source-column": "20",
          "data-source-method": "debug-stack",
        },
      }),
    );

    expect(info.provenance?.method).toBe("debug-stack");
  });

  it("preserves Vue and Svelte compiler provenance through the code-layer projection", () => {
    const vue = elementInfoFromCodeLayerNode(
      makeNode({
        dataAttributes: {
          "data-source-framework": "vue",
          "data-source-file": "src/App.vue",
          "data-source-line": "12",
          "data-source-column": "7",
          "data-source-method": "vue-inspector",
        },
      }),
    );
    const svelte = elementInfoFromCodeLayerNode(
      makeNode({
        dataAttributes: {
          "data-source-framework": "svelte",
          "data-source-file": "src/routes/+page.svelte",
          "data-source-line": "9",
          "data-source-column": "3",
          "data-source-method": "svelte-meta",
        },
      }),
    );

    expect(vue.provenance).toMatchObject({
      framework: "vue",
      method: "vue-inspector",
    });
    expect(svelte.provenance).toMatchObject({
      framework: "svelte",
      method: "svelte-meta",
    });
  });

  it("preserves explicit Angular and LWC provenance through clipboard projections", () => {
    for (const framework of ["angular", "lwc"] as const) {
      expect(
        elementInfoFromCodeLayerNode(
          makeNode({
            dataAttributes: {
              "data-source-framework": framework,
              "data-source-file": `src/${framework}/card.ts`,
              "data-source-line": "12",
              "data-source-column": "4",
            },
          }),
        ),
      ).toMatchObject({
        provenance: {
          framework,
          sourceFile: `src/${framework}/card.ts`,
          line: 12,
          column: 4,
          method: "data-attribute",
        },
      });
    }
  });

  it("carries WHY a node has no location, so absent stays distinct from not-loaded-yet", () => {
    const info = elementInfoFromCodeLayerNode(
      makeNode({ dataAttributes: { "data-source-unavailable": "not-react" } }),
    );

    expect(info.provenance).toEqual({ unavailableReason: "not-react" });
  });

  it("preserves the framework-neutral unavailable reason", () => {
    const info = elementInfoFromCodeLayerNode(
      makeNode({
        dataAttributes: { "data-source-unavailable": "not-framework" },
      }),
    );

    expect(info.provenance).toEqual({ unavailableReason: "not-framework" });
  });

  it("ignores an unavailable reason that contradicts a resolved location", () => {
    const info = elementInfoFromCodeLayerNode(
      makeNode({
        dataAttributes: {
          "data-source-file": "src/App.jsx",
          "data-source-line": "12",
          "data-source-unavailable": "no-debug-info",
        },
      }),
    );

    expect(info.provenance).toEqual({
      sourceFile: "src/App.jsx",
      line: 12,
      method: "data-attribute",
    });
  });
});

describe("whole text style roots from source projections", () => {
  it("marks a paragraph with only inline text children, not a composite row", () => {
    const projection = buildCodeLayerProjection(
      '<main><article><p id="note"><span>Shared note</span></p>' +
        '<div id="generic"><span>Generic note</span></div>' +
        '<ul><li id="row"><span>Done</span><input type="checkbox"></li></ul>' +
        "</article></main>",
      { source: { kind: "design-file", fileId: "text-root-fixture" } },
    );
    const paragraph = projection.nodes.find(
      (node) => node.attributes.id === "note",
    );
    const generic = projection.nodes.find(
      (node) => node.attributes.id === "generic",
    );
    const row = projection.nodes.find((node) => node.attributes.id === "row");

    expect(paragraph).toBeDefined();
    expect(paragraph?.paintsOwnText).toBe(false);
    expect(
      paragraph && elementInfoFromCodeLayerNode(paragraph).wholeTextStyleRoot,
    ).toBe(true);
    expect(generic).toBeDefined();
    expect(generic?.paintsOwnText).toBe(false);
    expect(
      generic && elementInfoFromCodeLayerNode(generic).wholeTextStyleRoot,
    ).toBe(false);
    expect(row).toBeDefined();
    expect(row?.paintsOwnText).toBe(false);
    expect(row && elementInfoFromCodeLayerNode(row).wholeTextStyleRoot).toBe(
      false,
    );
  });

  it("keeps marked multiline Text descendants in projection but renders one Layers row", () => {
    const projection = buildCodeLayerProjection(
      '<main><div id="text" data-an-primitive="text">' +
        '<div id="home">Home</div><div id="browse"><span>Browse</span></div>' +
        '</div><div id="ordinary"><div id="ordinary-child">Container child</div></div></main>',
      { source: { kind: "design-file", fileId: "multiline-text-leaf" } },
    );
    const textSourceNode = projection.nodes.find(
      (node) => node.attributes.id === "text",
    );
    const homeSourceNode = projection.nodes.find(
      (node) => node.attributes.id === "home",
    );
    const browseSourceNode = projection.nodes.find(
      (node) => node.attributes.id === "browse",
    );
    expect(textSourceNode?.children).toHaveLength(2);
    expect(homeSourceNode).toBeDefined();
    expect(browseSourceNode).toBeDefined();
    const tree = buildCodeLayerTree(projection);
    const findTreeNodeById = (
      nodes: ReturnType<typeof buildCodeLayerTree>,
      id: string,
    ): ReturnType<typeof buildCodeLayerTree>[number] | undefined => {
      for (const node of nodes) {
        if (node.id === id) return node;
        const child = findTreeNodeById(node.children, id);
        if (child) return child;
      }
      return undefined;
    };
    const treeText =
      textSourceNode && findTreeNodeById(tree, textSourceNode.id);
    const ordinarySourceNode = projection.nodes.find(
      (node) => node.attributes.id === "ordinary",
    );
    const treeOrdinary =
      ordinarySourceNode && findTreeNodeById(tree, ordinarySourceNode.id);
    expect(treeText?.children).toHaveLength(2);

    const panel = codeLayerTreeToPanelNodes(tree, new Set(), new Set());
    const findPanelNode = (
      nodes: ReturnType<typeof codeLayerTreeToPanelNodes>,
      id: string,
    ): (typeof panel)[number] | undefined => {
      for (const node of nodes) {
        if (node.id === id) return node;
        const child = findPanelNode(node.children ?? [], id);
        if (child) return child;
      }
      return undefined;
    };
    const panelText = treeText && findPanelNode(panel, treeText.id);
    const panelOrdinary = treeOrdinary && findPanelNode(panel, treeOrdinary.id);
    expect(panelText?.children).toEqual([]);
    expect(panelOrdinary?.children).toHaveLength(1);
    expect(treeText?.isNativeTextPrimitive).toBe(true);
    expect(treeOrdinary?.isNativeTextPrimitive).toBe(false);
    expect(
      textSourceNode &&
        elementInfoFromCodeLayerNode(textSourceNode).wholeTextStyleRoot,
    ).toBe(true);
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

describe("isClientRenderedMountShell", () => {
  // Observed: a Vite SPA screen projected to [html, body, div#root], so every
  // runtime selection resolved "absent" and the editor blamed the element.
  it("recognizes the served shell of a client-rendered app", () => {
    const projection = {
      nodes: [
        makeNode({ id: "html", tag: "html", children: ["body"] }),
        makeNode({ id: "body", tag: "body", children: ["root"] }),
        makeNode({
          id: "root",
          tag: "div",
          attributes: { id: "root" },
          children: [],
        }),
      ],
    };

    expect(isClientRenderedMountShell(projection)).toBe(true);
  });

  it("does not mistake a small authored page for a mount shell", () => {
    const projection = {
      nodes: [
        makeNode({ id: "html", tag: "html", children: ["body"] }),
        makeNode({ id: "body", tag: "body", children: ["h1"] }),
        makeNode({
          id: "h1",
          tag: "h1",
          textSnippet: "CartoonLand",
          children: [],
        }),
      ],
    };

    expect(isClientRenderedMountShell(projection)).toBe(false);
  });

  it("does not classify a real rendered document as a shell", () => {
    const projection = {
      nodes: Array.from({ length: 12 }, (_, index) =>
        makeNode({ id: `n${index}`, tag: "div" }),
      ),
    };

    expect(isClientRenderedMountShell(projection)).toBe(false);
  });
});

describe("resolveCodeLayerTargetFromBridge distinguishes absent from ambiguous", () => {
  // The point of the typed result: `null` cannot say whether the element is gone
  // or one of several identical instances, which need different remedies.
  function repeatedCards() {
    const shared = {
      selector: "div > p",
      selectors: ["div > p"],
      path: "div > p",
    };
    return [
      makeNode({ id: "card-a", ...shared }),
      makeNode({ id: "card-b", ...shared }),
      makeNode({ id: "card-c", ...shared }),
    ];
  }

  it("reports ambiguous with every candidate when a selector matches repeated instances", () => {
    const nodes = repeatedCards();

    const resolution = resolveCodeLayerTargetFromBridge({ nodes }, "div > p");

    expect(resolution.status).toBe("ambiguous");
    expect(
      resolution.status === "ambiguous" ? resolution.candidates : [],
    ).toHaveLength(3);
  });

  it("reports absent when nothing matches at all", () => {
    const projection = { nodes: [makeNode({ id: "unrelated" })] };

    expect(
      resolveCodeLayerTargetFromBridge(
        projection,
        "section > article",
        "missing",
      ).status,
    ).toBe("absent");
  });

  it("keeps the null wrapper behavior identical for both failure kinds", () => {
    const ambiguous = { nodes: repeatedCards() };
    const empty = { nodes: [makeNode({ id: "unrelated" })] };

    expect(resolveCodeLayerNodeFromBridge(ambiguous, "div > p")).toBeNull();
    expect(
      resolveCodeLayerNodeFromBridge(empty, "section > article"),
    ).toBeNull();
  });

  it("still resolves a unique sourceId match ahead of an ambiguous selector", () => {
    const nodes = repeatedCards();
    nodes[1]!.dataAttributes = { "data-agent-native-node-id": "card-b" };

    const resolution = resolveCodeLayerTargetFromBridge(
      { nodes },
      "div > p",
      "card-b",
    );

    expect(resolution).toEqual({ status: "resolved", node: nodes[1] });
  });

  it("uses a unique selector to disambiguate duplicated stable source ids", () => {
    const nodes = repeatedCards();
    nodes[0]!.dataAttributes = { "data-agent-native-node-id": "duplicate" };
    nodes[1]!.dataAttributes = { "data-agent-native-node-id": "duplicate" };
    nodes[0]!.path =
      'div[data-agent-native-node-id="duplicate"]:nth-of-type(1)';
    nodes[1]!.path =
      'div[data-agent-native-node-id="duplicate"]:nth-of-type(2)';

    const resolution = resolveCodeLayerTargetFromBridge(
      { nodes },
      nodes[1]!.path,
      "duplicate",
    );

    expect(resolution).toEqual({ status: "resolved", node: nodes[1] });
  });

  it("keeps duplicate stable ids ambiguous without a matching selector", () => {
    const nodes = repeatedCards();
    nodes[0]!.dataAttributes = { "data-agent-native-node-id": "duplicate" };
    nodes[1]!.dataAttributes = { "data-agent-native-node-id": "duplicate" };

    expect(
      resolveCodeLayerTargetFromBridge({ nodes }, undefined, "duplicate"),
    ).toEqual({ status: "ambiguous", candidates: nodes.slice(0, 2) });
  });
});

describe("resolveCodeLayerTargetFromElementInfo tie-breaking", () => {
  const shared = {
    tag: "p",
    selector: "div > p",
    selectors: ["div > p"],
    path: "div > p",
  };

  it("breaks an ambiguous selector when text evidence singles out one instance", () => {
    const nodes = [
      makeNode({ id: "card-a", ...shared, textSnippet: "Alpha" }),
      makeNode({ id: "card-b", ...shared, textSnippet: "Beta" }),
    ];

    const resolution = resolveCodeLayerTargetFromElementInfo(
      { nodes },
      makeElementInfo({
        tagName: "p",
        selector: "div > p",
        textContent: "Beta",
      }),
    );

    expect(resolution).toEqual({ status: "resolved", node: nodes[1] });
  });

  it("stays ambiguous when scoring cannot break the tie either", () => {
    const nodes = [
      makeNode({ id: "card-a", ...shared, textSnippet: "Same" }),
      makeNode({ id: "card-b", ...shared, textSnippet: "Same" }),
    ];

    const resolution = resolveCodeLayerTargetFromElementInfo(
      { nodes },
      makeElementInfo({
        tagName: "p",
        selector: "div > p",
        textContent: "Same",
      }),
    );

    expect(resolution.status).toBe("ambiguous");
    expect(
      resolution.status === "ambiguous" ? resolution.candidates : [],
    ).toHaveLength(2);
  });

  it("does not let text outside duplicate source-id candidates escape ambiguity", () => {
    const nodes = [
      makeNode({
        id: "candidate-a",
        tag: "p",
        dataAttributes: { "data-agent-native-node-id": "duplicate" },
        path: 'div[data-agent-native-node-id="duplicate"] > p:nth-of-type(1)',
        textSnippet: "Alpha",
      }),
      makeNode({
        id: "candidate-b",
        tag: "p",
        dataAttributes: { "data-agent-native-node-id": "duplicate" },
        path: 'div[data-agent-native-node-id="duplicate"] > p:nth-of-type(2)',
        textSnippet: "Beta",
      }),
      makeNode({
        id: "outside",
        tag: "p",
        path: "section > p",
        selector: "section > p",
        selectors: ["section > p"],
        textSnippet: "Gamma",
      }),
    ];

    const resolution = resolveCodeLayerTargetFromElementInfo(
      { nodes },
      makeElementInfo({
        tagName: "p",
        id: "duplicate",
        selector: "section > p",
        textContent: "Gamma",
      }),
    );

    expect(resolution).toEqual({
      status: "ambiguous",
      candidates: nodes.slice(0, 2),
    });
  });

  it("still uses text to disambiguate within duplicate source-id candidates", () => {
    const nodes = [
      makeNode({
        id: "candidate-a",
        tag: "p",
        dataAttributes: { "data-agent-native-node-id": "duplicate" },
        path: "div > p",
        textSnippet: "Alpha",
      }),
      makeNode({
        id: "candidate-b",
        tag: "p",
        dataAttributes: { "data-agent-native-node-id": "duplicate" },
        path: "div > p",
        textSnippet: "Beta",
      }),
    ];

    const resolution = resolveCodeLayerTargetFromElementInfo(
      { nodes },
      makeElementInfo({
        tagName: "p",
        id: "duplicate",
        selector: "div > p",
        textContent: "Beta",
      }),
    );

    expect(resolution).toEqual({ status: "resolved", node: nodes[1] });
  });

  it("keeps whole-projection text fallback when the supplied id is absent", () => {
    const nodes = [
      makeNode({
        id: "node-a",
        tag: "p",
        path: "main > p",
        textSnippet: "Fallback target",
      }),
    ];

    const resolution = resolveCodeLayerTargetFromElementInfo(
      { nodes },
      makeElementInfo({
        tagName: "p",
        id: "not-in-projection",
        selector: "missing > p",
        textContent: "Fallback target",
      }),
    );

    expect(resolution).toEqual({ status: "resolved", node: nodes[0] });
  });

  it("reports absent, not ambiguous, when the element is genuinely gone", () => {
    const resolution = resolveCodeLayerTargetFromElementInfo(
      { nodes: [makeNode({ id: "unrelated", tag: "section" })] },
      makeElementInfo({ tagName: "p", selector: "div > p" }),
    );

    expect(resolution).toEqual({ status: "absent" });
  });

  it("refuses an ElementInfo owned by another Screen with the same authored id", () => {
    const html = `<button data-agent-native-node-id="shared">Action</button>`;
    const screenA = buildCodeLayerProjection(html, {
      source: { kind: "design-file", fileId: "screen-a" },
    });
    const screenB = buildCodeLayerProjection(html, {
      source: { kind: "design-file", fileId: "screen-b" },
    });
    const nodeA = screenA.nodes[0]!;
    const infoA = elementInfoForOwnedCodeLayerNode({
      info: elementInfoFromCodeLayerNode(nodeA),
      node: nodeA,
      ownerFileId: "screen-a",
    });

    expect(screenA.nodes[0]!.id).not.toBe(screenB.nodes[0]!.id);
    expect(resolveCodeLayerTargetFromElementInfo(screenB, infoA)).toEqual({
      status: "absent",
    });
    expect(resolveCodeLayerNodeFromElementInfo(screenB, infoA)).toBeNull();

    const infoCanonicalizedAgainstB = canonicalizeElementInfoFromProjection(
      screenB,
      infoA,
      "screen-b",
    );
    expect(infoCanonicalizedAgainstB.sourceLayerIdentity).toEqual(
      infoA.sourceLayerIdentity,
    );
    expect(
      resolveCodeLayerNodeFromElementInfo(screenB, infoCanonicalizedAgainstB),
    ).toBeNull();

    expect(
      canonicalizeElementInfoFromProjection(screenA, infoA, "screen-a")
        .sourceLayerIdentity,
    ).toEqual(infoA.sourceLayerIdentity);
    expect(
      resolveCodeLayerNodeFromElementInfo({ nodes: screenB.nodes }, infoA),
    ).toBe(screenB.nodes[0]);
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

// BUG-UNDO-RESIZE-GEOMETRY regression coverage — live QA: undo after a canvas
// drag-RESIZE reverted the DOM correctly but the right panel's Layout W/H
// stayed stale (167x86 instead of the actually-reverted 116.8x36) until
// deselect/reselect. Root cause: refreshElementInfoFromContent's resync
// merged width/height additively (so a value absent from the reverted node
// never overwrote the pre-undo one) AND never refreshed boundingRect at all,
// which is what edit-panel/element-classification.ts's cssElementSize falls
// back to when computedStyles has no parseable width/height.
describe("refreshedComputedStyles geometry handling", () => {
  it("clears a stale width/height when the fresh source no longer authors one (fail-before case)", () => {
    // Before the fix: the additive merge below (`{...info.computedStyles,
    // ...sourceWithAliases}`) kept `width`/`height` from `info` whenever the
    // fresh (reverted) node didn't carry them — exactly what happened for an
    // undo that removed the drag-resize's inline width/height, reverting to
    // a class-driven size the string parse can't see.
    const staleInfo = makeElementInfo({
      computedStyles: { width: "167px", height: "86px", color: "red" },
    });
    const result = refreshedComputedStyles(
      staleInfo,
      { color: "red" }, // reverted node's inline style: no width/height
      ["some-class"], // sourceClasses.length > 0 selects the additive-merge branch
    );
    expect(result.width).toBeUndefined();
    expect(result.height).toBeUndefined();
    // Non-geometry properties still carry over/merge normally.
    expect(result.color).toBe("red");
  });

  it("takes the fresh width/height when the reverted source authors an explicit value", () => {
    const staleInfo = makeElementInfo({
      computedStyles: { width: "167px", height: "86px" },
    });
    const result = refreshedComputedStyles(
      staleInfo,
      { width: "116.8px", height: "36px" },
      ["some-class"],
    );
    expect(result.width).toBe("116.8px");
    expect(result.height).toBe("36px");
  });

  it("does not affect the no-classes (pure source) branch", () => {
    const staleInfo = makeElementInfo({
      computedStyles: { width: "167px", height: "86px" },
    });
    const result = refreshedComputedStyles(
      staleInfo,
      { width: "116.8px" },
      [], // sourceClasses.length === 0 selects the pure-source branch
    );
    expect(result.width).toBe("116.8px");
    expect(result.height).toBeUndefined();
  });
});

describe("refreshedBoundingRectSize", () => {
  it("recomputes width/height from the freshly-resolved computedStyles instead of staying pinned to the pre-undo rect (fail-before case)", () => {
    // Before the fix: refreshElementInfoFromContent's `{...info}` spread (via
    // canonicalElementInfoForCodeLayerNode, and again in its DOM-parse
    // fallback) left `boundingRect` completely untouched, so cssElementSize's
    // fallback-to-boundingRect path kept reporting the pre-undo drag-resize
    // rect forever — this is what the Layout panel's W/H fields showed when
    // computedStyles itself had no parseable width/height.
    const staleInfo = makeElementInfo({
      boundingRect: { x: 4, y: 8, width: 167, height: 86 },
    });
    const result = refreshedBoundingRectSize(staleInfo, {
      width: "116.8px",
      height: "36px",
    });
    expect(result).toEqual({ x: 4, y: 8, width: 116.8, height: 36 });
  });

  it("keeps the prior rect size when the fresh computedStyles has no parseable width/height", () => {
    const staleInfo = makeElementInfo({
      boundingRect: { x: 4, y: 8, width: 167, height: 86 },
    });
    const result = refreshedBoundingRectSize(staleInfo, {});
    expect(result).toEqual({ x: 4, y: 8, width: 167, height: 86 });
  });
});

describe("isCodeLayerNodeRuntimeOnly", () => {
  it("is never runtime-only for a file whose layers panel is showing its own source projection (fail-before case)", () => {
    // Before the fix, callers gated on the FILE-level model.runtimeOnly flag
    // directly, so a static/inline screen (fileIsRuntimeProjected: false)
    // never hit this function at all and was fine either way — this case
    // guards the base condition the narrower per-node check must preserve.
    expect(
      isCodeLayerNodeRuntimeOnly({
        fileIsRuntimeProjected: false,
        nodeIdAttr: undefined,
        sourceNodeIdAttrs: new Set(),
      }),
    ).toBe(false);
  });

  it("is NOT runtime-only for a localhost node whose stamped node id also appears in the source projection (fail-before case)", () => {
    // Before the fix: every node on a hydrated localhost screen was flagged
    // runtimeOnly=true purely because the FILE used the runtime projection —
    // even a node with a perfectly resolvable source match, and even on a
    // plain static-HTML target with no React at all. That made
    // handleToggleLayerLocked/Hidden always route through the
    // React-semantic-handoff path and show "still loading" forever.
    expect(
      isCodeLayerNodeRuntimeOnly({
        fileIsRuntimeProjected: true,
        nodeIdAttr: "an-e0jybg",
        sourceNodeIdAttrs: new Set(["an-e0jybg", "an-abc123"]),
      }),
    ).toBe(false);
  });

  it("is runtime-only when the node's stamped id has no match in the source projection", () => {
    expect(
      isCodeLayerNodeRuntimeOnly({
        fileIsRuntimeProjected: true,
        nodeIdAttr: "an-e0jybg",
        sourceNodeIdAttrs: new Set(["an-abc123"]),
      }),
    ).toBe(true);
  });

  it("keeps editor-minted runtime ids out of authored source identity", () => {
    expect(
      isCodeLayerNodeRuntimeOnly({
        fileIsRuntimeProjected: false,
        nodeIdAttr: "runtime-1m2vou",
        sourceNodeIdAttrs: new Set(["an-authored"]),
      }),
    ).toBe(true);

    const sourceNodeIdAttrs = codeLayerSourceNodeIdAttrs(
      '<main data-agent-native-node-id="an-authored"></main>',
    );
    expect(sourceNodeIdAttrs.has("runtime-1m2vou")).toBe(false);
    expect(
      isCodeLayerNodeRuntimeOnly({
        fileIsRuntimeProjected: false,
        nodeIdAttr: "runtime-1m2vou",
        sourceNodeIdAttrs,
      }),
    ).toBe(true);

    expect(
      isCodeLayerNodeRuntimeOnly({
        fileIsRuntimeProjected: false,
        nodeIdAttr: "runtime-1m2vou",
        sourceNodeIdAttrs: codeLayerSourceNodeIdAttrs(
          '<main data-agent-native-node-id="runtime-1m2vou"></main>',
        ),
      }),
    ).toBe(false);
  });

  it("is runtime-only when the node has no stamped id at all", () => {
    expect(
      isCodeLayerNodeRuntimeOnly({
        fileIsRuntimeProjected: true,
        nodeIdAttr: undefined,
        sourceNodeIdAttrs: new Set(["an-abc123"]),
      }),
    ).toBe(true);
  });
});

describe("runtimeLayerStateHandoffMode", () => {
  it("is preview-only for a runtime node with no React source provenance (fail-before case)", () => {
    // Before the fix this case was indistinguishable from an unresolvable
    // anchor: hide/lock bailed with "React source anchors still loading" and
    // never set hiddenLayerIds/lockedLayerIds, so DesignCanvas's layer-states
    // message stayed empty and nothing hid in the live iframe. A plain-HTML
    // localhost target never produces provenance, so that load never comes.
    expect(
      runtimeLayerStateHandoffMode({
        runtimeOnly: true,
        provenanceSourceFile: undefined,
      }),
    ).toBe("preview-only");
    expect(
      runtimeLayerStateHandoffMode({
        runtimeOnly: true,
        provenanceSourceFile: "   ",
      }),
    ).toBe("preview-only");
  });

  it("hands off when a runtime node carries a React source file to make the state durable in", () => {
    expect(
      runtimeLayerStateHandoffMode({
        runtimeOnly: true,
        provenanceSourceFile: "/repo/app/routes/home.tsx",
      }),
    ).toBe("handoff");
  });

  it("is preview-only for a node that is not runtime-only", () => {
    expect(
      runtimeLayerStateHandoffMode({
        runtimeOnly: false,
        provenanceSourceFile: "/repo/app/routes/home.tsx",
      }),
    ).toBe("preview-only");
  });
});

describe("canonicalElementInfoForCodeLayerNode runtime identity", () => {
  const sourceNode = makeNode({
    id: "html:source",
    selectors: ['[data-agent-native-node-id="an-abc"]'],
    selector: '[data-agent-native-node-id="an-abc"]',
    dataAttributes: { "data-agent-native-node-id": "an-abc" },
  });

  it("keeps the bridge's live-document selector after canonicalizing onto the source projection", () => {
    const canonical = canonicalElementInfoForCodeLayerNode(
      makeElementInfo({
        selector: '[data-agent-native-node-id="runtime-xyz"]',
        sourceId: "runtime-xyz",
      }),
      sourceNode,
    );

    expect(canonical.selector).toBe('[data-agent-native-node-id="an-abc"]');
    expect(canonical.sourceId).toBe("an-abc");
    expect(canonical.runtimeSelector).toBe(
      '[data-agent-native-node-id="runtime-xyz"]',
    );
    expect(canonical.runtimeSourceId).toBe("runtime-xyz");
  });

  it("does not let a second canonicalization overwrite the live identity", () => {
    const once = canonicalElementInfoForCodeLayerNode(
      makeElementInfo({
        selector: '[data-agent-native-node-id="runtime-xyz"]',
        sourceId: "runtime-xyz",
      }),
      sourceNode,
    );
    const twice = canonicalElementInfoForCodeLayerNode(once, sourceNode);

    expect(twice.runtimeSelector).toBe(
      '[data-agent-native-node-id="runtime-xyz"]',
    );
    expect(twice.runtimeSourceId).toBe("runtime-xyz");
  });

  it("refreshes Group identity from the source node while keeping runtime identity", () => {
    const groupNode = makeNode({
      dataAttributes: { "data-agent-native-group": "true" },
    });
    const canonical = canonicalElementInfoForCodeLayerNode(
      makeElementInfo({
        isGroup: false,
        selector: '[data-agent-native-node-id="runtime-xyz"]',
        sourceId: "runtime-xyz",
      }),
      groupNode,
    );

    expect(canonical.isGroup).toBe(true);
    expect(canonical.runtimeSelector).toBe(
      '[data-agent-native-node-id="runtime-xyz"]',
    );
    expect(canonical.runtimeSourceId).toBe("runtime-xyz");
  });

  it("clears stale Group identity when the current source node is a Frame", () => {
    const canonical = canonicalElementInfoForCodeLayerNode(
      makeElementInfo({ isGroup: true }),
      makeNode({ dataAttributes: { "data-an-primitive": "frame" } }),
    );

    expect(canonical.isGroup).toBe(false);
  });

  it("refreshes a missing primitive kind from the source projection", () => {
    const canonical = canonicalElementInfoForCodeLayerNode(
      makeElementInfo({ tagName: "svg" }),
      makeNode({ tag: "svg", dataAttributes: { "data-an-primitive": "line" } }),
    );

    expect(canonical.primitiveKind).toBe("line");
  });
});

// ── grid-template source overlay (bug fix) ──────────────────────────────
// The live bridge's inline-style read normalizes a bare zero-length grid
// track with its implied unit ("minmax(0, 1fr)" -> "minmax(0px, 1fr)"),
// while a passive multi-selection member (elementInfoFromCodeLayerNode)
// reads the same declaration straight off the raw source — same authored
// template, two byte-different strings, which made
// mixedElementFromSelection's exact-string compare report a false Mixed.

describe("canonicalElementInfoForCodeLayerNode grid-template source overlay", () => {
  const gridNode = makeNode({
    id: "html:grid-a",
    selectors: ['[data-agent-native-node-id="grid-a"]'],
    selector: '[data-agent-native-node-id="grid-a"]',
    dataAttributes: { "data-agent-native-node-id": "grid-a" },
    // Hyphen-cased and lowercased, matching how parseStyle/cssPropertyKey
    // actually store a real buildCodeLayerProjection node's raw
    // declarations — a camelCase fixture here would not exercise
    // sourceAuthoredGridTemplateOverlay's pre-check at all.
    style: { "grid-template-columns": "repeat(2, minmax(0, 1fr))" },
  });

  it("overlays the source-authored gridTemplateColumns onto the live CSSOM-read value, leaving computed/geometry untouched", () => {
    const liveInfo = makeElementInfo({
      inlineStyles: { gridTemplateColumns: "repeat(2, minmax(0px, 1fr))" },
      computedStyles: { display: "grid", gridTemplateColumns: "100px 100px" },
      boundingRect: { x: 10, y: 20, width: 200, height: 80 },
    });

    const canonical = canonicalElementInfoForCodeLayerNode(liveInfo, gridNode);

    expect(canonical.inlineStyles?.gridTemplateColumns).toBe(
      "repeat(2, minmax(0, 1fr))",
    );
    expect(canonical.computedStyles).toEqual(liveInfo.computedStyles);
    expect(canonical.boundingRect).toEqual(liveInfo.boundingRect);
  });

  it("leaves an undefined inlineStyles snapshot undefined when the source has no grid-template keys", () => {
    const nonGridNode = makeNode({
      id: "html:plain",
      selectors: ['[data-agent-native-node-id="plain-a"]'],
      selector: '[data-agent-native-node-id="plain-a"]',
      dataAttributes: { "data-agent-native-node-id": "plain-a" },
      style: { color: "red" },
    });
    const liveInfo = makeElementInfo({ inlineStyles: undefined });

    const canonical = canonicalElementInfoForCodeLayerNode(
      liveInfo,
      nonGridNode,
    );

    // "No inline snapshot" must stay that way, not become a new `{}` —
    // authoredStyleValue and friends read the two as different states.
    expect(canonical.inlineStyles).toBeUndefined();
  });

  it("returns an existing inlineStyles object unchanged (same reference) when the source has no grid-template keys", () => {
    const nonGridNode = makeNode({
      id: "html:plain",
      selectors: ['[data-agent-native-node-id="plain-a"]'],
      selector: '[data-agent-native-node-id="plain-a"]',
      dataAttributes: { "data-agent-native-node-id": "plain-a" },
      style: { color: "red" },
    });
    const existingInlineStyles = { left: "10px" };
    const liveInfo = makeElementInfo({ inlineStyles: existingInlineStyles });

    const canonical = canonicalElementInfoForCodeLayerNode(
      liveInfo,
      nonGridNode,
    );

    expect(canonical.inlineStyles).toBe(existingInlineStyles);
  });

  it("merges a canonicalized primary with a passive member's source-parsed info without reporting Mixed", () => {
    const liveInfo = makeElementInfo({
      isGridContainer: true,
      inlineStyles: { gridTemplateColumns: "repeat(2, minmax(0px, 1fr))" },
      computedStyles: {
        display: "grid",
        gridTemplateColumns: "100px 100px",
        width: "200px",
        height: "80px",
      },
    });
    const canonical = canonicalElementInfoForCodeLayerNode(liveInfo, gridNode);
    const passiveMember = elementInfoFromCodeLayerNode(gridNode);

    const merged = mixedElementFromSelection([canonical, passiveMember]);
    expect(merged?.inlineStyles?.gridTemplateColumns).not.toBe(MIXED_VALUE);
    expect(merged?.inlineStyles?.gridTemplateColumns).toBe(
      "repeat(2, minmax(0, 1fr))",
    );

    const grid = gridValueForElement(merged!);
    expect(grid.columns).toBe(2);
    expect(grid.columnSizing).toBe("fill");
  });

  it("still merges to Mixed when the source-authored templates genuinely differ", () => {
    const differentGridNode = makeNode({
      id: "html:grid-b",
      selectors: ['[data-agent-native-node-id="grid-b"]'],
      selector: '[data-agent-native-node-id="grid-b"]',
      dataAttributes: { "data-agent-native-node-id": "grid-b" },
      style: { "grid-template-columns": "repeat(3, 80px)" },
    });
    const liveInfo = makeElementInfo({
      inlineStyles: { gridTemplateColumns: "repeat(2, minmax(0px, 1fr))" },
    });
    const canonical = canonicalElementInfoForCodeLayerNode(liveInfo, gridNode);
    const passiveMember = elementInfoFromCodeLayerNode(differentGridNode);

    const merged = mixedElementFromSelection([canonical, passiveMember]);
    expect(merged?.inlineStyles?.gridTemplateColumns).toBe(MIXED_VALUE);
  });
});

describe("pending Layers selection runtime info", () => {
  const runtimeInfo = makeElementInfo({
    tagName: "button",
    sourceId: "button-a",
    selector: '[data-agent-native-node-id="button-a"]',
    computedStyles: { backgroundColor: "rgb(15, 118, 110)" },
    portableStyleSnapshot: {
      version: 1,
      rootSourceId: "button-a",
      nodes: [
        {
          sourceId: "button-a",
          path: [],
          styles: { backgroundColor: "rgb(15, 118, 110)" },
        },
      ],
    },
  });

  it("keeps rich paint when the pending owner is the selected layer's Screen", () => {
    const node = makeNode({
      id: "screen-a:button-a",
      tag: "button",
      selector: '[data-agent-native-node-id="button-a"]',
      selectors: ['[data-agent-native-node-id="button-a"]'],
      path: '[data-agent-native-node-id="button-a"]',
      dataAttributes: { "data-agent-native-node-id": "button-a" },
      style: { backgroundColor: "teal" },
    });
    const selectedInfo = {
      ...runtimeInfo,
      sourceLayerIdentity: { screenId: "screen-a", nodeId: node.id },
    };

    const info = elementInfoForOwnedCodeLayerNode({
      info: selectedInfo,
      node,
      ownerFileId: "screen-a",
    });

    expect(info.computedStyles.backgroundColor).toBe("rgb(15, 118, 110)");
    expect(info.portableStyleSnapshot).toEqual(
      runtimeInfo.portableStyleSnapshot,
    );
    expect(info.sourceLayerIdentity).toEqual({
      screenId: "screen-a",
      nodeId: node.id,
    });
  });

  it("preserves an explicit snapshot failure for the exact owned layer", () => {
    const node = makeNode({
      id: "screen-a:button-a",
      tag: "button",
      selector: '[data-agent-native-node-id="button-a"]',
      selectors: ['[data-agent-native-node-id="button-a"]'],
      path: '[data-agent-native-node-id="button-a"]',
      dataAttributes: { "data-agent-native-node-id": "button-a" },
    });
    const failedInfo = {
      ...runtimeInfo,
      portableStyleSnapshot: undefined,
      styleSnapshotCaptureFailed: true,
      sourceLayerIdentity: { screenId: "screen-a", nodeId: node.id },
    };

    const info = elementInfoForOwnedCodeLayerNode({
      info: failedInfo,
      node,
      ownerFileId: "screen-a",
    });

    expect(info.portableStyleSnapshot).toBeUndefined();
    expect(info.styleSnapshotCaptureFailed).toBe(true);
    expect(info.sourceLayerIdentity).toEqual({
      screenId: "screen-a",
      nodeId: node.id,
    });
  });

  it("does not reuse Screen A info after restoring Screen B layer ids with a duplicate authored id", () => {
    const node = makeNode({
      id: "screen-b:button-a",
      tag: "button",
      selector: '[data-agent-native-node-id="button-a"]',
      selectors: ['[data-agent-native-node-id="button-a"]'],
      path: '[data-agent-native-node-id="button-a"]',
      dataAttributes: { "data-agent-native-node-id": "button-a" },
      style: { backgroundColor: "teal" },
    });
    const staleInfo = {
      ...runtimeInfo,
      sourceLayerIdentity: {
        screenId: "screen-a",
        nodeId: "screen-a:button-a",
      },
    };

    const info = elementInfoForOwnedCodeLayerNode({
      info: staleInfo,
      node,
      ownerFileId: "screen-b",
    });

    expect(info.computedStyles.backgroundColor).toBe("teal");
    expect(info.portableStyleSnapshot).toBeUndefined();
  });

  it("does not confuse duplicate authored IDs between two projected nodes on one Screen", () => {
    const projection = buildCodeLayerProjection(
      '<main><button data-agent-native-node-id="button-a" class="first">First</button><button data-agent-native-node-id="button-a" class="primary">Second</button></main>',
      { source: { kind: "design-file", fileId: "screen-a" } },
    );
    const [firstNode, secondNode] = projection.nodes.filter(
      (node) => node.tag === "button",
    );
    expect(firstNode).toBeDefined();
    expect(secondNode).toBeDefined();
    expect(firstNode!.id).not.toBe(secondNode!.id);

    const selectedInfo = canonicalizeElementInfoFromProjection(
      projection,
      {
        ...runtimeInfo,
        tagName: "button",
        sourceId: "button-a",
        selector: secondNode!.path,
        textContent: "Second",
        classes: ["primary"],
      },
      "screen-a",
    );

    expect(selectedInfo.sourceLayerIdentity).toEqual({
      screenId: "screen-a",
      nodeId: secondNode!.id,
    });

    const info = elementInfoForOwnedCodeLayerNode({
      info: selectedInfo,
      node: secondNode!,
      ownerFileId: "screen-a",
    });

    expect(info.computedStyles.backgroundColor).toBe("rgb(15, 118, 110)");
    expect(info.portableStyleSnapshot).toEqual(
      runtimeInfo.portableStyleSnapshot,
    );

    const unrelatedInfo = elementInfoForOwnedCodeLayerNode({
      info: selectedInfo,
      node: firstNode!,
      ownerFileId: "screen-a",
    });
    expect(unrelatedInfo.computedStyles.backgroundColor).toBeUndefined();
    expect(unrelatedInfo.portableStyleSnapshot).toBeUndefined();
  });

  it("does not treat unproven runtime info as belonging to the pending owner", () => {
    const node = makeNode({
      id: "screen-a:button-a",
      tag: "button",
      dataAttributes: { "data-agent-native-node-id": "button-a" },
      style: { backgroundColor: "teal" },
    });

    const info = elementInfoForOwnedCodeLayerNode({
      info: runtimeInfo,
      node,
      ownerFileId: "screen-a",
    });

    expect(info.computedStyles.backgroundColor).toBe("teal");
    expect(info.portableStyleSnapshot).toBeUndefined();
    expect(info.sourceLayerIdentity).toEqual({
      screenId: "screen-a",
      nodeId: node.id,
    });
  });
});

describe("liveDeleteSelectorGroups", () => {
  it("keeps the bridge-reported identity as a candidate beside the source selector", () => {
    expect(
      liveDeleteSelectorGroups({
        runtimeAliasGroups: [],
        liveSelectionSelectors: ['[data-agent-native-node-id="runtime-xyz"]'],
        fallbackSelectors: ['[data-agent-native-node-id="an-abc"]'],
      }),
    ).toEqual([
      [
        '[data-agent-native-node-id="an-abc"]',
        '[data-agent-native-node-id="runtime-xyz"]',
      ],
    ]);
  });

  it("prefers the runtime layer model's aliases, one group per node", () => {
    expect(
      liveDeleteSelectorGroups({
        runtimeAliasGroups: [["#a"], ["#b"], []],
        liveSelectionSelectors: ["#selected"],
        fallbackSelectors: ["#fallback"],
      }),
    ).toEqual([["#a"], ["#b"]]);
  });

  it("still targets the live selection when there is no source selector at all", () => {
    expect(
      liveDeleteSelectorGroups({
        runtimeAliasGroups: [],
        liveSelectionSelectors: ['[data-agent-native-node-id="runtime-xyz"]'],
        fallbackSelectors: [],
      }),
    ).toEqual([['[data-agent-native-node-id="runtime-xyz"]']]);
  });

  it("has nothing to delete when no identity is known", () => {
    expect(
      liveDeleteSelectorGroups({
        runtimeAliasGroups: [],
        liveSelectionSelectors: [],
        fallbackSelectors: [],
      }),
    ).toEqual([]);
  });
});

describe("layerTypeForCodeLayer", () => {
  it("keeps a frame a frame in the Layers panel", () => {
    expect(
      layerTypeForCodeLayer({
        id: "n1",
        name: "Btn Primary",
        type: "frame",
        tag: "button",
        selector: "button",
        detail: "<button>",
        renamable: true,
        children: [],
      }),
    ).toBe("frame");
  });
});

describe("codeLayerNodeLooksLikeComponent", () => {
  const node = (classes: string[], tag = "div"): CodeLayerNode =>
    ({
      id: "n1",
      tag,
      layerName: "Frame",
      layerNameSource: "tag",
      selector: tag,
      selectors: [tag],
      path: tag,
      attributes: {},
      dataAttributes: {},
      classes,
      textSnippet: null,
      style: {},
      styleTokens: [],
      children: [],
      layout: {
        siblingIndex: 0,
        nthOfType: 0,
        isFlexContainer: false,
        isGridContainer: false,
      },
      capabilities: [],
      confidence: 1,
      source: null,
    }) as unknown as CodeLayerNode;

  it("does not treat a colour utility as a component", () => {
    expect(codeLayerNodeLooksLikeComponent(node(["p-6", "bg-card"]))).toBe(
      false,
    );
  });

  // The canvas copy of a class rule carried no utility guard, so the same
  // element read violet there and blue here.
  it("does not infer a component from any class name", () => {
    expect(codeLayerNodeLooksLikeComponent(node(["pricing-card"]))).toBe(false);
    expect(codeLayerNodeLooksLikeComponent(node(["btn-primary"]))).toBe(false);
    expect(
      codeLayerNodeLooksLikeComponent(node(["product-card-wrapper"])),
    ).toBe(false);
  });

  it("still treats a form control tag as a component", () => {
    expect(codeLayerNodeLooksLikeComponent(node([], "input"))).toBe(true);
  });
});
