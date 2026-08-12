import { describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import {
  applyVisualEdit,
  buildCodeLayerProjection,
} from "../../../shared/code-layer";
import { resolveElementNudgeIntent } from "./nudge-intent";

/**
 * Normal block flow.
 *
 * The reported bug: on a fusion screen whose parent is a plain BLOCK container,
 * arrow keys wrote px offsets instead of reordering. `describeFlowContainer`
 * infers layout only from the parent's inline styles and Tailwind utilities, so
 * a stylesheet-driven (or simply default) block parent read as `kind: "none"`
 * and `resolveNudgeIntent` took its first branch straight to translate.
 *
 * That is the exact operation this module's own doc comment warns against:
 * under `position: static`, writing left/top does nothing at all. The browser's
 * rendered `display`, forwarded by the canvas bridge as `parentDisplay`, is the
 * only source that knows the real layout.
 */

function elementInfoFor(
  nodeId: string,
  tagName = "div",
  parentDisplay?: string,
  style?: Record<string, string>,
): ElementInfo {
  return {
    tagName,
    sourceId: nodeId,
    selector: `[data-agent-native-node-id="${nodeId}"]`,
    classes: [],
    computedStyles: style ?? {},
    parentDisplay,
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
  } as unknown as ElementInfo;
}

/** Resolve, apply, and report resulting DOM order: the visible outcome. */
function orderAfterNudge(
  content: string,
  nodeId: string,
  direction: "up" | "right" | "down" | "left",
  parentDisplay?: string,
  style?: Record<string, string>,
): string[] | { kind: string } {
  const intent = resolveElementNudgeIntent({
    content,
    selectedElement: elementInfoFor(nodeId, "div", parentDisplay, style),
    direction,
    largeStep: false,
  });
  if (intent.kind !== "reorder") return { kind: intent.kind };
  const patch = applyVisualEdit(intent.content, {
    kind: "moveNode",
    target: { nodeId: intent.targetNodeId },
    anchor: { nodeId: intent.anchorNodeId },
    placement: intent.placement,
  });
  expect(patch.result.status).toBe("applied");
  const projection = buildCodeLayerProjection(patch.content);
  const parent = projection.nodes.find((node) => node.tag === "section");
  const byId = new Map(projection.nodes.map((node) => [node.id, node]));
  return (parent?.children ?? []).map(
    (childId) =>
      byId.get(childId)?.dataAttributes["data-agent-native-node-id"] ?? "?",
  );
}

const STACK = [
  "<!doctype html><html><body>",
  '<section data-agent-native-node-id="stack">',
  '<div data-agent-native-node-id="alpha">Alpha</div>',
  '<div data-agent-native-node-id="beta">Beta</div>',
  '<div data-agent-native-node-id="gamma">Gamma</div>',
  "</section>",
  "</body></html>",
].join("");

describe("resolveElementNudgeIntent in normal block flow", () => {
  it("reorders down the block axis when the browser reports display:block", () => {
    expect(orderAfterNudge(STACK, "alpha", "down", "block")).toEqual([
      "beta",
      "alpha",
      "gamma",
    ]);
  });

  it("reorders up the block axis", () => {
    expect(orderAfterNudge(STACK, "gamma", "up", "block")).toEqual([
      "alpha",
      "gamma",
      "beta",
    ]);
  });

  it("swallows the cross axis, matching flex-column behavior", () => {
    // Left/right carries no DOM-order meaning in a vertical stack, and the
    // container does not wrap, so there is no sensible reorder. Consistent
    // with a flex column, which returns `none` for the same reason rather than
    // writing an offset onto a flow child.
    expect(orderAfterNudge(STACK, "beta", "right", "block")).toEqual({
      kind: "none",
    });
  });

  it("does not reorder past the end of the stack", () => {
    expect(orderAfterNudge(STACK, "gamma", "down", "block")).toEqual({
      kind: "none",
    });
  });

  it("treats a list-item parent as block flow", () => {
    expect(orderAfterNudge(STACK, "alpha", "down", "list-item")).toEqual([
      "beta",
      "alpha",
      "gamma",
    ]);
  });

  it("still translates an absolutely-positioned child of a block parent", () => {
    expect(
      orderAfterNudge(STACK, "alpha", "down", "block", {
        position: "absolute",
      }),
    ).toEqual({ kind: "translate" });
  });

  it("leaves an inline parent translating: DOM order is not visual order", () => {
    expect(orderAfterNudge(STACK, "alpha", "down", "inline")).toEqual({
      kind: "translate",
    });
  });

  it("treats an unknown parent display as block flow", () => {
    // A layers-tree selection reaches the nudge handler before the bridge
    // round-trip fills parentDisplay, so `undefined` is the common case, not an
    // edge case. Block is the CSS initial value, and it is what the browser is
    // actually doing — assuming otherwise is what made the tree-selected nudge
    // write a dead offset.
    expect(orderAfterNudge(STACK, "alpha", "down")).toEqual([
      "beta",
      "alpha",
      "gamma",
    ]);
  });
});
