// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  findCanvasIframeForScreen,
  frameCommandTargetIds,
  shouldRenderBoardSelectionBox,
} from "./iframe-targeting";

describe("frameCommandTargetIds", () => {
  const isFrame = (id: string) => id === "home" || id === "footer";

  it("keeps a screen id when the screen itself is the selection", () => {
    expect(frameCommandTargetIds(["home"], isFrame, null)).toEqual(["home"]);
  });

  it("drops a screen id that is only present because a layer inside it is selected (Cmd+D on 'Card' must not duplicate 'Home')", () => {
    expect(frameCommandTargetIds(["home"], isFrame, "home")).toEqual([]);
  });

  it("still filters out non-frame ids (canvas primitives) regardless of selectedElementScreenId", () => {
    expect(
      frameCommandTargetIds(["home", "primitive-1"], isFrame, null),
    ).toEqual(["home"]);
  });

  it("only excludes the owning screen, not an unrelated selected frame", () => {
    expect(frameCommandTargetIds(["home", "footer"], isFrame, "home")).toEqual([
      "footer",
    ]);
  });
});

describe("findCanvasIframeForScreen board resolution (sender-boundary regression)", () => {
  function buildSurfaceWithScreenAndBoard(): {
    root: HTMLElement;
    screenIframe: HTMLIFrameElement;
    boardIframe: HTMLIFrameElement;
  } {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-screen-iframe-id="screen-a">
        <iframe data-design-preview-iframe></iframe>
      </div>
      <div data-board-surface-layer>
        <iframe data-design-preview-iframe></iframe>
      </div>
    `;
    document.body.append(root);
    return {
      root,
      screenIframe: root.querySelector<HTMLIFrameElement>(
        '[data-screen-iframe-id="screen-a"] iframe[data-design-preview-iframe]',
      )!,
      boardIframe: root.querySelector<HTMLIFrameElement>(
        "[data-board-surface-layer] iframe[data-design-preview-iframe]",
      )!,
    };
  }

  it("resolves to the board iframe, not the Screen's own preview iframe", () => {
    const { root, screenIframe, boardIframe } =
      buildSurfaceWithScreenAndBoard();
    const resolved = findCanvasIframeForScreen(root, "board-1", "board-1");
    expect(resolved).toBe(boardIframe);
    expect(resolved).not.toBe(screenIframe);
  });

  it("a message from the Screen iframe's window is ignored; one from the board iframe's window is applied", () => {
    const { root, screenIframe, boardIframe } =
      buildSurfaceWithScreenAndBoard();
    const boardPreviewIframe = findCanvasIframeForScreen(
      root,
      "board-1",
      "board-1",
    );
    expect(
      boardPreviewIframe?.contentWindow === screenIframe.contentWindow,
    ).toBe(false);
    expect(
      boardPreviewIframe?.contentWindow === boardIframe.contentWindow,
    ).toBe(true);
    root.remove();
  });
});

describe("shouldRenderBoardSelectionBox", () => {
  const rect = { left: 0, top: 0, width: 10, height: 10 };
  const renderGeometry = { x: 0, y: 0, width: 100, height: 100 };

  it("renders when a board element is selected on the active board file", () => {
    expect(
      shouldRenderBoardSelectionBox({
        boardSelectionRect: rect,
        boardIsActive: true,
        boardSurfaceRenderGeometry: renderGeometry,
      }),
    ).toBe(true);
  });

  it("does not render when the board file isn't the active file", () => {
    expect(
      shouldRenderBoardSelectionBox({
        boardSelectionRect: rect,
        boardIsActive: false,
        boardSurfaceRenderGeometry: renderGeometry,
      }),
    ).toBe(false);
  });

  it("does not render with no board selection or no render geometry yet", () => {
    expect(
      shouldRenderBoardSelectionBox({
        boardSelectionRect: null,
        boardIsActive: true,
        boardSurfaceRenderGeometry: renderGeometry,
      }),
    ).toBe(false);
    expect(
      shouldRenderBoardSelectionBox({
        boardSelectionRect: rect,
        boardIsActive: true,
        boardSurfaceRenderGeometry: null,
      }),
    ).toBe(false);
  });
});

describe("findCanvasIframeForScreen breakpoint measurement", () => {
  it("uses the active breakpoint preview instead of the primary layout", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<iframe data-screen-iframe-id="screen-a"></iframe><iframe data-screen-iframe-id="screen-a::bp-480"></iframe>';
    const breakpoint = root.querySelector<HTMLIFrameElement>(
      '[data-screen-iframe-id="screen-a::bp-480"]',
    );
    expect(findCanvasIframeForScreen(root, "screen-a", undefined, 480)).toBe(
      breakpoint,
    );
  });

  it("does not measure the primary layout when the selected breakpoint is absent", () => {
    const root = document.createElement("div");
    root.innerHTML = '<iframe data-screen-iframe-id="screen-a"></iframe>';
    expect(
      findCanvasIframeForScreen(root, "screen-a", undefined, 480),
    ).toBeNull();
  });

  it("keeps board geometry in its board preview when a breakpoint is selected", () => {
    const root = document.createElement("div");
    root.innerHTML =
      "<div data-board-surface-layer><iframe data-design-preview-iframe></iframe></div>";
    expect(findCanvasIframeForScreen(root, "board-a", "board-a", 480)).toBe(
      root.querySelector("iframe"),
    );
  });
});
