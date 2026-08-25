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
function projectionId(authoredId: string): string {
  const node = buildCodeLayerProjection(CONTENT).nodes.find(
    (candidate) =>
      candidate.dataAttributes["data-agent-native-node-id"] === authoredId,
  );
  if (!node) throw new Error(`no projection node for ${authoredId}`);
  return node.id;
}

function harness(element: Partial<ElementInfo>, authoredId = "b") {
  const targetId = projectionId(authoredId);
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
    getFreshActiveContent: () => CONTENT,
    selectedElement,
    selectedLayerIdsState: [targetId],
    setSelectedElement: vi.fn(),
  } as unknown as Parameters<typeof runChangeSelectedZIndex>[0];
  return { args, applyLocalContentUpdate, commitVisualStyles };
}

describe("runChangeSelectedZIndex — a paint-order change must not move anything", () => {
  it.each(["forward", "backward", "front", "back"] as const)(
    "writes z-index instead of splicing markup for an in-flow element (%s)",
    (mode) => {
      const { args, applyLocalContentUpdate, commitVisualStyles } = harness({
        computedStyles: { position: "static", zIndex: "auto" },
      });
      runChangeSelectedZIndex(args, mode);
      expect(applyLocalContentUpdate).not.toHaveBeenCalled();
      expect(commitVisualStyles).toHaveBeenCalledTimes(1);
      const [, styles] = commitVisualStyles.mock.calls[0]!;
      expect(styles.zIndex).toBeDefined();
      expect(styles.position).toBe("relative");
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
    const { args, commitVisualStyles } = harness({
      computedStyles: { position: "static", zIndex: "auto" },
    });
    runChangeSelectedZIndex(args, "back");
    expect(commitVisualStyles.mock.calls[0]![1].zIndex).toBe("-1");
  });

  it("keeps stepping backward past zero", () => {
    const { args, commitVisualStyles } = harness({
      computedStyles: { position: "relative", zIndex: "0" },
    });
    runChangeSelectedZIndex(args, "backward");
    expect(commitVisualStyles.mock.calls[0]![1].zIndex).toBe("-1");
  });
});
