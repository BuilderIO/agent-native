// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { buildStaticForeignObjectSvg } from "../export-capture";
import { resolveSvgExportIframe, runDownloadSvg } from "./download-svg";

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

  it("uses the only preview when the active frame has no screen marker", () => {
    const preview = previewIframe();

    expect(resolveSvgExportIframe([preview], "board")).toBe(preview);
  });
});

describe("runDownloadSvg", () => {
  it("downloads parseable XML when the preview contains Alpine directives", async () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "true");
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
