// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSinglePageRasterPdf: vi.fn(),
  cropCanvasToRect: vi.fn(),
  prepareExportCaptureTarget: vi.fn(),
  renderExportDocumentCanvas: vi.fn(),
  resolveBoardExportCropRect: vi.fn(),
  resolveExportCropRect: vi.fn(),
  resolveExportCropTarget: vi.fn(),
  resolveSelectedExportElements: vi.fn(),
}));

vi.mock("html2canvas", () => ({ default: vi.fn() }));
vi.mock("@/pages/design-editor/export-capture", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/pages/design-editor/export-capture")
    >();
  return {
    ...actual,
    createSinglePageRasterPdf: mocks.createSinglePageRasterPdf,
  };
});
vi.mock(
  "@/pages/design-editor/export-snapshot-frame",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/pages/design-editor/export-snapshot-frame")
      >();
    return {
      ...actual,
      prepareExportCaptureTarget: mocks.prepareExportCaptureTarget,
    };
  },
);
vi.mock("@/pages/design-editor/png-export-render", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/pages/design-editor/png-export-render")
    >();
  return {
    ...actual,
    cropCanvasToRect: mocks.cropCanvasToRect,
    renderExportDocumentCanvas: mocks.renderExportDocumentCanvas,
    resolveBoardExportCropRect: mocks.resolveBoardExportCropRect,
    resolveExportCropRect: mocks.resolveExportCropRect,
    resolveExportCropTarget: mocks.resolveExportCropTarget,
    resolveSelectedExportElements: mocks.resolveSelectedExportElements,
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { runDownloadPdf } from "./download-pdf";
import { runRenderPngBlob } from "./render-png-blob";

describe("selected-layer PDF export from runtime snapshots", () => {
  let toBlob: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const renderCanvas = document.createElement("canvas");
    const snapshotIframe = document.createElement("iframe");
    Object.defineProperties(snapshotIframe, {
      clientWidth: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 200 },
    });
    const snapshotDoc = document.implementation.createHTMLDocument("runtime");
    const selectedElement = snapshotDoc.createElement("main");
    selectedElement.dataset.agentNativeNodeId = "selected-layer";
    snapshotDoc.body.append(selectedElement);
    const dispose = vi.fn();
    mocks.prepareExportCaptureTarget.mockReset().mockResolvedValue({
      doc: snapshotDoc,
      iframe: snapshotIframe,
      dispose,
    });
    mocks.createSinglePageRasterPdf
      .mockReset()
      .mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }));
    mocks.cropCanvasToRect.mockReset().mockReturnValue(renderCanvas);
    mocks.renderExportDocumentCanvas.mockReset().mockResolvedValue({
      canvas: renderCanvas,
      scale: 2,
    });
    mocks.resolveBoardExportCropRect.mockReset().mockReturnValue(null);
    mocks.resolveExportCropRect.mockReset().mockReturnValue({
      x: 0,
      y: 0,
      width: 80,
      height: 40,
    });
    mocks.resolveExportCropTarget.mockReset().mockReturnValue({
      kind: "rect",
      rect: { x: 0, y: 0, width: 80, height: 40 },
    });
    mocks.resolveSelectedExportElements
      .mockReset()
      .mockReturnValue([selectedElement]);
    toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((callback, type) =>
        callback(new Blob(["png"], { type })),
      );
  });

  afterEach(() => {
    toBlob.mockRestore();
  });

  it("renders the selected layer and downloads a PDF when the preview document is cross-origin", async () => {
    const iframe = document.createElement("iframe");
    iframe.dataset.designSourceType = "localhost";
    Object.defineProperties(iframe, {
      clientWidth: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 200 },
    });
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      value: null,
    });
    const cropSelection = {
      id: "selected-layer",
      sourceLayerIdentity: { screenId: "screen-1", nodeId: "selected-layer" },
    } as never;
    const resolvePngCaptureTarget = vi.fn(() => ({
      cropSelection,
      doc: null,
      iframe,
      snapshotSource: {
        html: "<!doctype html><html><body><main>Current preview</main></body></html>",
        baseUrl: "http://localhost:5173/",
      },
      snapshotWidth: 320,
      snapshotHeight: 200,
    }));
    const renderArgs = {
      activeCanvasSourceType: "localhost" as const,
      canEditDesign: true,
      canvasFrameGeometryById: {},
      overviewScreens: [],
      resolvePngCaptureTarget,
      selectedScreenIds: [],
      viewMode: "overview" as const,
    };
    const triggerBlobDownload = vi.fn();
    const showRasterCaptureError = vi.fn();

    await runDownloadPdf(
      {
        fallbackExportName: () => "Design - selection.pdf",
        pngExportingRef: { current: false },
        renderPngBlob: (arg) => runRenderPngBlob(renderArgs, arg),
        resolveSelectedScreensBounds: () => null,
        resolvePngCaptureTarget,
        setPngExporting: vi.fn(),
        showRasterCaptureError,
        t: (key) => key,
        triggerBlobDownload,
      },
      { scale: 2 },
      "element",
    );

    expect(resolvePngCaptureTarget).toHaveBeenCalledWith("element");
    expect(mocks.prepareExportCaptureTarget).toHaveBeenCalledTimes(2);
    expect(mocks.renderExportDocumentCanvas).toHaveBeenCalledWith(
      expect.objectContaining({
        doc: expect.any(Object),
        isolateSelectedElements: [expect.any(Object)],
      }),
    );
    expect(mocks.createSinglePageRasterPdf).toHaveBeenCalledWith(
      expect.objectContaining({ width: 80, height: 40 }),
    );
    expect(triggerBlobDownload).toHaveBeenCalledOnce();
    expect(showRasterCaptureError).not.toHaveBeenCalled();
  });
});
