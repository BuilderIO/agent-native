import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { getDesignCanvasIframeSandbox } from "./design-canvas/external-preview";

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("Design session replay iframe wiring", () => {
  it("bootstraps and marks inline DesignCanvas documents", () => {
    const designCanvas = source("./DesignCanvas.tsx");

    expect(designCanvas).toContain(
      "return injectSessionReplayIframeBootstrap(frameDocument);",
    );
    expect(designCanvas).toContain("SESSION_REPLAY_IFRAME_ATTRIBUTE");
  });

  it("bootstraps and marks overview and breakpoint srcdoc documents", () => {
    const multiScreenCanvas = source("./MultiScreenCanvas.tsx");

    expect(multiScreenCanvas).toContain("appendHitTestResponder(");
    expect(multiScreenCanvas).toContain("injectSessionReplayIframeBootstrap(");
    expect(multiScreenCanvas).toContain("SESSION_REPLAY_IFRAME_ATTRIBUTE");
  });

  it("keeps URL fallback frames live while preserving opaque srcdoc frames", () => {
    const multiScreenCanvas = source("./MultiScreenCanvas.tsx");
    const designCanvas = source("./DesignCanvas.tsx");
    expect(
      getDesignCanvasIframeSandbox({
        externalPreview: true,
        readOnly: true,
        parentOrigin: "https://editor.builderio.xyz",
        previewUrl: "https://branch.builderio.xyz/forms",
      }),
    ).toContain("allow-same-origin");
    expect(
      getDesignCanvasIframeSandbox({ externalPreview: false, readOnly: true }),
    ).not.toContain("allow-same-origin");
    expect(designCanvas).toContain("externalPreviewPendingOrigin ? null");
    expect(multiScreenCanvas).toContain("externalPreviewPendingOrigin ? null");
    const iframeBlock = (marker: string, endMarker: string) => {
      const start = multiScreenCanvas.lastIndexOf(
        "<iframe",
        multiScreenCanvas.indexOf(marker),
      );
      const end = multiScreenCanvas.indexOf(endMarker, start);
      return multiScreenCanvas.slice(start, end);
    };

    for (const block of [
      iframeBlock(
        "data-screen-iframe-id={screen.id}",
        "title={screen.filename}",
      ),
      iframeBlock(
        "data-screen-iframe-id={getBreakpointIframeId(",
        "title={`${screen.filename} — ${breakpointLabel(widthPx)}`}",
      ),
    ]) {
      expect(block).toContain("src={previewUrl}");
      expect(block).toContain(
        "srcDoc={previewUrl ? undefined : srcdocWithHitTest}",
      );
      expect(block).toContain("sandbox={getDesignCanvasIframeSandbox({");
      expect(block).toContain("externalPreview: Boolean(previewUrl)");
      expect(block).toContain("readOnly: true");
      expect(block).not.toContain('sandbox="allow-scripts"');
    }
  });

  it("uses only script permission for shared Visual Edit snapshots", () => {
    expect(
      getDesignCanvasIframeSandbox({
        externalPreview: false,
        readOnly: true,
        snapshotOnly: true,
      }),
    ).toBe("allow-scripts");
  });

  it("covers the home thumbnail and Present route srcdoc documents", () => {
    const thumbnail = source("./DesignThumbnail.tsx");
    const present = source("../../pages/Present.tsx");

    for (const content of [thumbnail, present]) {
      expect(content).toContain("injectSessionReplayIframeBootstrap");
      expect(content).toContain("SESSION_REPLAY_IFRAME_ATTRIBUTE");
    }
  });
});
