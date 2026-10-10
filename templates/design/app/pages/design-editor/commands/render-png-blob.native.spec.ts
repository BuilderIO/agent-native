// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  renderSelectedNativeSceneBlob: vi.fn(),
}));

vi.mock(
  "@/pages/design-editor/native-scene-export-client",
  async (original) => ({
    ...(await original<
      typeof import("@/pages/design-editor/native-scene-export-client")
    >()),
    renderSelectedNativeSceneBlob: mocks.renderSelectedNativeSceneBlob,
  }),
);

import { NativeSceneExportError } from "../native-scene-export-client";
import { resolvePngSourceFileId, runRenderPngBlob } from "./render-png-blob";

function nativeTarget(sourceFileId: string | undefined = "board-1") {
  const doc = document.implementation.createHTMLDocument("Native Design");
  const manifest = doc.createElement("script");
  manifest.type = "application/x-agent-native-effects";
  doc.body.appendChild(manifest);
  const iframe = document.createElement("iframe");
  const viewedWindow = {
    __agentNativeSourceProvenance: { versionHash: "12:abc" },
  };
  Object.defineProperties(iframe, {
    clientWidth: { configurable: true, value: 1200 },
    clientHeight: { configurable: true, value: 800 },
    contentDocument: { configurable: true, value: doc },
    contentWindow: { configurable: true, value: viewedWindow },
  });
  document.body.appendChild(iframe);
  return { doc, iframe, cropSelection: null, sourceFileId };
}

describe("native Design PNG command routing", () => {
  afterEach(() => document.body.replaceChildren());
  beforeEach(() => {
    mocks.renderSelectedNativeSceneBlob.mockReset();
    mocks.renderSelectedNativeSceneBlob.mockResolvedValue(
      new Blob(["png"], { type: "image/png" }),
    );
  });

  it("resolves the board source owner before an unrelated active screen", () => {
    const boardLayer = document.createElement("div");
    boardLayer.setAttribute("data-board-surface-layer", "");
    const iframe = document.createElement("iframe");
    boardLayer.appendChild(iframe);
    expect(
      resolvePngSourceFileId({
        iframe,
        boardFileId: "board-1",
        activeFileId: "screen-1",
      }),
    ).toBe("board-1");
    iframe.setAttribute("data-screen-iframe-id", "screen-2");
    expect(
      resolvePngSourceFileId({
        iframe,
        boardFileId: "board-1",
        activeFileId: "screen-1",
      }),
    ).toBe("screen-2");
    expect(
      resolvePngSourceFileId({
        requestedScreenId: "screen-3",
        iframe,
        boardFileId: "board-1",
        activeFileId: "screen-1",
      }),
    ).toBe("screen-3");
  });

  it("uses the exact board file and local native pixel producer for a document PNG", async () => {
    const result = await runRenderPngBlob(
      {
        activeCanvasSourceType: "inline",
        boardFileId: "board-1",
        canEditDesign: true,
        canvasFrameGeometryById: {},
        designId: "design-1",
        overviewScreens: [],
        resolvePngCaptureTarget: () => nativeTarget(),
        selectedScreenIds: [],
        viewMode: "single",
      },
      { scope: "document", settings: { scale: 2 }, format: "png" },
    );
    expect(result.type).toBe("image/png");
    expect(mocks.renderSelectedNativeSceneBlob).toHaveBeenCalledWith({
      designId: "design-1",
      fileId: "board-1",
      expectedVersionHash: "12:abc",
      assertStillViewed: expect.any(Function),
      viewport: { width: 1200, height: 800 },
      pixelRatio: 2,
      format: "png",
    });
  });

  it("refuses a native capture when the viewed source has no version", async () => {
    const target = nativeTarget();
    (
      target.iframe.contentWindow as Window & {
        __agentNativeSourceProvenance: { versionHash: string };
      }
    ).__agentNativeSourceProvenance.versionHash = "";
    await expect(
      runRenderPngBlob(
        {
          activeCanvasSourceType: "inline",
          canEditDesign: true,
          canvasFrameGeometryById: {},
          designId: "design-1",
          overviewScreens: [],
          resolvePngCaptureTarget: () => target,
          selectedScreenIds: [],
          viewMode: "single",
        },
        { scope: "document", format: "png" },
      ),
    ).rejects.toMatchObject({ code: "scene-unreadable" });
    expect(mocks.renderSelectedNativeSceneBlob).not.toHaveBeenCalled();
  });

  it("fails typed for a selected native layer without a crop contract", async () => {
    const target = {
      ...nativeTarget(),
      cropSelection: {
        tagName: "DIV",
        selector: "#missing",
        classes: [],
        computedStyles: {},
        boundingRect: { x: 0, y: 0, width: 40, height: 40 },
        isFlexChild: false,
        isFlexContainer: false,
      },
    };
    await expect(
      runRenderPngBlob(
        {
          activeCanvasSourceType: "inline",
          canEditDesign: true,
          canvasFrameGeometryById: {},
          designId: "design-1",
          overviewScreens: [],
          resolvePngCaptureTarget: () => target,
          selectedScreenIds: [],
          viewMode: "single",
        },
        { scope: "element", format: "png" },
      ),
    ).rejects.toMatchObject({ code: "scene-unreadable" });
    expect(mocks.renderSelectedNativeSceneBlob).not.toHaveBeenCalled();
  });

  it("rejects a board document whose authored artwork crop differs from the viewport", async () => {
    const target = nativeTarget();
    Object.defineProperty(target.doc, "defaultView", {
      configurable: true,
      value: window,
    });
    const node = target.doc.createElement("div");
    node.setAttribute("data-agent-native-node-id", "far-artwork");
    node.getBoundingClientRect = () =>
      ({
        x: 420,
        y: 300,
        left: 420,
        top: 300,
        right: 520,
        bottom: 400,
        width: 100,
        height: 100,
        toJSON: () => ({}),
      }) as DOMRect;
    target.doc.body.appendChild(node);
    await expect(
      runRenderPngBlob(
        {
          activeCanvasSourceType: "inline",
          boardFileId: "board-1",
          canEditDesign: true,
          canvasFrameGeometryById: {},
          designId: "design-1",
          overviewScreens: [],
          resolvePngCaptureTarget: () => target,
          selectedScreenIds: [],
          viewMode: "single",
        },
        { scope: "document", format: "png" },
      ),
    ).rejects.toMatchObject({ code: "scene-unreadable" });
    expect(mocks.renderSelectedNativeSceneBlob).not.toHaveBeenCalled();
  });

  it("fails typed for multi-screen native composition instead of rasterizing blank effects", async () => {
    await expect(
      runRenderPngBlob(
        {
          activeCanvasSourceType: "inline",
          canEditDesign: true,
          canvasFrameGeometryById: {},
          designId: "design-1",
          overviewScreens: [],
          resolvePngCaptureTarget: () => nativeTarget("screen-1"),
          selectedScreenIds: ["screen-1", "screen-2"],
          viewMode: "overview",
        },
        { scope: "screens", format: "png" },
      ),
    ).rejects.toBeInstanceOf(NativeSceneExportError);
    expect(mocks.renderSelectedNativeSceneBlob).not.toHaveBeenCalled();
  });

  it("rejects rotated selected-screen geometry before exporting raw native pixels", async () => {
    await expect(
      runRenderPngBlob(
        {
          activeCanvasSourceType: "inline",
          canEditDesign: true,
          canvasFrameGeometryById: { "screen-1": { rotation: 15 } },
          designId: "design-1",
          overviewScreens: [],
          resolvePngCaptureTarget: () => nativeTarget("screen-1"),
          selectedScreenIds: ["screen-1"],
          viewMode: "overview",
        },
        { scope: "screens", format: "png" },
      ),
    ).rejects.toMatchObject({ code: "scene-unreadable" });
    expect(mocks.renderSelectedNativeSceneBlob).not.toHaveBeenCalled();
  });
});
