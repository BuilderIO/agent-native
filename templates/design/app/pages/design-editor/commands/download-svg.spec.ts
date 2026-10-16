// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import { trackBrowserDesignExported } from "@/lib/design-export-tracking";

import { buildStaticForeignObjectSvg } from "../export-capture";
import { runDownloadAllScreensPdf } from "./download-all-screens-pdf";
import { resolveSvgExportIframe, runDownloadSvg } from "./download-svg";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastMocks }));

vi.mock("@/lib/design-export-tracking", () => ({
  browserDesignExportErrorType: () => "unknown",
  trackBrowserDesignExported: vi.fn(),
}));

function previewIframe(screenId?: string) {
  return {
    screenId,
    getAttribute: (name: string) =>
      name === "data-screen-iframe-id" ? (screenId ?? null) : null,
  };
}

function markExternalPreviewDocument(iframe: HTMLIFrameElement) {
  Object.defineProperty(iframe.contentDocument!, "URL", {
    configurable: true,
    value: "http://localhost:3000/",
  });
}

describe("resolveSvgExportIframe", () => {
  it("selects the active preview instead of an earlier board iframe", () => {
    const board = previewIframe();
    const active = previewIframe("screen-b::bp-390");
    const other = previewIframe("screen-a");

    expect(
      resolveSvgExportIframe([board, other, active], "screen-b::bp-390"),
    ).toBe(active);
  });

  it("does not export an unrelated preview when multiple frames are mounted", () => {
    const previews = [previewIframe(), previewIframe("screen-a")];

    expect(resolveSvgExportIframe(previews, "screen-b")).toBeNull();
  });

  it("does not replace a missing requested frame with the only other preview", () => {
    const preview = previewIframe("other-screen");

    expect(resolveSvgExportIframe([preview], "stale-screen")).toBeNull();
  });

  it("uses the only preview when no frame was requested", () => {
    const preview = previewIframe();

    expect(resolveSvgExportIframe([preview])).toBe(preview);
  });
});

describe("runDownloadSvg", () => {
  it("acknowledges a request while another browser export is busy", async () => {
    toastMocks.error.mockClear();
    const setSvgExporting = vi.fn();
    const triggerBlobDownload = vi.fn();

    await runDownloadSvg({
      design: null,
      fallbackExportName: (extension) => `design.${extension}`,
      pngExportingRef: { current: true },
      selectedElement: null,
      setSvgExporting,
      t: (key) => key,
      triggerBlobDownload,
    });

    expect(toastMocks.error).toHaveBeenCalledWith(
      "designEditor.toasts.exportBusy",
    );
    expect(setSvgExporting).not.toHaveBeenCalled();
    expect(triggerBlobDownload).not.toHaveBeenCalled();
  });

  it("exports a single-view inline screen without waiting for the content-size bridge", async () => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-screen-iframe-id", "screen-1");
    iframe.dataset.designSourceType = "inline";
    document.body.append(iframe);
    iframe.contentDocument!.body.innerHTML = "<main>Inline screen</main>";
    const downloads: Array<{ blob: Blob; filename: string }> = [];
    const tracking = vi.mocked(trackBrowserDesignExported);
    tracking.mockClear();
    toastMocks.error.mockClear();

    try {
      const task = runDownloadSvg({
        activeCanvasSourceType: "inline",
        activePreviewFrameId: "screen-1",
        design: null,
        exportScreenId: "screen-1",
        exportScreenSourceType: "inline",
        fallbackExportName: (extension) => `design.${extension}`,
        requireContentSizeReport: false,
        pngExportingRef: { current: false },
        selectedElement: null,
        setSvgExporting: () => undefined,
        t: (key) => key,
        triggerBlobDownload: (blob, filename) =>
          downloads.push({ blob, filename }),
      });
      await vi.runAllTimersAsync();
      await task;

      expect(downloads).toHaveLength(1);
      expect(await downloads[0]!.blob.text()).toContain("Inline screen");
      expect(tracking).toHaveBeenLastCalledWith(
        "svg",
        expect.objectContaining({ status: "completed" }),
      );
      expect(toastMocks.error).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      document.body.replaceChildren();
    }
  });

  it("waits for an external preview to replace its initial about:blank document", async () => {
    document.body.replaceChildren();
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-screen-iframe-id", "screen-1");
    iframe.dataset.designSourceType = "localhost";
    const loadedIframe = document.createElement("iframe");
    document.body.append(iframe, loadedIframe);
    const initialDocument = iframe.contentDocument!;
    initialDocument.body.innerHTML = "<main>Initial blank document</main>";
    const loadedDocument = loadedIframe.contentDocument!;
    loadedDocument.body.innerHTML = "<main>Loaded external preview</main>";
    Object.defineProperty(initialDocument, "URL", {
      configurable: true,
      value: "about:blank",
    });
    markExternalPreviewDocument(loadedIframe);
    let documentReads = 0;
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      get: () => (documentReads++ === 0 ? initialDocument : loadedDocument),
    });
    const downloads: Array<{ blob: Blob; filename: string }> = [];

    try {
      expect(initialDocument.URL).toBe("about:blank");
      expect(loadedDocument.URL).toBe("http://localhost:3000/");
      vi.useFakeTimers();
      const task = runDownloadSvg({
        activeCanvasSourceType: "localhost",
        activePreviewFrameId: "screen-1",
        design: null,
        exportScreenId: "screen-1",
        exportScreenSourceType: "localhost",
        fallbackExportName: (extension) => `design.${extension}`,
        pngExportingRef: { current: false },
        selectedElement: null,
        setSvgExporting: () => undefined,
        t: (key) => key,
        triggerBlobDownload: (blob, filename) =>
          downloads.push({ blob, filename }),
      });
      await vi.runAllTimersAsync();
      await task;

      expect(documentReads).toBeGreaterThan(1);
      expect(downloads).toHaveLength(1);
      const exportedSvg = await downloads[0]!.blob.text();
      expect(exportedSvg).toContain("Loaded external preview");
      expect(exportedSvg).not.toContain("Initial blank document");
    } finally {
      vi.useRealTimers();
      document.body.replaceChildren();
    }
  });

  it("promotes the requested overview screen and waits for its exact preview", async () => {
    document.body.replaceChildren();
    const unrelated = document.createElement("iframe");
    unrelated.setAttribute("data-screen-iframe-id", "screen-a");
    document.body.append(unrelated);
    unrelated.contentDocument!.body.innerHTML = "<main>Wrong screen</main>";

    const events: string[] = [];
    const downloads: Array<{ blob: Blob; filename: string }> = [];
    try {
      await runDownloadSvg({
        activeCanvasSourceType: "localhost",
        activePreviewFrameId: "screen-b::bp-390",
        design: null,
        exportScreenId: "screen-b",
        exportScreenSourceType: "localhost",
        fallbackExportName: (extension) => `design.${extension}`,
        pngExportingRef: { current: false },
        prepareScreenForExport: (screenId) => {
          events.push(`promote:${screenId}`);
          window.setTimeout(() => {
            const requested = document.createElement("iframe");
            requested.setAttribute("data-screen-iframe-id", "screen-b::bp-390");
            document.body.append(requested);
            markExternalPreviewDocument(requested);
            requested.contentDocument!.body.innerHTML =
              "<main>Breakpoint target</main>";
            events.push("mount");
          }, 0);
        },
        releaseScreenFromExport: () => events.push("release"),
        selectedElement: null,
        setSvgExporting: () => undefined,
        t: (key) => key,
        triggerBlobDownload: (blob, filename) => {
          events.push("download");
          downloads.push({ blob, filename });
        },
      });

      expect(events).toEqual([
        "promote:screen-b",
        "mount",
        "download",
        "release",
      ]);
      expect(downloads).toHaveLength(1);
      const exportedSvg = await downloads[0]!.blob.text();
      expect(exportedSvg).toContain("Breakpoint target");
      expect(exportedSvg).not.toContain("Wrong screen");
    } finally {
      document.body.replaceChildren();
    }
  });

  it("releases the overview screen lease when the download fails", async () => {
    document.body.replaceChildren();
    const events: string[] = [];
    const exportStates: boolean[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      // The command reports the failed browser download through its error path.
    });
    try {
      await runDownloadSvg({
        activeCanvasSourceType: "localhost",
        activePreviewFrameId: "screen-1",
        design: null,
        exportScreenId: "screen-1",
        exportScreenSourceType: "localhost",
        fallbackExportName: (extension) => `design.${extension}`,
        pngExportingRef: { current: false },
        prepareScreenForExport: (screenId) => {
          events.push(`promote:${screenId}`);
          const requested = document.createElement("iframe");
          requested.setAttribute("data-screen-iframe-id", screenId);
          document.body.append(requested);
          markExternalPreviewDocument(requested);
          requested.contentDocument!.body.innerHTML = "<main>Target</main>";
        },
        releaseScreenFromExport: () => events.push("release"),
        selectedElement: null,
        setSvgExporting: (value) => {
          exportStates.push(typeof value === "boolean" ? value : value(false));
        },
        t: (key) => key,
        triggerBlobDownload: () => {
          events.push("download");
          throw new Error("Download failed");
        },
      });

      expect(events).toEqual(["promote:screen-1", "download", "release"]);
      expect(exportStates).toEqual([true, false]);
    } finally {
      consoleError.mockRestore();
      document.body.replaceChildren();
    }
  });

  it("does not overlap an all-screens PDF while SVG owns the preview lease", async () => {
    document.body.replaceChildren();
    const pngExportingRef = { current: false };
    const events: string[] = [];
    const requested = document.createElement("iframe");
    requested.setAttribute("data-screen-iframe-id", "screen-1");
    document.body.append(requested);
    requested.contentDocument!.body.innerHTML = "<main>Target</main>";

    const svgTask = runDownloadSvg({
      activePreviewFrameId: "screen-1",
      design: null,
      exportScreenId: "screen-1",
      fallbackExportName: (extension) => `design.${extension}`,
      pngExportingRef,
      prepareScreenForExport: () => {
        events.push("svg:prepare");
      },
      releaseScreenFromExport: () => events.push("svg:release"),
      selectedElement: null,
      setSvgExporting: () => undefined,
      t: (key) => key,
      triggerBlobDownload: () => events.push("svg:download"),
    });

    const pdfPrepare = vi.fn();
    const pdfRelease = vi.fn();
    await runDownloadAllScreensPdf({
      activeCanvasSourceType: "inline",
      canEditDesign: true,
      canvasFrameGeometryById: {},
      fallbackExportName: (extension) => `design.${extension}`,
      overviewScreens: [
        {
          id: "screen-a",
          filename: "screen-a.html",
          content: "",
          updatedAt: "",
          width: 100,
          height: 100,
          heightPinned: false,
        },
        {
          id: "screen-b",
          filename: "screen-b.html",
          content: "",
          updatedAt: "",
          width: 100,
          height: 100,
          heightPinned: false,
        },
      ],
      prepareScreenForExport: pdfPrepare,
      releaseScreenFromExport: pdfRelease,
      pngExportingRef,
      setPngExporting: () => undefined,
      showRasterCaptureError: () => undefined,
      t: (key) => key,
      triggerBlobDownload: vi.fn(),
    });

    expect(pngExportingRef.current).toBe(true);
    expect(pdfPrepare).not.toHaveBeenCalled();
    expect(pdfRelease).not.toHaveBeenCalled();

    await svgTask;

    expect(events).toEqual(["svg:prepare", "svg:download", "svg:release"]);
    expect(pngExportingRef.current).toBe(false);
    document.body.replaceChildren();
  });

  it("does not release an existing all-screens PDF preview lease", async () => {
    const pngExportingRef = { current: true };
    const prepareScreenForExport = vi.fn();
    const releaseScreenFromExport = vi.fn();
    const setSvgExporting = vi.fn();

    await runDownloadSvg({
      activePreviewFrameId: "screen-1",
      design: null,
      exportScreenId: "screen-1",
      fallbackExportName: (extension) => `design.${extension}`,
      pngExportingRef,
      prepareScreenForExport,
      releaseScreenFromExport,
      selectedElement: null,
      setSvgExporting,
      t: (key) => key,
      triggerBlobDownload: vi.fn(),
    });

    expect(prepareScreenForExport).not.toHaveBeenCalled();
    expect(releaseScreenFromExport).not.toHaveBeenCalled();
    expect(setSvgExporting).not.toHaveBeenCalled();
    expect(pngExportingRef.current).toBe(true);
  });

  it.each(["absent", "throws"] as const)(
    "reports a mounted preview with %s contentDocument immediately",
    async (contentDocumentState) => {
      document.body.replaceChildren();
      const iframe = document.createElement("iframe");
      iframe.setAttribute("data-screen-iframe-id", "screen-1");
      document.body.append(iframe);
      Object.defineProperty(iframe, "contentDocument", {
        configurable: true,
        get: () => {
          if (contentDocumentState === "throws") {
            throw new DOMException("Blocked frame access", "SecurityError");
          }
          return null;
        },
      });
      let performanceCalls = 0;
      const performanceNow = vi
        .spyOn(window.performance, "now")
        .mockImplementation(() => (performanceCalls++ === 0 ? 0 : 20_000));
      const prepareScreenForExport = vi.fn();
      const releaseScreenFromExport = vi.fn();
      const setSvgExporting = vi.fn();
      const pngExportingRef = { current: false };
      const tracking = vi.mocked(trackBrowserDesignExported);
      tracking.mockClear();
      toastMocks.error.mockClear();

      try {
        await runDownloadSvg({
          activeCanvasSourceType: "inline",
          activePreviewFrameId: "screen-1",
          design: null,
          exportScreenId: "screen-1",
          exportScreenSourceType: "inline",
          fallbackExportName: (extension) => `design.${extension}`,
          requireContentSizeReport: true,
          pngExportingRef,
          prepareScreenForExport,
          releaseScreenFromExport,
          selectedElement: null,
          setSvgExporting,
          t: (key) => key,
          triggerBlobDownload: vi.fn(),
        });

        expect(performanceCalls).toBe(1);
        expect(prepareScreenForExport).toHaveBeenCalledOnce();
        expect(releaseScreenFromExport).toHaveBeenCalledOnce();
        expect(setSvgExporting).toHaveBeenNthCalledWith(1, true);
        expect(setSvgExporting).toHaveBeenNthCalledWith(2, false);
        expect(pngExportingRef.current).toBe(false);
        expect(tracking).toHaveBeenLastCalledWith(
          "svg",
          expect.objectContaining({
            status: "failed",
            errorType: "export_error",
          }),
        );
        expect(toastMocks.error).toHaveBeenLastCalledWith(
          "designEditor.toasts.svgExportError",
        );
      } finally {
        performanceNow.mockRestore();
        document.body.replaceChildren();
      }
    },
  );

  it("reports a mounted preview readiness timeout as an export error", async () => {
    document.body.replaceChildren();
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-screen-iframe-id", "screen-1");
    iframe.dataset.designSourceType = "inline";
    document.body.append(iframe);
    iframe.contentDocument!.body.innerHTML = "<main>Waiting for bridge</main>";
    let performanceCalls = 0;
    const performanceNow = vi
      .spyOn(window.performance, "now")
      .mockImplementation(() => (performanceCalls++ === 0 ? 0 : 20_000));
    const tracking = vi.mocked(trackBrowserDesignExported);
    const prepareScreenForExport = vi.fn();
    const releaseScreenFromExport = vi.fn();
    const triggerBlobDownload = vi.fn();
    tracking.mockClear();
    toastMocks.error.mockClear();

    try {
      await runDownloadSvg({
        activeCanvasSourceType: "inline",
        activePreviewFrameId: "screen-1",
        design: null,
        exportScreenId: "screen-1",
        exportScreenSourceType: "inline",
        fallbackExportName: (extension) => `design.${extension}`,
        requireContentSizeReport: true,
        pngExportingRef: { current: false },
        prepareScreenForExport,
        releaseScreenFromExport,
        selectedElement: null,
        setSvgExporting: () => undefined,
        t: (key) => key,
        triggerBlobDownload,
      });

      expect(performanceCalls).toBe(2);
      expect(prepareScreenForExport).toHaveBeenCalledOnce();
      expect(releaseScreenFromExport).toHaveBeenCalledOnce();
      expect(triggerBlobDownload).not.toHaveBeenCalled();
      expect(tracking).toHaveBeenLastCalledWith(
        "svg",
        expect.objectContaining({
          status: "failed",
          errorType: "export_error",
        }),
      );
      expect(toastMocks.error).toHaveBeenLastCalledWith(
        "designEditor.toasts.svgExportError",
      );
    } finally {
      performanceNow.mockRestore();
      document.body.replaceChildren();
    }
  });

  it("reports a requested preview that never mounts as no preview", async () => {
    document.body.replaceChildren();
    let performanceCalls = 0;
    const performanceNow = vi
      .spyOn(window.performance, "now")
      .mockImplementation(() => (performanceCalls++ === 0 ? 0 : 20_000));
    const tracking = vi.mocked(trackBrowserDesignExported);
    const prepareScreenForExport = vi.fn();
    const releaseScreenFromExport = vi.fn();
    const triggerBlobDownload = vi.fn();
    tracking.mockClear();
    toastMocks.error.mockClear();

    try {
      await runDownloadSvg({
        activeCanvasSourceType: "inline",
        activePreviewFrameId: "screen-1",
        design: null,
        exportScreenId: "screen-1",
        exportScreenSourceType: "inline",
        fallbackExportName: (extension) => `design.${extension}`,
        pngExportingRef: { current: false },
        prepareScreenForExport,
        releaseScreenFromExport,
        selectedElement: null,
        setSvgExporting: () => undefined,
        t: (key) => key,
        triggerBlobDownload,
      });

      expect(performanceCalls).toBe(2);
      expect(prepareScreenForExport).toHaveBeenCalledOnce();
      expect(releaseScreenFromExport).toHaveBeenCalledOnce();
      expect(triggerBlobDownload).not.toHaveBeenCalled();
      expect(tracking).toHaveBeenLastCalledWith(
        "svg",
        expect.objectContaining({
          status: "failed",
          errorType: "no_preview",
        }),
      );
      expect(toastMocks.error).toHaveBeenLastCalledWith(
        "designEditor.toasts.openScreenSvg",
      );
    } finally {
      performanceNow.mockRestore();
      document.body.replaceChildren();
    }
  });

  it("downloads parseable XML when the preview contains Alpine directives", async () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-screen-iframe-id", "screen-1");
    document.body.append(iframe);

    try {
      const preview = iframe.contentDocument!;
      preview.body.innerHTML = `<div @keydown.escape.window="close()">
        <button @click="cartOpen = !cartOpen">Bag</button>
        <template x-for="item in items" :key="item.id">
          <button @click="select(item)" :class="{ active: item.selected }">Quick view</button>
        </template>
      </div>`;

      Object.defineProperty(iframe, "clientWidth", { value: 390 });
      Object.defineProperty(iframe, "clientHeight", { value: 844 });

      const rawSvg = buildStaticForeignObjectSvg({
        documentWidth: 390,
        documentHeight: 844,
        scale: 1,
        safeTitle: "Design",
        serializedHtml: new XMLSerializer().serializeToString(
          preview.documentElement,
        ),
      });
      expect(
        new DOMParser()
          .parseFromString(rawSvg, "image/svg+xml")
          .querySelector("parsererror"),
      ).not.toBeNull();

      const downloads: Array<{ blob: Blob; filename: string }> = [];
      await runDownloadSvg({
        activePreviewFrameId: "screen-1",
        design: null,
        fallbackExportName: (extension) => `design.${extension}`,
        pngExportingRef: { current: false },
        selectedElement: null,
        setSvgExporting: () => undefined,
        t: (key) => key,
        triggerBlobDownload: (blob, filename) =>
          downloads.push({ blob, filename }),
      });

      expect(downloads).toHaveLength(1);
      const download = downloads[0]!;
      expect(download.filename).toBe("design.svg");
      const exportedSvg = await download.blob.text();
      expect(
        new DOMParser()
          .parseFromString(exportedSvg, "image/svg+xml")
          .querySelector("parsererror"),
      ).toBeNull();
      expect(exportedSvg).not.toMatch(/(?:@click|@keydown|:key|:class)=/);
    } finally {
      iframe.remove();
    }
  });
});
