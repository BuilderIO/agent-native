// @vitest-environment jsdom

import type { RefObject } from "react";
import { describe, expect, it, vi } from "vitest";

import type { CanvasContextMenuHandle } from "@/components/design/CanvasContextMenu";

import {
  runIframeContextMenu,
  type IframeContextMenuArgs,
} from "./iframe-context-menu";

function crossOriginIframe(): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-design-preview-iframe", "");
  Object.defineProperty(iframe, "contentWindow", {
    get: () => ({
      get scrollX(): number {
        throw new DOMException("Blocked a frame", "SecurityError");
      },
    }),
  });
  return iframe;
}

describe("cross-origin preview iframe scroll", () => {
  it("still opens the context menu", () => {
    const openAt = vi.fn();
    const container = document.createElement("div");
    container.appendChild(crossOriginIframe());
    const args: IframeContextMenuArgs = {
      activeFile: { id: "screen-1" } as IframeContextMenuArgs["activeFile"],
      activeFileId: "screen-1",
      boardFileId: undefined,
      canvasContainerRef: { current: container },
      canvasContextMenuRef: {
        current: { openAt, close: vi.fn() },
      } as RefObject<CanvasContextMenuHandle | null>,
      getCodeLayerProjectionForScreen: vi.fn(() => null),
      handleScreenElementSelect: vi.fn(),
      overviewCanvasZoom: 100,
      setCanvasLayerHitCandidates: vi.fn(),
      viewMode: "single",
      zoom: 100,
    };

    expect(() =>
      runIframeContextMenu(args, { clientX: 20, clientY: 30 }),
    ).not.toThrow();
    expect(openAt).toHaveBeenCalledTimes(1);
    expect(openAt.mock.calls[0]![0]).not.toHaveProperty("canvasX");
  });
});
