// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { runRenderPngBlob } from "./commands/render-png-blob";
import { PngCaptureError, resolveExportCropTarget } from "./png-export-render";

/**
 * The inspector's export preview captures with `scope: "element"`, which
 * refuses to widen a crop to the whole document. Selecting a screen — a frame
 * in overview, or the BODY root in single view — resolves no crop at all, and
 * treating that as a failed crop made the preview render "Preview unavailable"
 * for every frame-level selection while the Export button beside it worked.
 */

vi.mock("html2canvas", () => ({ default: vi.fn() }));

function fakeCanvas(tag: string): HTMLCanvasElement {
  return {
    dataset: { tag },
    width: 1440,
    height: 900,
    toBlob: (callback: (blob: Blob | null) => void, type?: string) =>
      callback(new Blob([tag], { type: type ?? "image/png" })),
  } as unknown as HTMLCanvasElement;
}

const cropCanvasToRect = vi.fn<
  typeof import("./png-export-render").cropCanvasToRect
>(() => fakeCanvas("cropped"));

vi.mock("./png-export-render", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./png-export-render")>();
  return {
    ...actual,
    renderExportDocumentCanvas: vi.fn(async () => ({
      canvas: fakeCanvas("full"),
      scale: 1,
    })),
    cropCanvasToRect: (...args: Parameters<typeof actual.cropCanvasToRect>) =>
      cropCanvasToRect(...args),
  };
});

function elementInfo(partial: Partial<ElementInfo>): ElementInfo {
  return { tagName: "DIV", ...partial } as ElementInfo;
}

function captureTarget(
  cropSelection: ElementInfo | readonly ElementInfo[] | null,
) {
  return () => ({
    cropSelection,
    doc: document,
    iframe: { clientWidth: 1440, clientHeight: 900 } as HTMLIFrameElement,
  });
}

function renderArgs(
  cropSelection: ElementInfo | readonly ElementInfo[] | null,
) {
  return {
    activeCanvasSourceType: "inline" as const,
    canEditDesign: true,
    canvasFrameGeometryById: {},
    overviewScreens: [],
    resolvePngCaptureTarget: captureTarget(cropSelection),
    selectedScreenIds: ["screen-1"],
    viewMode: "single" as const,
  };
}

afterEach(() => {
  cropCanvasToRect.mockClear();
  document.body.innerHTML = "";
});

describe("resolveExportCropTarget", () => {
  it("reports whole-screen for no selection", () => {
    expect(resolveExportCropTarget(document, null)).toEqual({
      kind: "whole-screen",
    });
    expect(resolveExportCropTarget(document, [])).toEqual({
      kind: "whole-screen",
    });
  });

  it("reports whole-screen for the screen root", () => {
    expect(
      resolveExportCropTarget(document, elementInfo({ tagName: "BODY" })),
    ).toEqual({ kind: "whole-screen" });
    expect(
      resolveExportCropTarget(document, elementInfo({ tagName: "html" })),
    ).toEqual({ kind: "whole-screen" });
  });

  it("reports unresolved for a selection missing from the live document", () => {
    expect(
      resolveExportCropTarget(
        document,
        elementInfo({ selector: "#not-in-this-document" }),
      ),
    ).toEqual({ kind: "unresolved" });
  });

  it("reports unresolved for a selection that measures empty", () => {
    const node = document.createElement("div");
    node.id = "empty-node";
    node.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect;
    document.body.appendChild(node);

    expect(
      resolveExportCropTarget(
        document,
        elementInfo({ selector: "#empty-node" }),
      ),
    ).toEqual({ kind: "unresolved" });
  });

  it("unions the rects of a multi-element selection", () => {
    const first = document.createElement("div");
    first.id = "first";
    first.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 100, height: 50 }) as DOMRect;
    const second = document.createElement("div");
    second.id = "second";
    second.getBoundingClientRect = () =>
      ({ left: 60, top: 20, width: 100, height: 80 }) as DOMRect;
    document.body.append(first, second);

    expect(
      resolveExportCropTarget(document, [
        elementInfo({ selector: "#first" }),
        elementInfo({ selector: "#second" }),
      ]),
    ).toEqual({
      kind: "rect",
      rect: { x: 10, y: 20, width: 150, height: 80 },
    });
  });
});

describe("runRenderPngBlob element scope", () => {
  it("renders the whole screen when the screen root is selected", async () => {
    const blob = await runRenderPngBlob(
      renderArgs(elementInfo({ tagName: "BODY" })),
      { scope: "element", settings: { scale: 1 } },
    );

    expect(await blob.text()).toBe("full");
    expect(cropCanvasToRect).not.toHaveBeenCalled();
  });

  it("renders the whole screen when a frame is selected with no element", async () => {
    const blob = await runRenderPngBlob(renderArgs(null), {
      scope: "element",
      settings: { scale: 1 },
    });

    expect(await blob.text()).toBe("full");
    expect(cropCanvasToRect).not.toHaveBeenCalled();
  });

  it("crops to a resolvable element selection", async () => {
    const node = document.createElement("div");
    node.id = "card";
    node.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 100, height: 50 }) as DOMRect;
    document.body.appendChild(node);

    const blob = await runRenderPngBlob(
      renderArgs(elementInfo({ selector: "#card" })),
      { scope: "element", settings: { scale: 1 } },
    );

    expect(await blob.text()).toBe("cropped");
    expect(cropCanvasToRect).toHaveBeenCalledTimes(1);
  });

  it("still fails when the selected element cannot be resolved", async () => {
    await expect(
      runRenderPngBlob(renderArgs(elementInfo({ selector: "#missing" })), {
        scope: "element",
        settings: { scale: 1 },
      }),
    ).rejects.toBeInstanceOf(PngCaptureError);
  });

  it("still fails when a resolvable selection crops to nothing", async () => {
    const node = document.createElement("div");
    node.id = "offscreen";
    node.getBoundingClientRect = () =>
      ({ left: 9000, top: 9000, width: 10, height: 10 }) as DOMRect;
    document.body.appendChild(node);
    cropCanvasToRect.mockReturnValueOnce(null);

    await expect(
      runRenderPngBlob(renderArgs(elementInfo({ selector: "#offscreen" })), {
        scope: "element",
        settings: { scale: 1 },
      }),
    ).rejects.toBeInstanceOf(PngCaptureError);
  });
});
