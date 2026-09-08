/**
 * Clip A 19:55 → 19:59 (XpIts390YLYS): a bare `Ctrl+[` on an in-flow
 * rectangle moved it from Y 225 to Y 128 with its width, height and corner
 * radius unchanged. Every mode built a `moveNode` markup splice, so a
 * paint-order command relaid out the document.
 */

import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { runChangeSelectedZIndex } from "./change-selected-z-index";

const CONTENT = `<html><body><div data-agent-native-node-id="wrap">
<div data-agent-native-node-id="a" style="position:absolute;left:0;top:0"></div>
<div data-agent-native-node-id="b" style="position:absolute;left:0;top:40px"></div>
</div></body></html>`;

/** Selection state carries projection ids, not authored node attributes. */
function projectionId(authoredId: string, content = CONTENT): string {
  const node = buildCodeLayerProjection(content).nodes.find(
    (candidate) =>
      candidate.dataAttributes["data-agent-native-node-id"] === authoredId,
  );
  if (!node) throw new Error(`no projection node for ${authoredId}`);
  return node.id;
}

function harness(
  element: Partial<ElementInfo>,
  authoredId = "b",
  content = CONTENT,
) {
  const targetId = projectionId(authoredId, content);
  const applyLocalContentUpdate = vi.fn();
  const commitVisualStyles = vi.fn();
  const selectedElement = {
    selector: `[data-agent-native-node-id="${targetId}"]`,
    tagName: "div",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 10, height: 10 },
    isFlexChild: false,
    isFlexContainer: false,
    ...element,
  } as ElementInfo;
  const args = {
    activeFile: { id: "file-1" },
    applyLocalContentUpdate,
    canEditDesign: true,
    codeLayerOwnerByNodeIdRef: {
      current: new Map([[targetId, { fileId: "file-1" }]]),
    },
    commitVisualStyles,
    getFreshActiveContent: () => content,
    selectedElement,
    selectedLayerIdsState: [targetId],
    setSelectedElement: vi.fn(),
  } as unknown as Parameters<typeof runChangeSelectedZIndex>[0];
  /** The write aimed at the selection, ignoring any parent-scoped write. */
  const targetStyles = () =>
    commitVisualStyles.mock.calls.find(
      ([sel]) => sel === selectedElement.selector,
    )?.[1] as Record<string, string> | undefined;
  return { args, applyLocalContentUpdate, commitVisualStyles, targetStyles };
}

describe("runChangeSelectedZIndex — a paint-order change must not move anything", () => {
  it.each(["forward", "backward", "front", "back"] as const)(
    "writes z-index instead of splicing markup for an in-flow element (%s)",
    (mode) => {
      const { args, applyLocalContentUpdate, targetStyles } = harness({
        computedStyles: { position: "static", zIndex: "auto" },
      });
      runChangeSelectedZIndex(args, mode);
      expect(applyLocalContentUpdate).not.toHaveBeenCalled();
      expect(targetStyles()?.zIndex).toBeDefined();
      expect(targetStyles()?.position).toBe("relative");
    },
  );

  it("still reorders markup for an absolutely positioned element", () => {
    const { args, applyLocalContentUpdate, commitVisualStyles } = harness({
      computedStyles: { position: "absolute" },
    });
    runChangeSelectedZIndex(args, "backward");
    expect(applyLocalContentUpdate).toHaveBeenCalledTimes(1);
    expect(commitVisualStyles).not.toHaveBeenCalled();
  });

  it("trusts the authored position over a resolved one", () => {
    const { args, applyLocalContentUpdate } = harness(
      {
        computedStyles: { position: "static" },
        inlineStyles: { position: "absolute" },
      },
      "a",
    );
    runChangeSelectedZIndex(args, "forward");
    expect(applyLocalContentUpdate).toHaveBeenCalledTimes(1);
  });

  it("sends to back below static siblings, not to z-index 0", () => {
    const { args, targetStyles } = harness({
      computedStyles: { position: "static", zIndex: "auto" },
    });
    runChangeSelectedZIndex(args, "back");
    expect(targetStyles()?.zIndex).toBe("-1");
  });

  it("keeps stepping backward past zero", () => {
    const { args, targetStyles } = harness({
      computedStyles: { position: "relative", zIndex: "0" },
    });
    runChangeSelectedZIndex(args, "backward");
    expect(targetStyles()?.zIndex).toBe("-1");
  });
});

// PR #3585 review: a negative z-index escapes to the nearest stacking-context
// ancestor, so an in-flow layer sent to back could vanish behind an opaque
// parent background instead of moving behind its siblings.
describe("runChangeSelectedZIndex — send to back must not hide the layer", () => {
  it("isolates the parent so the negative index cannot escape", () => {
    const { args, commitVisualStyles } = harness({
      computedStyles: { position: "static", zIndex: "auto" },
    });
    runChangeSelectedZIndex(args, "back");
    const written = commitVisualStyles.mock.calls.map(([sel, styles]) => [
      sel,
      styles,
    ]);
    const isolated = written.find(([, styles]) => styles.isolation);
    expect(isolated?.[1]).toEqual({ isolation: "isolate" });
    const target = written.find(([, styles]) => styles.zIndex);
    expect(target?.[1].zIndex).toBe("-1");
    // The parent must be isolated before the child goes negative.
    expect(written.indexOf(isolated!)).toBeLessThan(written.indexOf(target!));
  });

  it("stays at 0 when there is no parent to isolate", () => {
    const { args, commitVisualStyles, targetStyles } = harness(
      { computedStyles: { position: "static", zIndex: "auto" } },
      "wrap",
    );
    runChangeSelectedZIndex(args, "back");
    expect(targetStyles()?.zIndex).toBe("0");
    expect(commitVisualStyles.mock.calls.some(([, s]) => s.isolation)).toBe(
      false,
    );
  });
});

// PR #3585 review round 2.
describe("runChangeSelectedZIndex — send to back must reach the back", () => {
  it("goes below a sibling that is already negative", () => {
    const content = `<html><body><div data-agent-native-node-id="wrap">
<div data-agent-native-node-id="a" style="z-index:-2"></div>
<div data-agent-native-node-id="b"></div>
</div></body></html>`;
    const { args, targetStyles } = harness(
      { computedStyles: { position: "static", zIndex: "auto" } },
      "b",
      content,
    );
    runChangeSelectedZIndex(args, "back");
    expect(targetStyles()?.zIndex).toBe("-3");
  });

  it("does not raise a layer that is already lower than its siblings", () => {
    const { args, targetStyles } = harness({
      computedStyles: { position: "static", zIndex: "-5" },
    });
    runChangeSelectedZIndex(args, "back");
    expect(targetStyles()?.zIndex).toBe("-5");
  });
});

describe("runChangeSelectedZIndex — must not relocate positioned children", () => {
  const withAbsChild = `<html><body><div data-agent-native-node-id="wrap">
<div data-agent-native-node-id="a"></div>
<div data-agent-native-node-id="b"><span data-agent-native-node-id="pin" style="position:absolute;left:10px;top:10px"></span></div>
</div></body></html>`;

  it("reorders markup rather than positioning a static container with an absolute child", () => {
    const { args, applyLocalContentUpdate, commitVisualStyles } = harness(
      { computedStyles: { position: "static", zIndex: "auto" } },
      "b",
      withAbsChild,
    );
    runChangeSelectedZIndex(args, "backward");
    expect(commitVisualStyles).not.toHaveBeenCalled();
    expect(applyLocalContentUpdate).toHaveBeenCalledTimes(1);
  });

  it("still writes z-index when the element is a flex item, which needs no positioning", () => {
    const { args, applyLocalContentUpdate, targetStyles } = harness(
      {
        isFlexChild: true,
        parentDisplay: "flex",
        computedStyles: { position: "static", zIndex: "auto" },
      },
      "b",
      withAbsChild,
    );
    runChangeSelectedZIndex(args, "backward");
    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(targetStyles()?.zIndex).toBeDefined();
  });
});
