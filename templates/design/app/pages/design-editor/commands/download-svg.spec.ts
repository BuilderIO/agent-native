// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import { buildStaticForeignObjectSvg } from "../export-capture";
import { runDownloadAllScreensPdf } from "./download-all-screens-pdf";
import { resolveSvgExportIframe, runDownloadSvg } from "./download-svg";

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
