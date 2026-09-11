import { describe, expect, it } from "vitest";

import {
  applyVisualEdit,
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "../../shared/code-layer";
import { getElementOuterHtml } from "./design-editor/clone-and-pen-edit";
import { findCodeLayerSiblingOrder } from "./design-editor/code-layer-state";
import { isStandaloneHttpUrl } from "./design-editor/editor-state";

/**
 * URL-as-content audit.
 *
 * A running-app screen (fusion / localhost) stores its ROUTE URL in
 * `design_files.content`. Every editor handler that reads stored content and
 * writes it back is therefore a candidate for corrupting that URL.
 *
 * The dangerous shape is a write keyed by SOURCE OFFSETS (as
 * `setCodeLayerAttributeInHtml` is): those splice into the string wherever the
 * node claimed to be, which for a URL lands mid-path. The safe shapes either
 * find nothing in the URL and bail, or refuse outright via `isStandaloneHttpUrl`.
 *
 * These pin the primitives the surviving unguarded handlers rely on, so a
 * change that makes one of them "helpfully" succeed on a URL fails here rather
 * than silently destroying a screen's iframe src in production.
 */
const ROUTE_URL = "https://design.example.com/builder-preview/d1/about";

describe("URL content is recognised as a URL, not markup", () => {
  it("isStandaloneHttpUrl accepts the persisted route URL", () => {
    expect(isStandaloneHttpUrl(ROUTE_URL)).toBe(true);
    expect(isStandaloneHttpUrl(`  ${ROUTE_URL}  `)).toBe(true);
  });

  it("does not mistake real markup for a URL", () => {
    expect(isStandaloneHttpUrl("<main><h1>Hi</h1></main>")).toBe(false);
    expect(isStandaloneHttpUrl('<a href="https://example.com">link</a>')).toBe(
      false,
    );
  });
});

describe("projection primitives find nothing in a route URL", () => {
  const projection = buildCodeLayerProjection(ROUTE_URL);

  it("yields no nodes, so selection intersections come back empty", () => {
    // This is what protects handleAlignSelection, handleDistributeSelection,
    // handleTidyUp, handleSuggestAutoLayout, handleAddAutoLayout and
    // handleFrameSelection: they intersect the current selection against a
    // projection of the content and return early when nothing matches.
    expect(projection.nodes).toHaveLength(0);
    expect(projection.rootNodeIds).toHaveLength(0);
  });

  it("yields an empty layer tree, so sibling-order lookups fail closed", () => {
    // changeSelectedZIndex resolves sibling order before reordering; with no
    // tree it falls back to a plain z-index style commit.
    const tree = buildCodeLayerTree(projection);
    expect(tree).toHaveLength(0);
    expect(findCodeLayerSiblingOrder(tree, "any-node-id")).toBeFalsy();
  });

  it("has no element to duplicate", () => {
    // handleDuplicateSelection bails on a falsy outer-HTML lookup.
    expect(
      getElementOuterHtml(ROUTE_URL, '[data-agent-native-node-id="hero"]'),
    ).toBeFalsy();
  });
});

describe("structural edits cannot apply against a route URL", () => {
  it("refuses a wrapNodes edit rather than rewriting the URL", () => {
    // handleFrameSelection's write path. `targetIds` cannot resolve, so the
    // patch must not report success, and must never emit mutated content.
    const patch = applyVisualEdit(ROUTE_URL, {
      kind: "wrapNodes",
      targetIds: ["hero"],
      autoLayout: false,
    });
    expect(patch.result.status).not.toBe("applied");
    expect(patch.content).toBe(ROUTE_URL);
  });

  it("CONTROL: the same edit DOES apply to real markup", () => {
    const html =
      '<main><div data-agent-native-node-id="hero">A</div>' +
      '<div data-agent-native-node-id="other">B</div></main>';
    const patch = applyVisualEdit(html, {
      kind: "moveNode",
      target: { nodeId: "hero" },
      anchor: { nodeId: "other" },
      placement: "after",
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).not.toBe(html);
  });

  it("refuses a moveNode edit rather than rewriting the URL", () => {
    const patch = applyVisualEdit(ROUTE_URL, {
      kind: "moveNode",
      target: { nodeId: "hero" },
      anchor: { nodeId: "other" },
      placement: "after",
    });
    expect(patch.result.status).not.toBe("applied");
    expect(patch.content).toBe(ROUTE_URL);
  });
});
