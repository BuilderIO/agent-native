import { describe, expect, it } from "vitest";

import {
  getBoardSurfaceContentBounds,
  getBoardSurfaceHtml,
  shouldRenderOverviewReviewCanvas,
  shouldRenderEmptyBoardReviewCanvas,
} from "./board-surface-html";
import { getBoardSurfaceRenderGeometry } from "./overview-layout";

describe("board surface rendering", () => {
  it("mounts an inert board document when an existing board file is empty", () => {
    expect(getBoardSurfaceHtml("<html><body></body></html>")).toContain(
      "<body></body>",
    );
    expect(getBoardSurfaceHtml(undefined)).toBeUndefined();
    const authored = "<html><body><div>Canvas</div></body></html>";
    expect(getBoardSurfaceHtml(authored)).toBe(authored);
  });

  it("uses the viewport for a normal-flow app stored as the only board file", () => {
    const appDocument = `<!doctype html><html><body data-agent-native-node-id="body">
      <div data-agent-native-node-id="app" class="app">
        <header data-agent-native-node-id="header"><h1 data-agent-native-node-id="title">Badge Studio</h1></header>
        <main data-agent-native-node-id="main"><section data-agent-native-node-id="preview">Preview</section></main>
      </div>
    </body></html>`;
    const viewport = { x: -640, y: -360, width: 1280, height: 720 };

    const contentBounds = getBoardSurfaceContentBounds(appDocument);
    const renderGeometry = getBoardSurfaceRenderGeometry({
      logicalGeometry: { x: -65536, y: -65536, width: 131072, height: 131072 },
      contentBounds,
      screenGeometries: [viewport],
      focus: { x: 0, y: 0 },
    });

    expect(contentBounds).toBeNull();
    expect(renderGeometry).toEqual(viewport);
  });

  it("keeps an empty board reviewable without mounting its normal iframe", () => {
    expect(
      shouldRenderEmptyBoardReviewCanvas({
        hasSurfaceContent: false,
        reviewPinMode: true,
        reviewCommentsHidden: false,
        reviewTargetId: null,
      }),
    ).toBe(true);
    expect(
      shouldRenderEmptyBoardReviewCanvas({
        hasSurfaceContent: false,
        reviewPinMode: false,
        reviewCommentsHidden: false,
        reviewTargetId: null,
      }),
    ).toBe(true);
    expect(
      shouldRenderEmptyBoardReviewCanvas({
        hasSurfaceContent: false,
        reviewPinMode: false,
        reviewCommentsHidden: false,
        reviewTargetId: "screen-1",
      }),
    ).toBe(false);
    expect(
      shouldRenderEmptyBoardReviewCanvas({
        hasSurfaceContent: true,
        reviewPinMode: true,
        reviewCommentsHidden: false,
        reviewTargetId: null,
      }),
    ).toBe(false);
  });

  it("leaves board-root review pins to the board owner once its content loads", () => {
    expect(
      shouldRenderOverviewReviewCanvas({
        boardFileId: "board",
        boardFileContent: "<html><body></body></html>",
      }),
    ).toBe(false);
    expect(
      shouldRenderOverviewReviewCanvas({
        boardFileId: "board",
      }),
    ).toBe(true);
    expect(shouldRenderOverviewReviewCanvas({})).toBe(true);
  });
});
