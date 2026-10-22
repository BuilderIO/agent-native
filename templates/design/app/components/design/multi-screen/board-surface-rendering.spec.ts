// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  getBoardObjectRects,
  getBoardObjectScreenOverlaps,
  getBoardSurfaceContentBounds,
  getBoardSurfaceHtml,
  getBoardSurfaceStaticPreviewContent,
  hasBoardRuntimeSurfaceContent,
  shouldMountBoardSurface,
  shouldRenderOverviewReviewCanvas,
  shouldRenderEmptyBoardReviewCanvas,
} from "./board-surface-html";
import {
  getBoardSurfaceRenderGeometry,
  getBoardSurfaceStaticPreviewViewport,
} from "./overview-layout";

describe("board surface rendering", () => {
  it("keeps the full-size static board body untransformed for native presentation", () => {
    const html = `<html><body><div data-agent-native-node-id="overlap" style="position:absolute;left:780px;top:180px;width:420px;height:220px"></div></body></html>`;
    const fullSize = getBoardSurfaceStaticPreviewContent({
      html,
      logicalGeometry: { x: 0, y: 0, width: 1200, height: 400 },
      viewport: { width: 1200, height: 400 },
    });
    const bounded = getBoardSurfaceStaticPreviewContent({
      html,
      logicalGeometry: { x: 0, y: 0, width: 1200, height: 400 },
      viewport: { width: 600, height: 200 },
    });

    expect(fullSize).toContain("transform:none!important");
    expect(fullSize).toContain("body>[data-agent-native-node-id]");
    expect(bounded).toContain("transform:scale(0.5)!important");
  });

  it("projects an oversized over-screen board into a bounded native viewport", () => {
    const logicalGeometry = {
      x: 0,
      y: 0,
      width: 24_576,
      height: 16_384,
    };
    const viewport = getBoardSurfaceStaticPreviewViewport(logicalGeometry);
    const preview = getBoardSurfaceStaticPreviewContent({
      html: `<html><body><div data-agent-native-node-id="overlap" style="position:absolute;left:5000px;top:180px;width:420px;height:220px"></div></body></html>`,
      logicalGeometry,
      viewport,
    });

    expect(viewport.width).toBe(4096);
    expect(viewport.height).toBeCloseTo(2730.667, 2);
    expect(preview).toContain(`html{width:${viewport.width}px!important;`);
    expect(preview).toContain(`height:${viewport.height}px!important`);
    expect(preview).toContain(`transform:scale(${1 / 6})!important`);
    expect(preview).toContain(
      `translate:${-logicalGeometry.x}px ${-logicalGeometry.y}px`,
    );
  });

  it("retains native effect data while stripping executable authored board scripts", () => {
    const preview = getBoardSurfaceStaticPreviewContent({
      html: `<html><body><div data-agent-native-node-id="board" onclick="alert(1)"></div><script>alert(2)</script><script type="application/x-agent-native-effects" onload="alert(3)">{"schemaVersion":2,"definitions":[],"instances":[]}</script></body></html>`,
      logicalGeometry: { x: 0, y: 0, width: 200, height: 100 },
      viewport: { width: 200, height: 100 },
    });
    expect(preview).toContain(
      '<script type="application/x-agent-native-effects">{"schemaVersion":2,"definitions":[],"instances":[]}</script>',
    );
    expect(preview).not.toContain("alert(");
    expect(preview).not.toContain("onclick=");
    expect(preview.match(/<script\b/g)).toHaveLength(1);
    expect(preview).toContain("script-src 'nonce-");
    expect(preview).not.toContain("script-src 'unsafe-inline'");
  });

  it("paints the parts of board objects over a screen above it, except objects that enclose the screen", () => {
    const objects = getBoardObjectRects(`<html><body>
      <div data-agent-native-node-id="inside" style="position:absolute;left:160px;top:110px;width:80px;height:80px"></div>
      <div data-agent-native-node-id="straddles" style="position:absolute;left:380px;top:-20px;width:40px;height:40px"></div>
      <div data-agent-native-node-id="backdrop" style="position:absolute;left:-100px;top:-100px;width:800px;height:600px"></div>
      <div data-agent-native-node-id="away" style="position:absolute;left:600px;top:0px;width:40px;height:40px"></div>
      <div data-agent-native-node-id="auto-text" style="position:absolute;left:10px;top:10px"></div>
    </body></html>`);

    expect(
      getBoardObjectScreenOverlaps(objects, [
        { x: 0, y: 0, width: 400, height: 300 },
      ]),
    ).toEqual([
      { x: 160, y: 110, width: 80, height: 80 },
      { x: 380, y: 0, width: 20, height: 20 },
    ]);
  });

  it("mounts an inert board document when an existing board file is empty", () => {
    expect(getBoardSurfaceHtml("<html><body></body></html>")).toContain(
      "<body></body>",
    );
    expect(getBoardSurfaceHtml(undefined)).toBeUndefined();
    const authored = "<html><body><div>Canvas</div></body></html>";
    expect(getBoardSurfaceHtml(authored)).toBe(authored);
  });

  it("keeps a runtime board mounted through its insert acknowledgement", () => {
    expect(
      shouldMountBoardSurface({
        hasAuthoredContent: false,
        crossScreenDragActive: false,
        hasPendingRuntimeInsert: false,
        hasPendingRuntimeRollback: false,
        runtimeContentBoardId: null,
        boardFileId: "board-1",
      }),
    ).toBe(false);
    expect(
      shouldMountBoardSurface({
        hasAuthoredContent: false,
        crossScreenDragActive: false,
        hasPendingRuntimeInsert: true,
        hasPendingRuntimeRollback: false,
        runtimeContentBoardId: null,
        boardFileId: "board-1",
      }),
    ).toBe(true);
    expect(
      shouldMountBoardSurface({
        hasAuthoredContent: false,
        crossScreenDragActive: false,
        hasPendingRuntimeInsert: false,
        hasPendingRuntimeRollback: false,
        runtimeContentBoardId: "board-1",
        boardFileId: "board-1",
      }),
    ).toBe(true);
    expect(
      shouldMountBoardSurface({
        hasAuthoredContent: false,
        crossScreenDragActive: false,
        hasPendingRuntimeInsert: false,
        hasPendingRuntimeRollback: false,
        runtimeContentBoardId: "board-1",
        boardFileId: "board-2",
      }),
    ).toBe(false);
    expect(
      shouldMountBoardSurface({
        hasAuthoredContent: false,
        crossScreenDragActive: false,
        hasPendingRuntimeInsert: false,
        hasPendingRuntimeRollback: true,
        runtimeContentBoardId: null,
        boardFileId: "board-1",
      }),
    ).toBe(true);
  });

  it("does not carry runtime board content across board identities", () => {
    expect(
      hasBoardRuntimeSurfaceContent({
        boardFileId: "board-a",
        runtimeBoardFileId: "board-a",
        runtimeRequestKeys: ["move-a"],
      }),
    ).toBe(true);
    expect(
      hasBoardRuntimeSurfaceContent({
        boardFileId: "board-b",
        runtimeBoardFileId: "board-a",
        runtimeRequestKeys: ["move-a"],
      }),
    ).toBe(false);
    expect(
      hasBoardRuntimeSurfaceContent({
        boardFileId: "board-a",
        runtimeBoardFileId: "board-a",
        runtimeRequestKeys: [],
      }),
    ).toBe(false);
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
