// @vitest-environment jsdom

import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
  type CodeLayerTreeNode,
} from "@shared/code-layer";
import type { RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    openAt,
    setCanvasLayerHitCandidates,
  };
}

describe("runIframeContextMenu", () => {
  afterEach(() => vi.unstubAllGlobals());

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

  it("includes iframe scroll offsets and screen scope for Paste here", () => {
    const { args, openAt } = harness();
    args.zoom = 50;
    document.body.append(args.canvasContainerRef.current!);
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    args.canvasContainerRef.current!.append(iframe);
    vi.spyOn(iframe, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      right: 1010,
      bottom: 1020,
      width: 1000,
      height: 1000,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    });
    Object.defineProperties(iframe.contentWindow, {
      scrollX: { configurable: true, value: 80 },
      scrollY: { configurable: true, value: 120 },
    });

    runIframeContextMenu(args, {
      screenId: "screen-1",
      clientX: 999,
      clientY: 999,
      viewportClientX: 110,
      viewportClientY: 220,
    });

    expect(openAt).toHaveBeenCalledWith({
      clientX: 110,
      clientY: 220,
      canvasX: 280,
      canvasY: 520,
      screenId: "screen-1",
    });
  });

  it("uses the right-clicked overview screen instead of the active screen", () => {
    const { args, openAt } = harness();
    args.viewMode = "overview";
    args.overviewCanvasZoom = 50;
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    document.body.append(args.canvasContainerRef.current!);
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-screen-iframe-id", "screen-2");
    args.canvasContainerRef.current!.append(iframe);
    vi.spyOn(iframe, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 200,
      right: 1100,
      bottom: 1200,
      width: 1000,
      height: 1000,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    });
    Object.defineProperties(iframe.contentWindow, {
      scrollX: { configurable: true, value: 30 },
      scrollY: { configurable: true, value: 40 },
    });

    runIframeContextMenu(args, {
      screenId: "screen-2",
      clientX: 999,
      clientY: 999,
      viewportClientX: 210,
      viewportClientY: 320,
    });

    expect(openAt).toHaveBeenCalledWith({
      clientX: 210,
      clientY: 320,
      canvasX: 250,
      canvasY: 280,
      screenId: "screen-2",
    });
  });
});
