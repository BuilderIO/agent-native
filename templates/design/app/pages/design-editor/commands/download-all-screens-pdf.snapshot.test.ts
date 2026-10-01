// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createExportSnapshotFrame: vi.fn(),
  createMultiPageRasterPdf: vi.fn(),
  cropCanvasToRect: vi.fn(),
  renderExportDocumentCanvas: vi.fn(),
}));

vi.mock("@/pages/design-editor/export-capture", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/pages/design-editor/export-capture")
    >();
  return {
    ...actual,
    createMultiPageRasterPdf: mocks.createMultiPageRasterPdf,
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
      createExportSnapshotFrame: mocks.createExportSnapshotFrame,
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
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { runDownloadAllScreensPdf } from "./download-all-screens-pdf";

function makeCanvas(dataUrl: string) {
  return {
    toDataURL: vi.fn(() => dataUrl),
  } as unknown as HTMLCanvasElement;
}

function makeArgs(snapshotSource: { html: string; baseUrl: string } | null) {
  ["screen-remote", "screen-remote-2"].forEach((screenId) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-screen-iframe-id", screenId);
    iframe.dataset.designSourceType = "localhost";
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      value: null,
    });
    Object.defineProperties(iframe, {
      clientWidth: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 200 },
    });
    document.body.append(iframe);
  });

  const snapshotDoc = document.implementation.createHTMLDocument("snapshot");
  snapshotDoc.body.innerHTML = "<main>Current localhost preview</main>";
  const snapshotIframe = document.createElement("iframe");
  Object.defineProperties(snapshotIframe, {
    clientWidth: { configurable: true, value: 320 },
    clientHeight: { configurable: true, value: 200 },
  });
  const dispose = vi.fn();
  mocks.createExportSnapshotFrame.mockResolvedValue({
    doc: snapshotDoc,
    iframe: snapshotIframe,
    dispose,
  });

  const showRasterCaptureError = vi.fn();
  const triggerBlobDownload = vi.fn();
  return {
    args: {
      activeCanvasSourceType: "inline" as const,
      canEditDesign: true,
      canvasFrameGeometryById: {
        "screen-remote": { width: 320, height: 200 },
        "screen-remote-2": { width: 320, height: 200 },
      },
      fallbackExportName: () => "Design - all-screens.pdf",
      overviewScreens: [
        {
          id: "screen-remote",
          filename: "Home.html",
          content: "<main></main>",
          updatedAt: "2026-09-30T00:00:00.000Z",
          sourceType: "localhost",
          previewUrl: "http://localhost:5173/",
          width: 320,
          height: 200,
          heightPinned: true,
          heightMode: "fixed" as const,
        },
        {
          id: "screen-remote-2",
          filename: "Settings.html",
          content: "<main></main>",
          updatedAt: "2026-09-30T00:00:00.000Z",
          sourceType: "localhost",
          previewUrl: "http://localhost:5173/settings",
          width: 320,
          height: 200,
          heightPinned: true,
          heightMode: "fixed" as const,
        },
      ],
      prepareScreenForExport: vi.fn(),
      resolveSnapshotExportSource: vi.fn((screenId: string) =>
        snapshotSource
          ? {
              ...snapshotSource,
              baseUrl:
                screenId === "screen-remote-2"
                  ? "http://localhost:5173/settings"
                  : snapshotSource.baseUrl,
            }
          : null,
      ),
      releaseScreenFromExport: vi.fn(),
      pngExportingRef: { current: false },
      setPngExporting: vi.fn(),
      showRasterCaptureError,
      t: (key: string) => key,
      triggerBlobDownload,
    },
    dispose,
    showRasterCaptureError,
    snapshotDoc,
    triggerBlobDownload,
  };
}

beforeEach(() => {
  document.body.replaceChildren();
  mocks.createExportSnapshotFrame.mockReset();
  mocks.createMultiPageRasterPdf.mockReset();
  mocks.cropCanvasToRect.mockReset().mockReturnValue(null);
  mocks.renderExportDocumentCanvas.mockReset().mockResolvedValue({
    canvas: makeCanvas("data:image/png;base64,rendered"),
    scale: 2,
  });
  mocks.createMultiPageRasterPdf.mockResolvedValue(
    new Blob(["pdf"], { type: "application/pdf" }),
  );
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("runDownloadAllScreensPdf snapshot fallback", () => {
  it("renders cross-origin localhost screens from their current runtime snapshot", async () => {
    const fixture = makeArgs({
      html: "<!doctype html><html><body><main>Current preview</main></body></html>",
      baseUrl: "http://localhost:5173/",
    });

    await runDownloadAllScreensPdf(fixture.args);

    expect(mocks.createExportSnapshotFrame).toHaveBeenNthCalledWith(1, {
      source: {
        html: "<!doctype html><html><body><main>Current preview</main></body></html>",
        baseUrl: "http://localhost:5173/",
      },
      width: 320,
      height: 200,
    });
    expect(mocks.createExportSnapshotFrame).toHaveBeenNthCalledWith(2, {
      source: {
        html: "<!doctype html><html><body><main>Current preview</main></body></html>",
        baseUrl: "http://localhost:5173/settings",
      },
      width: 320,
      height: 200,
    });
    expect(mocks.renderExportDocumentCanvas).toHaveBeenCalledWith(
      expect.objectContaining({ doc: fixture.snapshotDoc }),
    );
    expect(mocks.createMultiPageRasterPdf).toHaveBeenCalledWith([
      expect.objectContaining({ width: 320, height: 200 }),
      expect.objectContaining({ width: 320, height: 200 }),
    ]);
    expect(fixture.dispose).toHaveBeenCalledTimes(2);
    expect(fixture.triggerBlobDownload).toHaveBeenCalledOnce();
    expect(fixture.showRasterCaptureError).not.toHaveBeenCalled();
  });

  it("reports cross-origin preview failure when no current snapshot is available", async () => {
    const fixture = makeArgs(null);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await runDownloadAllScreensPdf(fixture.args);

    expect(mocks.renderExportDocumentCanvas).not.toHaveBeenCalled();
    expect(fixture.triggerBlobDownload).not.toHaveBeenCalled();
    expect(fixture.showRasterCaptureError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "external-preview" }),
      "pdf",
    );
  });
});
