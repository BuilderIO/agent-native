// @vitest-environment jsdom

import type { RefObject } from "react";
import { describe, expect, it, vi } from "vitest";

import type { CanvasContextMenuHandle } from "@/components/design/CanvasContextMenu";
import type { ElementInfo } from "@/components/design/types";

import {
  runIframeContextMenu,
  type IframeContextMenuArgs,
} from "./iframe-context-menu";

const ELEMENT_INFO = {
  tagName: "section",
  selector: '[data-agent-native-node-id="hero"]',
} as ElementInfo;

function harness() {
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
        breakpointWidthPx: 768,
      }),
    ]);
  });
});
