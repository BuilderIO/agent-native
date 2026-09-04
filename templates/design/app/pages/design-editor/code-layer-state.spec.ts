import type { CodeLayerNode } from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import {
  canonicalElementInfoForCodeLayerNode,
  codeLayerNodeMatchesBridgeTarget,
  resolveCodeLayerTargetFromBridge,
  resolveCodeLayerTargetFromElementInfo,
  elementInfoFromCodeLayerNode,
  isClientRenderedMountShell,
  isCodeLayerNodeRuntimeOnly,
  liveDeleteSelectorGroups,
  refreshedBoundingRectSize,
  refreshedComputedStyles,
  resolveCodeLayerNodeFromBridge,
  runtimeLayerStateHandoffMode,
} from "./code-layer-state";

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

  it("reports absent, not ambiguous, when the element is genuinely gone", () => {
    const resolution = resolveCodeLayerTargetFromElementInfo(
      { nodes: [makeNode({ id: "unrelated", tag: "section" })] },
      makeElementInfo({ tagName: "p", selector: "div > p" }),
    );

    expect(resolution).toEqual({ status: "absent" });
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
