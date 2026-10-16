// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  trackDesignRelay: vi.fn(),
  canCopyPngToClipboard: vi.fn(() => true),
  copyPngPromiseToClipboard: vi.fn(),
  canCopyFigmaSvgToClipboard: vi.fn(() => true),
  copyDesignAsFigmaSvg: vi.fn(),
  exportDesignAsFigmaSvg: vi.fn(),
  createSinglePageRasterPdf: vi.fn(),
  createMultiPageRasterPdf: vi.fn(),
  waitForExportReady: vi.fn(),
  renderExportDocumentCanvas: vi.fn(),
}));

vi.mock("@/lib/design-relay-tracking", () => ({
  trackDesignRelay: mocks.trackDesignRelay,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/png-clipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/png-clipboard")>()),
  canCopyPngToClipboard: mocks.canCopyPngToClipboard,
  copyPngPromiseToClipboard: mocks.copyPngPromiseToClipboard,
}));
vi.mock("@/lib/figma-svg-copy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/figma-svg-copy")>()),
  canCopyFigmaSvgToClipboard: mocks.canCopyFigmaSvgToClipboard,
  copyDesignAsFigmaSvg: mocks.copyDesignAsFigmaSvg,
  exportDesignAsFigmaSvg: mocks.exportDesignAsFigmaSvg,
}));
vi.mock("@/pages/design-editor/export-capture", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/pages/design-editor/export-capture")
  >()),
  createSinglePageRasterPdf: mocks.createSinglePageRasterPdf,
  createMultiPageRasterPdf: mocks.createMultiPageRasterPdf,
  waitForExportReady: mocks.waitForExportReady,
}));
vi.mock("@/pages/design-editor/png-export-render", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/pages/design-editor/png-export-render")
  >()),
  renderExportDocumentCanvas: mocks.renderExportDocumentCanvas,
}));

import { FigmaSvgCopyError } from "@/lib/figma-svg-copy";
import { PngClipboardError } from "@/lib/png-clipboard";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { NativeExportRenderError } from "@/pages/design-editor/native-export-render";
import { PngCaptureError } from "@/pages/design-editor/png-export-render";
import type { DesignFile } from "@/pages/design-editor/types";

import { runCopyAsFigmaSvg } from "./copy-as-figma-svg";
import { runCopyAsPng } from "./copy-as-png";
import { runDownloadAllScreensPdf } from "./download-all-screens-pdf";
import { runDownloadFigmaSvg } from "./download-figma-svg";
import { runDownloadPdf } from "./download-pdf";
import { runDownloadPng } from "./download-png";
import { runDownloadSvg } from "./download-svg";

const exportTracking = { designId: "design-1", signedIn: true };
const t = (key: string) => key;
const pngBlob = () => new Blob(["png"], { type: "image/png" });

function exportEvents() {
  return mocks.trackDesignRelay.mock.calls.filter(
    ([name]) => name === "design_exported",
  );
}

function expectOneExport(props: Record<string, unknown>) {
  expect(mocks.trackDesignRelay).toHaveBeenCalledTimes(1);
  const [name, recorded, options] = mocks.trackDesignRelay.mock.calls[0]!;
  expect(name).toBe("design_exported");
  expect(recorded).toEqual({
    output_id: "design-1",
    output_type: "design",
    render_location: "browser",
    ...props,
  });
  expect(options).toEqual({ signedIn: true });
}

function busyRef() {
  return { current: true };
}
function idleRef() {
  return { current: false };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.canCopyPngToClipboard.mockReturnValue(true);
  mocks.canCopyFigmaSvgToClipboard.mockReturnValue(true);
  mocks.createSinglePageRasterPdf.mockResolvedValue(
    new Blob(["pdf"], { type: "application/pdf" }),
  );
  mocks.createMultiPageRasterPdf.mockResolvedValue(
    new Blob(["pdf"], { type: "application/pdf" }),
  );
  mocks.waitForExportReady.mockResolvedValue(undefined);
  mocks.renderExportDocumentCanvas.mockResolvedValue({
    canvas: { toDataURL: () => "data:image/png;base64," },
  });
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("PNG download", () => {
  function args(renderPngBlob: () => Promise<Blob>, ref = idleRef()) {
    return {
      exportTracking,
      fallbackExportName: (extension: string) => `design.${extension}`,
      pngExportingRef: ref,
      renderPngBlob,
      setPngExporting: () => undefined,
      showRasterCaptureError: () => undefined,
      t,
      triggerBlobDownload: vi.fn(),
    };
  }

  it("reports one completed export per download, in the chosen format", async () => {
    await runDownloadPng(
      args(async () => pngBlob()),
      undefined,
      "jpg",
    );
    expectOneExport({ export_format: "jpg", status: "completed" });
  });

  it("reports one failed export with the render error code", async () => {
    await runDownloadPng(
      args(async () => {
        throw new NativeExportRenderError("slow", "export_render_timeout");
      }),
    );
    expectOneExport({
      export_format: "png",
      status: "failed",
      error_type: "export_render_timeout",
    });
  });

  it("does not report a click ignored while another export runs", async () => {
    const render = vi.fn(async () => pngBlob());
    await runDownloadPng(args(render, busyRef()));
    expect(render).not.toHaveBeenCalled();
    expect(exportEvents()).toHaveLength(0);
  });
});

describe("Copy as PNG", () => {
  function args(ref = idleRef()) {
    return {
      exportTracking,
      pngExportingRef: ref,
      renderPngBlob: async () => pngBlob(),
      scope: "document" as const,
      setPngExporting: () => undefined,
      showRasterCaptureError: () => undefined,
      t,
    };
  }

  it("reports one completed copy", async () => {
    mocks.copyPngPromiseToClipboard.mockResolvedValue(undefined);
    await runCopyAsPng(args());
    expectOneExport({ export_format: "png_copy", status: "completed" });
  });

  it("reports one failed copy when the clipboard blocks the write", async () => {
    mocks.copyPngPromiseToClipboard.mockRejectedValue(
      new PngClipboardError("blocked"),
    );
    await runCopyAsPng(args());
    expectOneExport({
      export_format: "png_copy",
      status: "failed",
      error_type: "blocked",
    });
  });

  it("reports one failed copy when the browser cannot copy images", async () => {
    mocks.canCopyPngToClipboard.mockReturnValue(false);
    await runCopyAsPng(args());
    expect(mocks.copyPngPromiseToClipboard).not.toHaveBeenCalled();
    expectOneExport({
      export_format: "png_copy",
      status: "failed",
      error_type: "unsupported",
    });
  });

  it("does not report a click ignored while another export runs", async () => {
    await runCopyAsPng(args(busyRef()));
    expect(exportEvents()).toHaveLength(0);
  });
});

describe("PDF download", () => {
  function args(renderPngBlob: () => Promise<Blob>, ref = idleRef()) {
    return {
      exportTracking,
      fallbackExportName: (extension: string) => `design.${extension}`,
      pngExportingRef: ref,
      renderPngBlob,
      resolveSelectedScreensBounds: () => ({
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      }),
      resolvePngCaptureTarget: () => {
        throw new Error("selected-screen bounds skip the capture target");
      },
      setPngExporting: () => undefined,
      showRasterCaptureError: () => undefined,
      t,
      triggerBlobDownload: vi.fn(),
    };
  }

  it("reports one completed export", async () => {
    const download = args(async () => pngBlob());
    await runDownloadPdf(download, undefined, "screens");
    expect(download.triggerBlobDownload).toHaveBeenCalledTimes(1);
    expectOneExport({ export_format: "pdf", status: "completed" });
  });

  it("reports one failed export", async () => {
    await runDownloadPdf(
      args(async () => {
        throw new PngCaptureError("blob-failed");
      }),
      undefined,
      "screens",
    );
    expectOneExport({
      export_format: "pdf",
      status: "failed",
      error_type: "blob_failed",
    });
  });

  it("does not report a click ignored while another export runs", async () => {
    await runDownloadPdf(args(async () => pngBlob(), busyRef()));
    expect(exportEvents()).toHaveLength(0);
  });
});

describe("All-screens PDF download", () => {
  const screens = [
    { id: "screen-a", width: 100, height: 100 },
    { id: "screen-b", width: 100, height: 100 },
  ] as OverviewScreen[];

  function mountScreens(contentDocument: () => unknown) {
    for (const screen of screens) {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("data-screen-iframe-id", screen.id);
      iframe.dataset.designSourceType = "localhost";
      Object.defineProperty(iframe, "contentDocument", {
        configurable: true,
        get: contentDocument,
      });
      document.body.append(iframe);
    }
  }

  function args(ref = idleRef(), overviewScreens = screens) {
    return {
      activeCanvasSourceType: "localhost" as const,
      canEditDesign: true,
      canvasFrameGeometryById: {},
      exportTracking,
      fallbackExportName: (extension: string) => `design.${extension}`,
      overviewScreens,
      prepareScreenForExport: () => undefined,
      resolveSnapshotExportSource: () => null,
      releaseScreenFromExport: () => undefined,
      pngExportingRef: ref,
      setPngExporting: () => undefined,
      showRasterCaptureError: () => undefined,
      t,
      triggerBlobDownload: vi.fn(),
    };
  }

  it("reports one completed export for the whole document", async () => {
    mountScreens(() => ({
      readyState: "complete",
      documentElement: {},
      images: [],
      defaultView: window,
    }));
    const download = args();
    await runDownloadAllScreensPdf(download);
    expect(download.triggerBlobDownload).toHaveBeenCalledTimes(1);
    expectOneExport({
      export_format: "pdf_all_screens",
      status: "completed",
      screen_count: 2,
    });
  });

  it("reports one failed export when a screen cannot be captured", async () => {
    mountScreens(() => null);
    await runDownloadAllScreensPdf(args());
    expectOneExport({
      export_format: "pdf_all_screens",
      status: "failed",
      error_type: "external_preview",
      screen_count: 2,
    });
  });

  it("does not report when the command does not apply or is busy", async () => {
    await runDownloadAllScreensPdf(args(idleRef(), screens.slice(0, 1)));
    await runDownloadAllScreensPdf(args(busyRef()));
    expect(exportEvents()).toHaveLength(0);
  });
});

describe("SVG download", () => {
  function args() {
    return {
      activePreviewFrameId: "screen-1",
      design: null,
      exportTracking,
      fallbackExportName: (extension: string) => `design.${extension}`,
      selectedElement: null,
      setSvgExporting: () => undefined,
      t,
      triggerBlobDownload: vi.fn(),
    };
  }

  function mountPreview() {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-screen-iframe-id", "screen-1");
    document.body.append(iframe);
    iframe.contentDocument!.body.innerHTML = "<p>Hello</p>";
  }

  it("reports one completed export", async () => {
    mountPreview();
    const download = args();
    await runDownloadSvg(download);
    expect(download.triggerBlobDownload).toHaveBeenCalledTimes(1);
    expectOneExport({ export_format: "svg", status: "completed" });
  });

  it("reports one failed export when the snapshot fails", async () => {
    mountPreview();
    mocks.waitForExportReady.mockRejectedValue(new Error("fonts"));
    await runDownloadSvg(args());
    expectOneExport({
      export_format: "svg",
      status: "failed",
      error_type: "export_error",
    });
  });

  it("reports one failed export when no screen is open", async () => {
    await runDownloadSvg(args());
    expectOneExport({
      export_format: "svg",
      status: "failed",
      error_type: "no_preview",
    });
  });
});

describe("Copy as Figma SVG", () => {
  function args(ref = idleRef()) {
    return {
      activeFile: { id: "file-1" } as DesignFile,
      exportTracking,
      figmaSvgExportingRef: ref,
      id: "design-1",
      resolveLiveFigmaSvgSnapshot: () => null,
      resolveLiveFigmaSvgSource: () => null,
      selectedElementLayerId: null,
      selectedScreenIds: [],
      setFigmaSvgExporting: () => undefined,
      t,
    };
  }

  it("reports one completed copy", async () => {
    mocks.copyDesignAsFigmaSvg.mockResolvedValue({ filename: "x.svg" });
    await runCopyAsFigmaSvg(args());
    expectOneExport({ export_format: "figma_copy", status: "completed" });
  });

  it("reports one failed copy", async () => {
    mocks.copyDesignAsFigmaSvg.mockRejectedValue(
      new FigmaSvgCopyError("render-failed"),
    );
    await runCopyAsFigmaSvg(args());
    expectOneExport({
      export_format: "figma_copy",
      status: "failed",
      error_type: "render_failed",
    });
  });

  it("does not report a click ignored while another export runs", async () => {
    await runCopyAsFigmaSvg(args(busyRef()));
    expect(exportEvents()).toHaveLength(0);
  });
});

describe("Download Figma SVG", () => {
  function args(ref = idleRef()) {
    return {
      activeFile: { id: "file-1" } as DesignFile,
      exportTracking,
      fallbackExportName: (extension: string) => `design.${extension}`,
      figmaSvgExportingRef: ref,
      id: "design-1",
      resolveLiveFigmaSvgSnapshot: () => null,
      resolveLiveFigmaSvgSource: () => null,
      selectedElementLayerId: null,
      selectedScreenIds: [],
      setFigmaSvgExporting: () => undefined,
      t,
      triggerBlobDownload: vi.fn(),
    };
  }

  it("reports one completed download", async () => {
    mocks.exportDesignAsFigmaSvg.mockResolvedValue({
      svg: "<svg/>",
      filename: "x.svg",
    });
    const download = args();
    await runDownloadFigmaSvg(download);
    expect(download.triggerBlobDownload).toHaveBeenCalledTimes(1);
    expectOneExport({ export_format: "figma_download", status: "completed" });
  });

  it("reports one failed download", async () => {
    mocks.exportDesignAsFigmaSvg.mockRejectedValue(new Error("server"));
    await runDownloadFigmaSvg(args());
    expectOneExport({
      export_format: "figma_download",
      status: "failed",
      error_type: "export_error",
    });
  });

  it("reports one failed download when no screen is open", async () => {
    await runDownloadFigmaSvg({ ...args(), activeFile: undefined });
    expect(mocks.exportDesignAsFigmaSvg).not.toHaveBeenCalled();
    expectOneExport({
      export_format: "figma_download",
      status: "failed",
      error_type: "no_preview",
    });
  });

  it("does not report a click ignored while another export runs", async () => {
    await runDownloadFigmaSvg(args(busyRef()));
    expect(mocks.exportDesignAsFigmaSvg).not.toHaveBeenCalled();
    expect(exportEvents()).toHaveLength(0);
  });
});
