// @vitest-environment jsdom

import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
  type CodeLayerTreeNode,
} from "@shared/code-layer";
import type { RefObject } from "react";
import { describe, expect, it, vi } from "vitest";

import type { CanvasContextMenuHandle } from "@/components/design/CanvasContextMenu";
import type { ElementInfo } from "@/components/design/types";
import { resolvedLayerName } from "@/pages/design-editor/code-layer-state";

import {
  runIframeContextMenu,
  type IframeContextMenuArgs,
} from "./iframe-context-menu";

const ELEMENT_INFO = {
  tagName: "section",
  selector: '[data-agent-native-node-id="hero"]',
} as ElementInfo;

function findTreeNode(
  nodes: CodeLayerTreeNode[],
  id: string,
): CodeLayerTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findTreeNode(node.children, id);
    if (child) return child;
  }
  return undefined;
}

function harness(
  projection: ReturnType<typeof buildCodeLayerProjection> | null = null,
) {
  const handleScreenElementSelect = vi.fn();
  const setCanvasLayerHitCandidates = vi.fn();
  const openAt = vi.fn();
  const container = document.createElement("div");
  const args: IframeContextMenuArgs = {
    activeFile: { id: "screen-1" } as IframeContextMenuArgs["activeFile"],
    activeFileId: "screen-1",
    boardFileId: undefined,
    canvasContainerRef: { current: container },
    canvasContextMenuRef: {
      current: { openAt, close: vi.fn() },
    } as RefObject<CanvasContextMenuHandle | null>,
    focusDesignInspectorForSelection: vi.fn(),
    getCodeLayerProjectionForScreen: vi.fn(() => projection),
    handleScreenElementSelect,
    overviewCanvasZoom: 100,
    setCanvasLayerHitCandidates,
    viewMode: "single",
    zoom: 100,
  };

  return {
    args,
    handleScreenElementSelect,
    setCanvasLayerHitCandidates,
  };
}

describe("runIframeContextMenu", () => {
  it("preserves responsive-frame scope for direct and candidate selections", () => {
    const { args, handleScreenElementSelect, setCanvasLayerHitCandidates } =
      harness();

    runIframeContextMenu(args, {
      screenId: "screen-1",
      breakpointWidthPx: 768,
      clientX: 20,
      clientY: 30,
      info: ELEMENT_INFO,
      layerCandidates: [
        {
          key: "hero",
          label: "Hero",
          screenId: "screen-1",
          info: ELEMENT_INFO,
        },
      ],
    });

    expect(handleScreenElementSelect).toHaveBeenCalledWith(
      "screen-1",
      ELEMENT_INFO,
      undefined,
      {
        persistPendingNodeId: false,
        breakpointWidthPx: 768,
      },
    );
    expect(setCanvasLayerHitCandidates).toHaveBeenCalledWith([
      expect.objectContaining({
        key: "hero",
        label: "Hero",
        breakpointWidthPx: 768,
      }),
    ]);
  });

  it("uses the Layers panel name for matching context-menu candidates", () => {
    const projection = buildCodeLayerProjection(
      '<main><button id="cta">Continue</button></main>',
    );
    const projectedButton = projection.nodes.find(
      (node) => node.attributes.id === "cta",
    );
    expect(projectedButton).toBeDefined();
    const layerTree = buildCodeLayerTree(projection);
    const panelNode = findTreeNode(layerTree, projectedButton!.id);
    expect(panelNode).toBeDefined();
    expect(resolvedLayerName(panelNode!)).toBe("Continue");
    const buttonInfo = {
      ...ELEMENT_INFO,
      tagName: "button",
      id: "cta",
      sourceId: "cta",
      selector: "#cta",
      classes: [],
    } as ElementInfo;
    const { args, setCanvasLayerHitCandidates } = harness(projection);

    runIframeContextMenu(args, {
      screenId: "screen-1",
      clientX: 20,
      clientY: 30,
      layerCandidates: [
        {
          key: "cta",
          label: "cta",
          screenId: "screen-1",
          info: buttonInfo,
        },
      ],
    });

    expect(args.getCodeLayerProjectionForScreen).toHaveBeenCalledWith(
      "screen-1",
    );
    expect(setCanvasLayerHitCandidates).toHaveBeenCalledWith([
      expect.objectContaining({ key: "cta", label: "Continue" }),
    ]);
  });
});
