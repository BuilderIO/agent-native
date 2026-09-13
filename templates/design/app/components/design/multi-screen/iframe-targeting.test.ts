// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  findCanvasIframeForScreen,
  frameCommandTargetIds,
} from "./iframe-targeting";

describe("frameCommandTargetIds", () => {
  const isFrame = (id: string) => id === "home" || id === "footer";

  it("keeps a screen id when the screen itself is the selection", () => {
    expect(frameCommandTargetIds(["home"], isFrame, null)).toEqual(["home"]);
  });

  it("drops a screen id that is only present because a layer inside it is selected (Cmd+D on 'Card' must not duplicate 'Home')", () => {
    // Mirrors yt-mobile-landing-1: the Layers-panel selection put "card" in
    // selectedLayerIdsState, but the overview's own selectedIds still
    // carries "home" for z-order/"topmost screen" purposes.
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
  // Guards the agent-native:board-selection-rect message listener in
  // MultiScreenCanvas: a Screen's own preview iframe also matches
  // `[data-design-preview-iframe]`, so resolving "the board iframe" must
  // require the `[data-board-surface-layer]` ancestor too, or a sandboxed
  // Screen could forge the message and plant a spoofed selection rect.
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
    // Mirrors the listener's own check: `boardPreviewIframe.contentWindow !== event.source`.
    expect(
      boardPreviewIframe?.contentWindow === screenIframe.contentWindow,
    ).toBe(false);
    expect(
      boardPreviewIframe?.contentWindow === boardIframe.contentWindow,
    ).toBe(true);
    root.remove();
  });
});
